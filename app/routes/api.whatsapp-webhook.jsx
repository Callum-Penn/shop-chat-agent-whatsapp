import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import { saveMessage, getConversationHistory, cleanupOldMessages } from "../db.server";
import MCPClient from "../mcp-client";
import AppConfig from "../services/config.server";

// Cache for MCP connections to avoid reconnecting on every message
const mcpCache = new Map();

// Helper to send a message back to WhatsApp
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  
  console.log('WhatsApp: Sending message to', to);
  console.log('WhatsApp: Message content:', text.substring(0, 100) + '...');
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send message:', response.status, response.statusText);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  
  console.log('WhatsApp: Message sent successfully');
}

// Helper to get or create cached MCP client
async function getCachedMCPClient(shopDomain, conversationId, shopId) {
  const cacheKey = `${shopDomain}_${shopId}`;
  
  if (mcpCache.has(cacheKey)) {
    return mcpCache.get(cacheKey);
  }
  
  const mcpClient = new MCPClient(shopDomain, conversationId, shopId, null);
  
  // Connect to MCP servers once and cache
  try {
    console.log('WhatsApp: Connecting to MCP servers (cached)...');
    await mcpClient.connectToStorefrontServer();
    await mcpClient.connectToCustomerServer();
    console.log(`WhatsApp: Cached MCP client with ${mcpClient.tools.length} tools`);
    
    mcpCache.set(cacheKey, mcpClient);
    return mcpClient;
  } catch (error) {
    console.warn('WhatsApp: Failed to connect to MCP servers:', error.message);
    return mcpClient; // Return client even if connection fails
  }
}

// Helper to truncate conversation history to reduce tokens
function truncateConversationHistory(messages, maxMessages = 10) {
  if (messages.length <= maxMessages) {
    return messages;
  }
  
  // Keep the first message (system context) and the most recent messages
  const firstMessage = messages[0];
  const recentMessages = messages.slice(-maxMessages + 1);
  
  return [firstMessage, ...recentMessages];
}

