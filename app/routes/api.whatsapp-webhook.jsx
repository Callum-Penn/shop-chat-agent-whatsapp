import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import MCPClient from "../mcp-client";
import AppConfig from "../services/config.server";
import { generateAuthUrl } from "../auth.server";
import { sendWhatsAppMessage } from "../utils/whatsapp.server";

// Cache for MCP connections to avoid reconnecting on every message
const mcpCache = new Map();

// Helper to get or create cached MCP client
async function getCachedMCPClient(shopDomain, conversationId, shopId) {
  const cacheKey = `${shopDomain}_${shopId}`;
  
  if (mcpCache.has(cacheKey)) {
    return mcpCache.get(cacheKey);
  }
  
  // Hardcode customer MCP endpoint for vapelocal.co.uk
  let customerMcpEndpoint = null;
  if (shopDomain.includes('vapelocal.co.uk')) {
    customerMcpEndpoint = 'https://account.vapelocal.co.uk/customer/api/mcp';
    console.log('WhatsApp: Using hardcoded customer MCP endpoint for vapelocal.co.uk');
  }
  
  const mcpClient = new MCPClient(shopDomain, conversationId, shopId, customerMcpEndpoint);
  
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
  // Import database functions inside the action to avoid client/server separation issues
  const { saveMessage, getConversationHistory, cleanupOldMessages, getCustomerToken } = await import("../db.server");
  
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
      const shopDomain = 'https://vapelocal.co.uk';
      const shopId = 'vapelocal';
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
      
      // Multi-turn conversation loop (matching web chat behavior)
      let aiResponse = "Sorry, I couldn't generate a response.";
      let conversationComplete = false;
      let maxTurns = 5; // Prevent infinite loops
      let turnCount = 0;
      
      try {
        while (!conversationComplete && turnCount < maxTurns) {
          turnCount++;
          console.log(`WhatsApp: Conversation turn ${turnCount}`);
          
          // Get AI response with current conversation context
          const aiResult = await claudeService.getConversationResponse({
            messages: conversationHistory,
            promptType: AppConfig.api.defaultPromptType,
            tools: mcpClient.tools
          });
          
          console.log('WhatsApp: AI response received for turn', turnCount);
          
          // Check if Claude wants to use tools
          if (aiResult?.content) {
            let toolUsed = false;
            
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
                    
                    // Handle authentication errors specifically
                    if (toolResponse.error.type === 'auth_required') {
                      console.log('WhatsApp: Authentication required for customer tool');
                      
                      // Generate authentication URL with WhatsApp-specific callback
                      try {
                        // Ensure no double slash by removing trailing slash from base URL
                        const baseUrl = process.env.SHOPIFY_APP_URL.replace(/\/$/, '');
                        const authResponse = await generateAuthUrl(conversationId, shopId, `${baseUrl}/api/whatsapp-auth-callback`);
                        console.log('WhatsApp: Generated auth URL:', authResponse.url);
                        
                        // Send authentication message to WhatsApp
                        const authMessage = `To access your order information, please authorize the app by clicking this link: ${authResponse.url}\n\nAfter authorizing, please send me a message and I'll be able to help you with your orders.`;
                        await sendWhatsAppMessage(from, authMessage);
                        
                        // Save the authentication request
                        await saveMessage(conversationId, 'assistant', JSON.stringify(authMessage));
                        
                        console.log('WhatsApp: Authentication message sent to user');
                        return json({ success: true });
                      } catch (authError) {
                        console.error('WhatsApp: Failed to generate auth URL:', authError);
                        aiResponse = "I need to access your account information, but I'm having trouble setting up the authorization. Please try again later or contact support.";
                        conversationComplete = true;
                        break;
                      }
                    } else {
                      // Handle other tool errors
                      const errorConversation = [
                        ...conversationHistory,
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
                      conversationComplete = true;
                      break;
                    }
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
                  
                  // Update conversation with tool result for next turn
                  conversationHistory.push({
                    role: 'assistant',
                    content: [content]
                  });
                  conversationHistory.push({
                    role: 'user',
                    content: [{
                      type: 'tool_result',
                      tool_use_id: content.id,
                      content: toolResultText
                    }]
                  });
                  
                  // Continue to next turn to see if AI wants to use more tools
                  console.log('WhatsApp: Tool executed, continuing to next turn...');
                  break; // Break out of tool loop, continue to next conversation turn
                  
                } catch (toolError) {
                  console.error('WhatsApp: Tool execution error:', toolError);
                  
                  // Create a conversation with the error for the AI to handle
                  const errorConversation = [
                    ...conversationHistory,
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
                  conversationComplete = true;
                  break;
                }
              }
            }
            
            // If no tools were used, this is the final response
            if (!toolUsed) {
              console.log('WhatsApp: No tools used, extracting final response');
              if (aiResult.content && Array.isArray(aiResult.content)) {
                const textContent = aiResult.content.find(content => content.type === 'text');
                if (textContent && textContent.text) {
                  aiResponse = textContent.text;
                }
              }
              conversationComplete = true;
            }
          } else {
            // No content in response, conversation is complete
            conversationComplete = true;
          }
        }
        
        if (turnCount >= maxTurns) {
          console.log('WhatsApp: Max turns reached, using last response');
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