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
      
      // Initialize conversation state (like web chat)
      let productsToDisplay = [];
      let finalMessage = { role: 'user', content: userMessage };
      
      // Execute conversation loop (like web chat)
      while (finalMessage.stop_reason !== "end_turn") {
        console.log('WhatsApp: Starting conversation iteration');
        
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
          
          for (const content of aiResult.content) {
            if (content.type === "tool_use") {
              toolUsed = true;
              const toolName = content.name;
              const toolArgs = content.input;
              const toolUseId = content.id;
              
              console.log('WhatsApp: Executing tool:', toolName);
              console.log('WhatsApp: Tool arguments:', toolArgs);
              
              try {
                // Call the tool (like web chat)
                const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);
                
                // Handle tool response based on success/error (like web chat)
                if (toolUseResponse.error) {
                  console.log('WhatsApp: Tool error:', toolUseResponse.error);
                  await toolService.handleToolError(
                    toolUseResponse,
                    toolName,
                    toolUseId,
                    conversationHistory,
                    (message) => console.log('WhatsApp: Tool error message:', message),
                    conversationId
                  );
                } else {
                  console.log('WhatsApp: Tool success');
                  await toolService.handleToolSuccess(
                    toolUseResponse,
                    toolName,
                    toolUseId,
                    conversationHistory,
                    productsToDisplay,
                    conversationId
                  );
                }
                
                // Continue the conversation loop
                finalMessage = { role: 'assistant', content: aiResult.content, stop_reason: 'tool_use' };
                break;
                
              } catch (toolError) {
                console.error('WhatsApp: Tool execution error:', toolError);
                // Continue with the original response if tool execution fails
                break;
              }
            }
          }
          
          // If no tools were used, this is the final response
          if (!toolUsed) {
            finalMessage = { role: 'assistant', content: aiResult.content, stop_reason: 'end_turn' };
          }
        } else {
          // No content in response, end the turn
          finalMessage = { role: 'assistant', content: [], stop_reason: 'end_turn' };
        }
      }
      
      // Extract the final text response
      let aiResponse = "Sorry, I couldn't generate a response.";
      
      if (finalMessage.content && Array.isArray(finalMessage.content)) {
        const textContent = finalMessage.content.find(content => content.type === 'text');
        if (textContent && textContent.text) {
          aiResponse = textContent.text;
        }
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