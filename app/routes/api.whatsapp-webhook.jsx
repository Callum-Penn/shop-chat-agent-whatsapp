import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import MCPClient from "../mcp-client";
import AppConfig from "../services/config.server";
import { generateAuthUrl } from "../auth.server";
import { sendWhatsAppMessage, downloadWhatsAppMedia, sendWhatsAppDocumentFromUrl } from "../utils/whatsapp.server";
import { sendEmail, generateHandoffEmailHTML, generateHandoffEmailText, generateSpreadsheetEmailHTML, generateSpreadsheetEmailText } from "../utils/email.server";

// Cache for MCP connections to avoid reconnecting on every message
const mcpCache = new Map();

// Helper to get or create cached MCP client
async function getCachedMCPClient(shopDomain, conversationId, shopId) {
  const cacheKey = `${shopDomain}_${shopId}_${conversationId}`;
  
  if (mcpCache.has(cacheKey)) {
    return mcpCache.get(cacheKey);
  }
  
  // Hardcode customer MCP endpoint for vapelocal.co.uk
  let customerMcpEndpoint = null;
  if (shopDomain.includes('vapelocal.co.uk')) {
    customerMcpEndpoint = 'https://account.vapelocal.co.uk/customer/api/mcp';
  }
  
  const mcpClient = new MCPClient(shopDomain, conversationId, shopId, customerMcpEndpoint, 'whatsapp');
  
  // Connect to MCP servers once and cache
  try {
    await mcpClient.connectToStorefrontServer();
    await mcpClient.connectToCustomerServer();
    
    mcpCache.set(cacheKey, mcpClient);
    return mcpClient;
  } catch (error) {
    console.warn('WhatsApp: Failed to connect to MCP servers:', error.message);
    return mcpClient; // Return client even if connection fails
  }
}

