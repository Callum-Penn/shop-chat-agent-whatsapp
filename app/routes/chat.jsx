/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 */
import { json } from "@remix-run/node";
import MCPClient from "../mcp-client";
import { 
  saveMessage, 
  getConversationHistory, 
  storeCustomerAccountUrl, 
  getCustomerAccountUrl,
  createOrGetUser,
  linkConversationToUser,
  getUserByShopifyCustomerId
} from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import { unauthenticated } from "../shopify.server";


/**
 * Remix loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return json(
    { error: AppConfig.errorMessages.apiUnsupported },
    { status: 400, headers: getCorsHeaders(request) }
  );
}

/**
 * Remix action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const messages = await getConversationHistory(conversationId);

  return json(
    { messages },
    { headers: getCorsHeaders(request) }
  );
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Get message data from request body
    const body = await request.json();
    const userMessage = body.message;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;
    const shopifyCustomerId = body.shopify_customer_id; // From frontend if customer is logged in

    // Create or link user if we have customer info
    try {
      await handleUserCreationAndLinking(conversationId, shopifyCustomerId, request);
    } catch (error) {
      console.error('Error handling user creation/linking:', error);
      // Continue even if user linking fails
    }

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        stream
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return json({ error: error.message }, {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  stream
}) {
  // Initialize services
  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");
  const customerMcpEndpoint = await getCustomerMcpEndpoint(shopDomain, conversationId);
  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    customerMcpEndpoint,
    'web' // Web chat channel - don't include send_order_template tool
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();

      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
      console.log('Available customer tools:', customerMcpTools.map(tool => tool.name));
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    // Prepare conversation state
    let conversationHistory = [];
    let productsToDisplay = [];

    // Save user message to the database
    await saveMessage(conversationId, 'user', userMessage);

    // Fetch all messages from the database for this conversation
    const dbMessages = await getConversationHistory(conversationId);

    // Format messages for Claude API
    conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
        console.log('Successfully parsed message content as JSON:', typeof content, Array.isArray(content));
        
        // If the parsed content is not an array, wrap it in a text block
        if (!Array.isArray(content)) {
          console.log('Parsed content is not an array, wrapping in text block. Content:', content);
          content = [{
            type: "text",
            text: String(content)
          }];
        }
      } catch (e) {
        // If JSON parsing fails, wrap the content in a text block format
        console.log('Failed to parse message content as JSON, wrapping in text block. Content:', dbMessage.content);
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

    // Clean conversation history to remove corrupted tool_use/tool_result pairs
    conversationHistory = cleanConversationHistory(conversationHistory);

    // Debug: Log the conversation history format
    console.log('Conversation history before sending to Claude:', JSON.stringify(conversationHistory, null, 2));

    // Execute the conversation stream
    let finalMessage = { 
      role: 'user', 
      content: [{
        type: "text",
        text: userMessage
      }]
    };

    while (finalMessage.stop_reason !== "end_turn") {
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });

            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // Call the tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle tool response based on success/error
            if (toolUseResponse.error) {
              const errorResult = await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
              
              // If authentication is required, stop the conversation
              if (errorResult && errorResult.stopConversation) {
                console.log("Authentication required, stopping conversation");
                // Signal end of turn immediately
                stream.sendMessage({ type: 'end_turn' });
                return;
              }
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    // Send product results if available
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });
    }
  } catch (error) {
    // The streaming handler takes care of error handling
    throw error;
  }
}

/**
 * Get the customer MCP endpoint for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP endpoint
 */
async function getCustomerMcpEndpoint(shopDomain, conversationId) {
  try {
    // Hardcode the customer MCP endpoint for vapelocal.co.uk
    if (shopDomain.includes('vapelocal.co.uk')) {
      console.log('Using hardcoded customer MCP endpoint for vapelocal.co.uk');
      return 'https://account.vapelocal.co.uk/customer/api/mcp';
    }

    // Check if the customer account URL exists in the DB
    const existingUrl = await getCustomerAccountUrl(conversationId);

    // If URL exists, return early with the MCP endpoint
    if (existingUrl) {
      return `${existingUrl}/customer/api/mcp`;
    }

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);
    const { storefront } = await unauthenticated.storefront(
      hostname
    );

    const response = await storefront.graphql(
      `#graphql
      query shop {
        shop {
          customerAccountUrl
        }
      }`,
    );

    const body = await response.json();
    const customerAccountUrl = body.data.shop.customerAccountUrl;

    // Store the customer account URL with conversation ID in the DB
    await storeCustomerAccountUrl(conversationId, customerAccountUrl);

    return `${customerAccountUrl}/customer/api/mcp`;
  } catch (error) {
    console.error("Error getting customer MCP endpoint:", error);
    return null;
  }
}

