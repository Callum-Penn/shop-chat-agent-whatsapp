import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";
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
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
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

export const action = async ({ request }) => {
  const body = await request.json();
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (message && message.text) {
    const userMessage = message.text.body;
    const from = message.from;
    
    // Use the phone number as conversation ID for WhatsApp
    const conversationId = `whatsapp_${from}`;
    
    try {
      // Initialize services
      const claudeService = createClaudeService();
      
      // HARDCODED: Use the actual store URL for now
      const shopDomain = 'https://ju3ntu-rn.myshopify.com';
      const shopId = 'ju3ntu-rn';
      
      // Get cached MCP client
      const mcpClient = await getCachedMCPClient(shopDomain, conversationId, shopId);
      
      // Save user message to database
      await saveMessage(conversationId, 'user', userMessage);
      
      // Get conversation history and truncate to reduce tokens
      const dbMessages = await getConversationHistory(conversationId, 6); // Limit to 6 messages
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
      
      // Get AI response with store context (non-streaming for WhatsApp)
      let aiResult = await claudeService.getConversationResponse({
        messages: conversationHistory,
        promptType: AppConfig.api.defaultPromptType,
        tools: mcpClient.tools
      });
      
      // Check if Claude wants to use tools and execute them
      if (aiResult?.content) {
        for (const content of aiResult.content) {
          if (content.type === "tool_use") {
            console.log('WhatsApp: Executing tool:', content.name);
            
            // Execute the tool
            const toolResponse = await mcpClient.callTool(content.name, content.input);
            console.log('WhatsApp: Tool response received');
            
            // Create a minimal conversation for the second API call (don't add to database)
            const toolConversation = [
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
                  content: toolResponse.content[0].text
                }]
              }
            ];
            
            // Get final response with tool results
            aiResult = await claudeService.getConversationResponse({
              messages: toolConversation,
              promptType: AppConfig.api.defaultPromptType,
              tools: mcpClient.tools
            });
            
            break; // Only handle the first tool use for now
          }
        }
      }
      
      const aiResponse = aiResult?.content?.[0]?.text || "Sorry, I couldn't generate a response.";
      
      // Save AI response to database
      await saveMessage(conversationId, 'assistant', JSON.stringify(aiResponse));
      
      // Clean up old messages to prevent database bloat
      await cleanupOldMessages(conversationId, 10);
      
      // Send response back to WhatsApp
      await sendWhatsAppMessage(from, aiResponse);
      
    } catch (error) {
      console.error('WhatsApp chat error:', error);
      await sendWhatsAppMessage(from, "Sorry, I'm having trouble accessing the store information right now. Please try again later.");
    }
  }
  
  return json({ status: "ok" });
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