// Helper to parse cart payloads from MCP responses
function parseCartPayload(toolResponse) {
  if (!toolResponse) return null;
  let payload = toolResponse;
  if (Array.isArray(toolResponse.content) && toolResponse.content[0]) {
    const block = toolResponse.content[0];
    if (typeof block.text !== 'undefined') {
      payload = block.text;
    } else {
      payload = block;
    }
  }
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

// Helper to summarize cart lines for user-facing confirmations
function summarizeCartLines(cart) {
  if (!cart || !Array.isArray(cart.lines)) {
    return '';
  }
  const summaries = cart.lines.map((line) => {
    const qty = line.quantity ?? line.merchandise?.quantity ?? null;
    const title = line.merchandise?.product?.title || line.merchandise?.title || 'item';
    if (qty && title) {
      return `${qty} × ${title}`;
    }
    if (title) {
      return title;
    }
    return null;
  }).filter(Boolean);
  return summaries.length ? summaries.join(', ') : '';
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

// Helper to generate conversation summary for handoff emails
function generateConversationSummary(messages, reason) {
  let summary = '';
  
  if (reason) {
    summary += `Reason: ${reason}\n\n`;
  }
  
  summary += 'Conversation Summary:\n';
  
  // Extract last few user messages to understand the issue
  const userMessages = messages.filter(msg => msg.role === 'user').slice(-3);
  if (userMessages.length > 0) {
    summary += '\nCustomer\'s concerns:\n';
    userMessages.forEach((msg, idx) => {
      let content = '';
      if (Array.isArray(msg.content)) {
        content = msg.content.map(c => c.text || c.type).join(' ');
      } else {
        content = msg.content;
      }
      summary += `${idx + 1}. ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n`;
    });
  }
  
  return summary;
}

export const action = async ({ request }) => {
  // Import database functions inside the action to avoid client/server separation issues
  const { 
    saveMessage, 
    getConversationHistory, 
    cleanupOldMessages, 
    getCustomerToken,
    createOrGetUser,
    linkConversationToUser,
    getUserByPhoneNumber,
    deleteConversationHistory,
    updateConversationMetadata
  } = await import("../db.server");
  
  const body = await request.json();
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  // Handle images, videos, audio - reject with explanation
  if (message && (message.image || message.video || message.audio)) {
    const from = message.from;
    const mediaType = message.image ? 'image' : message.video ? 'video' : 'audio';
    
    console.warn(`WhatsApp: Unsupported ${mediaType} received from ${from} - rejecting`);
    
    await sendWhatsAppMessage(
      from,
      "📄 Sorry, I can only accept spreadsheet files (.xlsx, .xls, .csv).\n\n" +
      "Please send your data as an Excel or CSV file. Images, videos, and audio files are not supported."
    );
    
    return json({ success: true, message: 'Unsupported media type rejected' });
  }
  
  // Handle document messages - only accept spreadsheets
  if (message && message.document) {
    const document = message.document;
    const from = message.from;
    const caption = message.caption || '';
    
    // Define allowed spreadsheet MIME types
    const allowedSpreadsheetTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv', // .csv (alternative)
      'text/comma-separated-values' // .csv (alternative)
    ];
    
    // Check if the file is a spreadsheet
    const isSpreadsheet = allowedSpreadsheetTypes.includes(document.mime_type) ||
                         document.filename?.toLowerCase().endsWith('.xlsx') ||
                         document.filename?.toLowerCase().endsWith('.xls') ||
                         document.filename?.toLowerCase().endsWith('.csv');
    
    if (!isSpreadsheet) {
      console.warn('WhatsApp: Non-spreadsheet document rejected:', document.mime_type);
      await sendWhatsAppMessage(
        from,
        "📄 Sorry, I can only accept spreadsheet files.\n\n" +
        "✅ Supported formats:\n" +
        "• Excel files (.xlsx, .xls)\n" +
        "• CSV files (.csv)\n\n" +
        "❌ Your file type is not supported.\n\n" +
        "Please convert your file to one of the supported formats and send it again."
      );
      
      return json({ success: true, message: 'Non-spreadsheet document rejected' });
    }
    
    try {
      // Download the file from WhatsApp
      const fileData = await downloadWhatsAppMedia(document.id);
      
      // Get support email from environment
      const supportEmail = process.env.SUPPORT_EMAIL || 'support@vapelocal.co.uk';
      
      // Prepare email data
      const fileSizeKB = Math.round(fileData.fileSize / 1024);
      const emailSubject = `New Spreadsheet Order Submission - ${document.filename}`;
      
      // Convert buffer to base64 for email attachment (Resend accepts base64 strings)
      const fileBase64 = fileData.buffer.toString('base64');
      
      // Send email with attachment
      await sendEmail({
        to: supportEmail,
        subject: emailSubject,
        html: generateSpreadsheetEmailHTML({
          customerPhone: from,
          filename: document.filename,
          fileType: fileData.mimeType,
          fileSize: `${fileSizeKB}KB`,
          caption: caption || null
        }),
        text: generateSpreadsheetEmailText({
          customerPhone: from,
          filename: document.filename,
          fileType: fileData.mimeType,
          fileSize: `${fileSizeKB}KB`,
          caption: caption || null
        }),
        attachments: [{
          filename: document.filename,
          content: fileBase64,
          type: fileData.mimeType
        }]
      });
      
      // Send confirmation to customer
      await sendWhatsAppMessage(
        from, 
        "✅ Thank you! Your file has been received and sent to our team. Someone will review it shortly."
      );
      
      // Save the interaction to database
      const conversationId = `whatsapp_${from}`;
      await saveMessage(conversationId, 'user', `[Document: ${document.filename}]`);
      await saveMessage(conversationId, 'assistant', 'File received and sent to team via email.');
      
      return json({ success: true, message: 'Document sent via email successfully' });
      
    } catch (error) {
      console.error('WhatsApp: Error processing document:', error);
      await sendWhatsAppMessage(from, "❌ Sorry, there was an error processing your file. Please try again later.");
      return json({ success: false, error: error.message });
    }
  }
  
  // Handle text messages
  if (message && message.text) {
    const userMessage = message.text.body;
    const from = message.from;
    
    // Use the phone number as conversation ID for WhatsApp
    const conversationId = `whatsapp_${from}`;
    
    // Early command handling: allow user to reset chat via simple commands
    try {
      const normalized = (userMessage || '').trim().toLowerCase();
      const resetIntents = [
        /^\/?reset(\s+(chat|conversation))?$/, // reset, /reset, reset chat
        /^(clear|restart)(\s+(chat|conversation))?$/, // clear chat, restart conversation
        /^(start\s+over|start\s+again|new\s+chat|new\s+conversation)$/
      ];
      const shouldReset = resetIntents.some((rx) => rx.test(normalized)) ||
        normalized.includes('reset chat') || normalized.includes('clear chat');
      if (shouldReset) {
        try {
          await deleteConversationHistory(conversationId);
          await updateConversationMetadata(conversationId, {
            handoff_requested: false,
            handoff_at: null,
            last_cart_id: null,
            last_checkout_url: null,
            last_cart_updated_at: null
          });
          await sendWhatsAppMessage(from, 'I\'ve cleared our chat and reset your cart. How can I help now?');
          return json({ success: true, message: 'Conversation reset' });
        } catch (resetErr) {
          console.error('WhatsApp: Error resetting conversation:', resetErr);
          await sendWhatsAppMessage(from, '❌ Sorry, I couldn\'t reset our chat right now. Please try again.');
          return json({ success: false, error: 'Reset failed' });
        }
      }
    } catch (cmdErr) {
      console.warn('WhatsApp: Command handling error:', cmdErr);
      // continue to normal flow
    }

    try {
      console.log(`[WHATSAPP][IN] (${conversationId}) ${userMessage}`);
      
      // Create or get WhatsApp user
      try {
        let user = await getUserByPhoneNumber(from);
        if (!user) {
          user = await createOrGetUser({
            type: 'whatsapp',
            phoneNumber: from,
            metadata: {
              firstSeen: new Date().toISOString(),
              source: 'whatsapp'
            }
          });
        }
        
        // Link conversation to user
        await linkConversationToUser(conversationId, user.id, 'whatsapp');
      } catch (userError) {
        console.error('WhatsApp: Error handling user:', userError);
        // Continue even if user creation fails
      }
      
      // Initialize services
      const claudeService = createClaudeService();
      const toolService = createToolService();
      
      // HARDCODED: Use the actual store URL for now
      const shopDomain = 'https://vapelocal.co.uk';
      const shopId = 'vapelocal';
      
      // Allowed host for checkout links
      let allowedHost = '';
      try { allowedHost = new URL(shopDomain).host; } catch {}
      const urlRegex = /(https?:\/\/[^\s)]+)\)?/gi;
      
      // Get cached MCP client
      const mcpClient = await getCachedMCPClient(shopDomain, conversationId, shopId);
      
      // Save user message to database
      await saveMessage(conversationId, 'user', userMessage);
      
      // Get conversation history and truncate to reduce tokens
      const MAX_HISTORY_MESSAGES = 10;
      const dbMessages = await getConversationHistory(conversationId, MAX_HISTORY_MESSAGES);
      let conversationHistory = dbMessages.map(dbMessage => {
        let content;
        try {
          content = JSON.parse(dbMessage.content);
          if (!Array.isArray(content)) {
            content = [{
              type: "text",
              text: String(content)
            }];
          }
        } catch (e) {
          // If JSON parsing fails, wrap the content in a text block format
          content = [{
            type: "text",
            text: dbMessage.content
          }];
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
      const MAX_CONVERSATION_MESSAGES = 10; // Limit conversation history to prevent unbounded growth
      
      // Track whether checkout URL was generated this turn
      let checkoutLinkAuthorized = false;
      let lastCartSummary = null;
      
      try {
        while (!conversationComplete && turnCount < maxTurns) {
          turnCount++;
          
          // Truncate conversation history before each API call to prevent unbounded growth
          const truncatedHistory = truncateConversationHistory(conversationHistory, MAX_CONVERSATION_MESSAGES);
          
          // Get AI response with current conversation context
          const aiResult = await claudeService.getConversationResponse({
            messages: truncatedHistory,
            promptType: AppConfig.api.defaultPromptType,
            tools: mcpClient.tools
          });
          
          // Check if Claude wants to use tools
          if (aiResult?.content) {
            let toolUsed = false;
            
            for (const content of aiResult.content) {
              if (content.type === "tool_use") {
                toolUsed = true;
                const toolName = content.name;
                const toolArgs = content.input;
                
                try {
                  // Call the tool directly
                  const toolResponse = await mcpClient.callTool(toolName, toolArgs);
                  
                  // If checkout URL successfully generated, authorize links this turn
                  if (!toolResponse.error && toolName === 'get_cart') {
                    checkoutLinkAuthorized = true;
                  }
                  
                  // Handle custom tools (like send_order_template)
                  if (toolResponse.isCustomTool && toolName === 'send_order_template') {
                    const templateType = toolArgs.template_type || 'general';
                    const customMessage = toolArgs.message || '';
                    
                    // Get template URL from environment based on type
                    const templateUrl = templateType === 'bestsellers' 
                      ? process.env.ORDER_TEMPLATE_BESTSELLERS_URL 
                      : process.env.ORDER_TEMPLATE_GENERAL_URL;
                    
                    if (!templateUrl) {
                      console.error('WhatsApp: Template URL not configured for type:', templateType);
                      aiResponse = "I apologize, but the order template is not currently available. Please contact our team directly.";
                      conversationComplete = true;
                      break;
                    }
                    
                    try {
                      // Send the template document
                      const filename = templateType === 'bestsellers' 
                        ? 'bestsellers-order-form.xlsx' 
                        : 'order-form.xlsx';
                      
                      const caption = customMessage || 
                        "📄 Here's your order form!\n\n" +
                        "1. Fill in your business details\n" +
                        "2. Enter quantities for products you want\n" +
                        "3. Send the completed form back to me";
                      
                      await sendWhatsAppDocumentFromUrl(from, templateUrl, filename, caption);
                      
                      // Update conversation with success
                      conversationHistory.push({
                        role: 'assistant',
                        content: [content]
                      });
                      conversationHistory.push({
                        role: 'user',
                        content: [{
                          type: 'tool_result',
                          tool_use_id: content.id,
                          content: `Order template sent successfully to customer via WhatsApp.`
                        }]
                      });
                      
                      // Continue to next turn for Claude to respond
                      break;
                      
                    } catch (templateError) {
                      console.error('WhatsApp: Failed to send template:', templateError);
                      aiResponse = "I apologize, but I couldn't send the order template. Please try again later.";
                      conversationComplete = true;
                      break;
                    }
                  }
                  
                  // Handle escalate_to_customer_service custom tool
                  if (toolResponse.isCustomTool && toolName === 'escalate_to_customer_service') {
                    // Check if a handoff has already been requested
                    const { getConversation, updateConversationMetadata } = await import("../db.server");
                    const conversation = await getConversation(conversationId);
                    const handoffRequested = conversation?.metadata?.handoff_requested === true;
                    const handoffAt = conversation?.metadata?.handoff_at;
                    
                    // Allow new ticket if 24 hours have passed since last handoff
                    const HANDOFF_COOLDOWN_HOURS = 24;
                    let allowNewTicket = false;
                    
                    if (handoffRequested && handoffAt) {
                      const handoffTime = new Date(handoffAt);
                      const hoursSinceHandoff = (Date.now() - handoffTime.getTime()) / (1000 * 60 * 60);
                      
                      if (hoursSinceHandoff >= HANDOFF_COOLDOWN_HOURS) {
                        allowNewTicket = true;
                        // Clear the old handoff flag
                        await updateConversationMetadata(conversationId, {
                          handoff_requested: false,
                          handoff_at: null
                        });
                      }
                    }
                    
                    if (handoffRequested && !allowNewTicket) {
                      console.warn('WhatsApp: Handoff already requested for this conversation');
                      
                      // Return message to user via WhatsApp
                      aiResponse = "I've already created a support ticket for you. Our customer service team will be in touch soon. If you still need help after 24 hours, you can request another ticket.";
                      conversationComplete = true;
                      break;
                    }
                    
                    const { customer_name, customer_email, customer_phone, reason } = toolArgs;
                    
                    try {
                      // Get conversation history for summary
                      const dbMessages = await getConversationHistory(conversationId, 20);
                      const lastMessages = dbMessages.slice(-10).map(msg => ({
                        role: msg.role,
                        content: msg.content
                      }));
                      
                      // Generate conversation summary from recent messages
                      const conversationSummary = generateConversationSummary(lastMessages, reason);
                      
                      // Send email to customer service
                      const supportEmail = process.env.SUPPORT_EMAIL || 'support@vapelocal.co.uk';
                      await sendEmail({
                        to: supportEmail,
                        subject: `New Customer Service Handoff - WhatsApp Chat`,
                        html: generateHandoffEmailHTML({
                          customerName: customer_name,
                          customerEmail: customer_email,
                          customerPhone: customer_phone,
                          channel: 'whatsapp',
                          conversationId,
                          conversationSummary,
                          lastMessages
                        }),
                        text: generateHandoffEmailText({
                          customerName: customer_name,
                          customerEmail: customer_email,
                          customerPhone: customer_phone,
                          channel: 'whatsapp',
                          conversationId,
                          conversationSummary,
                          lastMessages
                        })
                      });
                      
                      // Update user info in database
                      const { getUserByPhoneNumber, updateUser } = await import("../db.server");
                      const user = await getUserByPhoneNumber(from);
                      if (user) {
                        await updateUser(user.id, {
                          name: customer_name,
                          email: customer_email
                        });
                      }
                      
                      // Mark conversation metadata
                      const { updateConversationMetadata } = await import("../db.server");
                      await updateConversationMetadata(conversationId, {
                        handoff_requested: true,
                        handoff_at: new Date().toISOString()
                      });
                      
                      // Update conversation history
                      conversationHistory.push({
                        role: 'assistant',
                        content: [content]
                      });
                      conversationHistory.push({
                        role: 'user',
                        content: [{
                          type: 'tool_result',
                          tool_use_id: content.id,
                          content: `Customer service handoff completed. Email sent to ${supportEmail}.`
                        }]
                      });
                      
                      aiResponse = "Thank you for providing your details. I've notified our customer service team and they'll contact you shortly. Your reference is: " + conversationId;
                      conversationComplete = true;
                      break;
                      
                    } catch (handoffError) {
                      console.error('WhatsApp: Failed to process handoff:', handoffError);
                      aiResponse = "I apologize, but I couldn't process your request to speak with our team. Please contact support directly or try again later.";
                      conversationComplete = true;
                      break;
                    }
                  }
                  
                  // Check if tool execution was successful
                  if (toolResponse.error) {
                    console.warn('WhatsApp: Tool returned error:', toolResponse.error);
                    
                    // Handle authentication errors specifically
                    if (toolResponse.error.type === 'auth_required') {
                      console.warn('WhatsApp: Authentication required for customer tool');
                      
                      // Generate authentication URL using the same callback for both web and WhatsApp
                      try {
                        const authResponse = await generateAuthUrl(conversationId, shopId);
                        
                        // Send authentication message to WhatsApp
                        const authMessage = `To access your order information, please authorize the app by clicking this link: ${authResponse.url}\n\nAfter authorizing, please send me a message and I'll be able to help you with your orders.`;
                        await sendWhatsAppMessage(from, authMessage);
                        
                        // Save the authentication request
                        await saveMessage(conversationId, 'assistant', JSON.stringify(authMessage));
                        
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

                  // If this was a cart update, automatically fetch and send a checkout link
                  if (toolName === 'update_cart') {
                    try {
                      const parsedPayload = parseCartPayload(toolResponse);
                      if (parsedPayload?.cart) {
                        const summary = summarizeCartLines(parsedPayload.cart);
                        if (summary) {
                          lastCartSummary = summary;
                        }
                      }
                    } catch (summErr) {
                      console.warn('WhatsApp: Failed to summarize cart lines:', summErr);
                    }
                    try {
                      const { getConversation } = await import("../db.server");
                      const conv = await getConversation(conversationId);
                      const lastCartId = conv?.metadata?.last_cart_id;
                      const argsPrimary = lastCartId ? { cart_id: lastCartId } : {};
                      const toStoreHost = (href) => { try { const u = new URL(href); u.protocol = 'https:'; if (allowedHost) u.host = allowedHost; return u.toString(); } catch { return href; } };
                      let url;
                      console.warn(`[CHECKOUT][AUTO][WA] update_cart success; attempting get_cart with cart_id=${argsPrimary.cart_id || 'none'}`);
                      try {
                        const gr = await mcpClient.callTool('get_cart', argsPrimary);
                        if (!gr.error) {
                          let gp = Array.isArray(gr.content) ? gr.content[0]?.text : gr;
                          try { if (typeof gp === 'string') gp = JSON.parse(gp); } catch {}
                          let candidate = gp?.checkout_url || gp?.checkoutUrl || (gp?.cart && (gp.cart.checkout_url || gp.cart.checkoutUrl));
                          if (candidate) {
                            url = toStoreHost(candidate);
                          }
                          console.warn(`[CHECKOUT][AUTO][WA] get_cart returned url=${candidate ? 'yes' : 'no'}`);
                        }
                      } catch (e2) {
                        console.warn('WhatsApp auto-checkout-link get_cart failed:', e2?.message || e2);
                      }
                      if (!url) {
                        let metaUrl = conv?.metadata?.last_checkout_url || null;
                        if (metaUrl) {
                          url = toStoreHost(metaUrl);
                          console.warn('[CHECKOUT][AUTO][WA] Using cached checkout URL from conversation metadata');
                        }
                      }
                      if (url) {
                        checkoutLinkAuthorized = true;
                        const summaryText = lastCartSummary
                          ? `Cart updated (${lastCartSummary}). `
                          : 'Cart updated. ';
                        aiResponse = `${summaryText}Here’s your checkout link: ${url}`;
                        conversationComplete = true;
                        break;
                      } else {
                        console.warn('[CHECKOUT][AUTO][WA] No checkout URL available after update_cart');
                      }
                    } catch (autoErr) {
                      console.warn('WhatsApp auto-checkout-link fetch failed:', autoErr?.message || autoErr);
                    }
                  }
                  
                  // Continue to next turn to see if AI wants to use more tools
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
        
        // Sanitize unauthorized/foreign checkout links before sending
        if (aiResponse) {
          aiResponse = aiResponse.replace(urlRegex, (match) => {
            try {
              const u = new URL(match);
              const isAllowed = allowedHost && u.host === allowedHost;
              return isAllowed ? match : '';
            } catch {
              return match;
            }
          });
        }
        
        if (turnCount >= maxTurns) {
          // Conversation loop safeguards keep responses bounded; no log needed here.
        }
        
      } catch (error) {
        console.error('WhatsApp: Claude API error:', error);
        aiResponse = "Sorry, I'm having trouble processing your request right now. Please try again.";
      }
      
      // Check if response is incomplete (ends with colon or incomplete sentence)
      let finalResponse = aiResponse;
      if (aiResponse.trim().endsWith(':') || aiResponse.trim().endsWith('...')) {
        finalResponse = aiResponse + '\n\nI apologize, but I need to complete that response. Let me provide you with the full information you requested.';
      }
      
      // Truncate response if it's too long for WhatsApp (4096 character limit)
      const maxWhatsAppLength = 4000; // Leave some buffer
      if (finalResponse.length > maxWhatsAppLength) {
        finalResponse = finalResponse.substring(0, maxWhatsAppLength) + '...\n\n[Message truncated due to length]';
      }
      
      // Save AI response to database
      await saveMessage(conversationId, 'assistant', JSON.stringify(finalResponse));
      
      // Clean up old messages to prevent database bloat
      await cleanupOldMessages(conversationId, 10);
      
      // Send response back to WhatsApp
      await sendWhatsAppMessage(from, finalResponse);
      
      const responsePreview = finalResponse.length > 500
        ? `${finalResponse.substring(0, 500)}…`
        : finalResponse;
      console.log(`[WHATSAPP][OUT] (${conversationId}) ${responsePreview}`);
      
    } catch (error) {
      console.error('WhatsApp chat error:', error);
      await sendWhatsAppMessage(from, "Sorry, I'm having trouble accessing the store information right now. Please try again later.");
    }
  }
  
  // Handle stickers, contacts, locations, and other unsupported message types
  if (message && !message.text && !message.document && !message.image && !message.video && !message.audio) {
    const from = message.from;
    const messageType = message.type || 'unknown';
    
    console.warn(`WhatsApp: Unsupported message type '${messageType}' received from ${from}`);
    
    await sendWhatsAppMessage(
      from,
      "I can help you via text messages or spreadsheet files.\n\n" +
      "📄 To send a spreadsheet: Attach an Excel (.xlsx, .xls) or CSV file\n" +
      "💬 To chat: Send me a text message"
    );
    
    return json({ success: true, message: 'Unsupported message type' });
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