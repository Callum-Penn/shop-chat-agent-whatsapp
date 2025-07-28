import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import { saveMessage, getConversationHistory } from "../db.server";
import MCPClient from "../mcp-client";
import AppConfig from "../services/config.server";
import prisma from "../db.server";

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
      const toolService = createToolService();
      
      // Get the shop domain and shop ID from the database (from the first installed session)
      let shopDomain = 'your-store.myshopify.com'; // fallback
      let shopId = null;
      try {
        const sessions = await prisma.session.findMany({
          orderBy: {
            createdAt: 'desc'
          }
        });
        
        // Find the first session with a valid shop domain
        const session = sessions.find(s => s.shop && s.shop !== null && s.shop !== '');
        
        if (session && session.shop) {
          shopDomain = session.shop;
          shopId = session.id; // Use session ID as shop ID
          console.log('WhatsApp: Using shop domain from database:', shopDomain);
          console.log('WhatsApp: Using shop ID from database:', shopId);
        } else {
          console.warn('WhatsApp: No shop domain found in database, using fallback');
        }
      } catch (error) {
        console.error('WhatsApp: Error getting shop domain from database:', error);
      }
      
      // Initialize MCP client for store access
      const mcpClient = new MCPClient(
        shopDomain,
        conversationId,
        shopId, // Now we have the shop ID
        null  // customerMcpEndpoint
      );
      
      // Save user message to database
      await saveMessage(conversationId, 'user', userMessage);
      
      // Get conversation history
      const dbMessages = await getConversationHistory(conversationId);
      const conversationHistory = dbMessages.map(dbMessage => {
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
      
      // Try to connect to MCP servers for store data
      let storefrontMcpTools = [], customerMcpTools = [];
      try {
        console.log('WhatsApp: Attempting to connect to MCP servers...');
        storefrontMcpTools = await mcpClient.connectToStorefrontServer();
        console.log(`WhatsApp: Connected to storefront MCP with ${storefrontMcpTools.length} tools`);
        
        customerMcpTools = await mcpClient.connectToCustomerServer();
        console.log(`WhatsApp: Connected to customer MCP with ${customerMcpTools.length} tools`);
        
        console.log('WhatsApp: Total MCP tools available:', mcpClient.tools.length);
        console.log('WhatsApp: MCP tool names:', mcpClient.tools.map(tool => tool.name));
      } catch (error) {
        console.warn('WhatsApp: Failed to connect to MCP servers, continuing without tools:', error.message);
      }
      
      // Get AI response with store context
      const aiResult = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType: AppConfig.api.defaultPromptType,
          tools: mcpClient.tools
        },
        {}
      );
      
      const aiResponse = aiResult?.content?.[0]?.text || "Sorry, I couldn't generate a response.";
      
      // Save AI response to database
      await saveMessage(conversationId, 'assistant', JSON.stringify(aiResponse));
      
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