export const action = async ({ request }) => {
  const body = await request.json();
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (message && message.text) {
    const userMessage = message.text.body;
    const from = message.from;
    
    // Use the phone number as conversation ID for WhatsApp
    const conversationId = `whatsapp_${from}`;
    
    try {
      console.log('WhatsApp: Processing message from', from);
      console.log('WhatsApp: User message:', userMessage);
      
      // Initialize services
      const claudeService = createClaudeService();
      const toolService = createToolService();
      
      // HARDCODED: Use the actual store URL for now
      const shopDomain = 'https://ju3ntu-rn.myshopify.com';
      const shopId = 'ju3ntu-rn';
      console.log('WhatsApp: Using hardcoded shop domain:', shopDomain);
      console.log('WhatsApp: Using hardcoded shop ID:', shopId);
      
      // Get cached MCP client
      const mcpClient = await getCachedMCPClient(shopDomain, conversationId, shopId);
      
      // Save user message to database
      await saveMessage(conversationId, 'user', userMessage);
      
      // Get conversation history and truncate to reduce tokens
      const dbMessages = await getConversationHistory(conversationId, 6);
      let conversationHistory = dbMessages.map(dbMessage => {
        let content;
        try {
          content = JSON.parse(dbMessage.content);
        } catch (e) {
          content = dbMessage.content;
        }
        return {
          role: dbMessage.role,
          content
        };
      });
      
      // Truncate conversation history to reduce token usage
      conversationHistory = truncateConversationHistory(conversationHistory, 6);
      
      // Clean conversation history to remove any corrupted tool_use/tool_result pairs
      conversationHistory = conversationHistory.filter(message => {
        // Remove any messages with corrupted tool_use or tool_result blocks
        if (message.content && Array.isArray(message.content)) {
          return message.content.every(content => 
            content.type !== 'tool_use' && content.type !== 'tool_result'
          );
        }
        return true;
      });
      
      // Simple tool execution approach (no complex tool service)
      let aiResponse = "Sorry, I couldn't generate a response.";
      
      try {
        // Get AI response with store context (non-streaming for WhatsApp)
        const aiResult = await claudeService.getConversationResponse({
          messages: conversationHistory,
          promptType: AppConfig.api.defaultPromptType,
          tools: mcpClient.tools
        });
        
        console.log('WhatsApp: AI response received');
        
        // Check if Claude wants to use tools
        if (aiResult?.content) {
          let toolUsed = false;
          let currentConversation = conversationHistory;
          
          for (const content of aiResult.content) {
            if (content.type === "tool_use") {
              toolUsed = true;
              const toolName = content.name;
              const toolArgs = content.input;
              
              console.log('WhatsApp: Executing tool:', toolName);
              console.log('WhatsApp: Tool arguments:', toolArgs);
              
              try {
                // Call the tool directly
                const toolResponse = await mcpClient.callTool(toolName, toolArgs);
                console.log('WhatsApp: Tool response received');
                console.log('WhatsApp: Tool response structure:', JSON.stringify(toolResponse, null, 2).substring(0, 500) + '...');
                
                // Check if tool execution was successful
                if (toolResponse.error) {
                  console.log('WhatsApp: Tool returned error:', toolResponse.error);
                  // Create a conversation with the error for the AI to handle
                  const errorConversation = [
                    ...currentConversation,
                    {
                      role: 'assistant',
                      content: [content]
                    },
                    {
                      role: 'user',
                      content: [{
                        type: 'tool_result',
                        tool_use_id: content.id,
                        content: `Error: ${toolResponse.error}`
                      }]
                    }
                  ];
                  
                  // Get AI response to handle the error
                  const errorResult = await claudeService.getConversationResponse({
                    messages: errorConversation,
                    promptType: AppConfig.api.defaultPromptType,
                    tools: mcpClient.tools
                  });
                  
                  // Extract error response
                  if (errorResult?.content && Array.isArray(errorResult.content)) {
                    const textContent = errorResult.content.find(content => content.type === 'text');
                    if (textContent && textContent.text) {
                      aiResponse = textContent.text;
                    }
                  }
                  break;
                }
                
                // Extract tool result text
                let toolResultText;
                if (toolResponse.content && Array.isArray(toolResponse.content)) {
                  if (toolResponse.content[0]?.text) {
                    toolResultText = toolResponse.content[0].text;
                  } else {
                    toolResultText = JSON.stringify(toolResponse.content[0] || toolResponse);
                  }
                } else {
                  toolResultText = JSON.stringify(toolResponse);
                }
                
                // Truncate tool result if too long
                const maxToolResultLength = 2000;
                if (toolResultText.length > maxToolResultLength) {
                  toolResultText = toolResultText.substring(0, maxToolResultLength) + '...\n\n[Tool result truncated]';
                }
                
                // Update conversation with tool result for potential next tool
                currentConversation = [
                  ...currentConversation,
                  {
                    role: 'assistant',
                    content: [content]
                  },
                  {
                    role: 'user',
                    content: [{
                      type: 'tool_result',
                      tool_use_id: content.id,
                      content: toolResultText
                    }]
                  }
                ];
                
                // Check if there are more tools to execute
                const remainingTools = aiResult.content.filter(c => c.type === 'tool_use' && c.id !== content.id);
                if (remainingTools.length > 0) {
                  console.log('WhatsApp: More tools to execute, continuing...');
                  continue; // Continue to next tool instead of breaking
                }
                
                // Get final response with all tool results
                const finalResult = await claudeService.getConversationResponse({
                  messages: currentConversation,
                  promptType: AppConfig.api.defaultPromptType,
                  tools: mcpClient.tools
                });
                
                // Extract final text response
                if (finalResult?.content && Array.isArray(finalResult.content)) {
                  const textContent = finalResult.content.find(content => content.type === 'text');
                  if (textContent && textContent.text) {
                    aiResponse = textContent.text;
                  }
                }
                
              } catch (toolError) {
                console.error('WhatsApp: Tool execution error:', toolError);
                
                // Create a conversation with the error for the AI to handle
                const errorConversation = [
                  ...currentConversation,
                  {
                    role: 'assistant',
                    content: [content]
                  },
                  {
                    role: 'user',
                    content: [{
                      type: 'tool_result',
                      tool_use_id: content.id,
                      content: `Error: ${toolError.message || 'Tool execution failed'}`
                    }]
                  }
                ];
                
                // Get AI response to handle the error
                const errorResult = await claudeService.getConversationResponse({
                  messages: errorConversation,
                  promptType: AppConfig.api.defaultPromptType,
                  tools: mcpClient.tools
                });
                
                // Extract error response
                if (errorResult?.content && Array.isArray(errorResult.content)) {
                  const textContent = errorResult.content.find(content => content.type === 'text');
                  if (textContent && textContent.text) {
                    aiResponse = textContent.text;
                  }
                }
                break;
              }
            }
          }
          
          // If no tools were used, extract text from original response
          if (!toolUsed) {
            if (aiResult.content && Array.isArray(aiResult.content)) {
              const textContent = aiResult.content.find(content => content.type === 'text');
              if (textContent && textContent.text) {
                aiResponse = textContent.text;
              }
            }
          }
        }
      } catch (error) {
        console.error('WhatsApp: Claude API error:', error);
        aiResponse = "Sorry, I'm having trouble processing your request right now. Please try again.";
      }
      
      console.log('WhatsApp: Final AI response length:', aiResponse.length);
      console.log('WhatsApp: Final AI response preview:', aiResponse.substring(0, 100) + '...');
      
      // Check if response is incomplete (ends with colon or incomplete sentence)
      let finalResponse = aiResponse;
      if (aiResponse.trim().endsWith(':') || aiResponse.trim().endsWith('...')) {
        console.log('WhatsApp: Detected incomplete response, adding completion prompt');
        finalResponse = aiResponse + '\n\nI apologize, but I need to complete that response. Let me provide you with the full information you requested.';
      }
      
      // Truncate response if it's too long for WhatsApp (4096 character limit)
      const maxWhatsAppLength = 4000; // Leave some buffer
      if (finalResponse.length > maxWhatsAppLength) {
        finalResponse = finalResponse.substring(0, maxWhatsAppLength) + '...\n\n[Message truncated due to length]';
        console.log('WhatsApp: Response truncated to', finalResponse.length, 'characters');
      }
      
      // Save AI response to database
      await saveMessage(conversationId, 'assistant', JSON.stringify(finalResponse));
      
      // Clean up old messages to prevent database bloat
      await cleanupOldMessages(conversationId, 10);
      
      // Send response back to WhatsApp
      await sendWhatsAppMessage(from, finalResponse);
      
      console.log('WhatsApp: Conversation completed successfully');
      
    } catch (error) {
      console.error('WhatsApp chat error:', error);
      await sendWhatsAppMessage(from, "Sorry, I'm having trouble accessing the store information right now. Please try again later.");
    }
  }
  
  return json({ success: true });
};

// WhatsApp webhook verification (GET request)
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}; 