/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}

/**
 * Clean conversation history to remove corrupted tool_use/tool_result pairs
 * @param {Array} conversationHistory - The conversation history
 * @returns {Array} Cleaned conversation history
 */
function cleanConversationHistory(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return conversationHistory;
  }
  
  const cleaned = [];
  
  for (let i = 0; i < conversationHistory.length; i++) {
    const message = conversationHistory[i];
    
    if (!Array.isArray(message.content)) {
      cleaned.push(message);
      continue;
    }
    
    // If this is a user message with tool_result blocks, remove them
    // because they're meant to be paired with tool_use from previous assistant messages
    if (message.role === 'user') {
      const filteredContent = message.content.filter(block => {
        if (block.type === 'tool_result') {
          console.log('Removing tool_result from user message:', block.tool_use_id);
          return false;
        }
        return true;
      });
      
      if (filteredContent.length > 0) {
        cleaned.push({
          ...message,
          content: filteredContent
        });
      }
    } 
    // If this is an assistant message with tool_use blocks, remove them
    // because we don't have their corresponding tool_result yet
    else if (message.role === 'assistant') {
      const filteredContent = message.content.filter(block => {
        if (block.type === 'tool_use') {
          console.log('Removing orphaned tool_use from assistant message:', block.id);
          return false;
        }
        return true;
      });
      
      if (filteredContent.length > 0) {
        cleaned.push({
          ...message,
          content: filteredContent
        });
      }
    } else {
      cleaned.push(message);
    }
  }
  
  console.log(`Cleaned conversation history: ${conversationHistory.length} messages -> ${cleaned.length} messages`);
  
  return cleaned;
}

/**
 * Handle user creation and conversation linking
 * @param {string} conversationId - The conversation ID
 * @param {string} shopifyCustomerId - The Shopify customer ID (optional)
 * @param {Request} request - The request object
 */
async function handleUserCreationAndLinking(conversationId, shopifyCustomerId, request) {
  try {
    let user = null;

    // Determine if this is a web customer or anonymous user
    if (shopifyCustomerId) {
      // Try to find existing user by Shopify customer ID
      user = await getUserByShopifyCustomerId(shopifyCustomerId);
      
      if (!user) {
        // Create new user linked to Shopify customer
        user = await createOrGetUser({
          type: 'web',
          shopifyCustomerId: shopifyCustomerId,
          metadata: {
            firstSeen: new Date().toISOString(),
            source: 'web_chat'
          }
        });
        console.log('Created new web user for Shopify customer:', shopifyCustomerId);
      }
    } else if (conversationId.startsWith('web_anon_')) {
      // Anonymous web user - create or get user
      user = await createOrGetUser({
        type: 'web',
        metadata: {
          firstSeen: new Date().toISOString(),
          source: 'web_chat',
          anonymous: true
        }
      });
      console.log('Created anonymous web user');
    } else if (conversationId.startsWith('web_customer_')) {
      // Extract customer ID from conversation ID
      const extractedCustomerId = conversationId.replace('web_customer_', '');
      user = await getUserByShopifyCustomerId(extractedCustomerId);
      
      if (!user) {
        user = await createOrGetUser({
          type: 'web',
          shopifyCustomerId: extractedCustomerId,
          metadata: {
            firstSeen: new Date().toISOString(),
            source: 'web_chat'
          }
        });
      }
    }

    // Link conversation to user if we have one
    if (user) {
      await linkConversationToUser(conversationId, user.id, 'web');
      console.log('Linked conversation to user:', user.id);
    }
  } catch (error) {
    console.error('Error in handleUserCreationAndLinking:', error);
    throw error;
  }
}
