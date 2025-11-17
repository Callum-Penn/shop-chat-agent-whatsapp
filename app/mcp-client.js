import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";
import prisma from "./db.server";

const EXCLUDED_MCP_TOOLS = new Set([
  "get_store_credit_balances",
  "request_return"
]);

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 */
class MCPClient {
  /**
   * Creates a new MCPClient instance.
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   * @param {string} customerMcpEndpoint - Customer MCP endpoint
   * @param {string} channel - Channel type: 'web' or 'whatsapp'
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint, channel = 'web') {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];
    this.lastCartId = null;
    this.lastCheckoutUrl = null;

    // Add custom tools that aren't from MCP servers
    // Only add send_order_template for WhatsApp channel
    this.customTools = [];
    
    if (channel === 'whatsapp') {
      this.customTools.push({
        name: "send_order_template",
        description: "Send a spreadsheet order template to the customer via WhatsApp. Use this when customers ask about bestsellers, want to place bulk orders, or need an order form. The template includes business details fields and a product list where they can enter quantities.",
        input_schema: {
          type: "object",
          properties: {
            template_type: {
              type: "string",
              enum: ["bestsellers", "general"],
              description: "Type of template to send: 'bestsellers' for pre-filled bestseller products, 'general' for blank order form"
            },
            message: {
              type: "string",
              description: "Optional custom message to include with the template"
            }
          },
          required: ["template_type"]
        }
      });
    }
    
    this.customTools.push({
      name: "validate_product_quantity",
      description: "Check if a product has quantity requirements (minimum or increment). ALWAYS call this before adding products to cart. If a quantity_increment exists, you MUST use that value or a multiple of it as the quantity. Example: if increment is 5, use 5, 10, 15, etc.",
      input_schema: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "The product ID to check (can be GID or product title)"
          },
          product_title: {
            type: "string",
            description: "Optional product title to check if ID not found"
          },
          variant_id: {
            type: "string",
            description: "Optional variant ID to check variant-level increment"
          }
        },
        required: ["product_id"]
      }
    });
    
    // Add escalate_to_customer_service tool for both channels
    this.customTools.push({
      name: "escalate_to_customer_service",
      description: "Escalate the conversation to a human customer service representative. Use this when the customer explicitly requests to speak with a person, needs help beyond the bot's capabilities, or is frustrated. The customer must provide their name, email, and phone number before this tool can be used. IMPORTANT: Only one support ticket can be created per conversation within a 24-hour period. If a ticket was created less than 24 hours ago, inform the customer that their request is already being processed and the team will be in touch soon. After 24 hours, a new ticket can be created if needed.",
      input_schema: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "The customer's full name"
          },
          customer_email: {
            type: "string",
            description: "The customer's email address"
          },
          customer_phone: {
            type: "string",
            description: "The customer's phone number"
          },
          reason: {
            type: "string",
            description: "Brief reason for the handoff (optional)"
          }
        },
        required: ["customer_name", "customer_email", "customer_phone"]
      }
    });
    
    // TODO: Make this dynamic, for that first we need to allow access of mcp tools on password proteted demo stores.
    this.storefrontMcpEndpoint = `${hostUrl}/api/mcp`;

    // Hardcode the customer MCP endpoint for vapelocal.co.uk
    if (hostUrl.includes('vapelocal.co.uk')) {
      this.customerMcpEndpoint = customerMcpEndpoint || 'https://account.vapelocal.co.uk/customer/api/mcp';
    } else {
      // Fallback to the original logic for other domains
      const accountHostUrl = hostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
      this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;
    }
    
    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;
    this.hostUrl = hostUrl; // Store hostUrl for potential customer account URL fetching
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @returns {Promise<Array>} Array of available customer tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToCustomerServer() {
    try {
      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        }
      }

      // If we still don't have a token, we'll connect without one
      // and tools that require auth will prompt for it later
      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.customerAccessToken ? `Bearer ${this.customerAccessToken}` : ""
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      // Only add custom tools if they haven't been added yet
      const customToolsToAdd = this.tools.some(t => t.name === 'send_order_template' || t.name === 'validate_product_quantity') ? [] : this.customTools;
      this.tools = [...this.tools, ...customerTools, ...customToolsToAdd];

      return customerTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns {Promise<Array>} Array of available storefront tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToStorefrontServer() {
    try {
      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const storefrontTools = this._formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      // Add custom tools only once (in case storefront connects first)
      const customToolsToAdd = this.tools.some(t => t.name === 'send_order_template' || t.name === 'validate_product_quantity') ? [] : this.customTools;
      this.tools = [...this.tools, ...storefrontTools, ...customToolsToAdd];

      return storefrontTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If tool is not found or call fails
   */
  async callTool(toolName, toolArgs) {
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else if (this.customTools.some(tool => tool.name === toolName)) {
      return this.callCustomTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  /**
   * Handles custom tool calls that aren't from MCP servers.
   * Returns a special response that the webhook handler can process.
   *
   * @param {string} toolName - Name of the custom tool to call
   * @param {Object} toolArgs - Arguments passed to the tool
   * @returns {Promise<Object>} Result indicating custom tool was called
   */
  async callCustomTool(toolName, toolArgs) {
    
    // Handle validate_product_quantity custom tool
    if (toolName === 'validate_product_quantity') {
      return this.handleValidateProductQuantity(toolArgs);
    }
    
    // Return a special response that the webhook can detect and handle
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          custom_tool: toolName,
          arguments: toolArgs
        })
      }],
      isCustomTool: true,
      toolName: toolName,
      toolArgs: toolArgs
    };
  }

  /**
   * Handles the validate_product_quantity custom tool
   * @param {Object} toolArgs - Arguments passed to the tool
   * @returns {Promise<Object>} Result with quantity requirements
   */
  async handleValidateProductQuantity(toolArgs) {
    const { product_id, product_title, variant_id } = toolArgs;
    
    let quantity_increment = null;
    let matchedKey = null;
    
    // Check database for quantity increments by product_id, variant_id, or product_title
    let incrementRecord = null;
    
    if (product_id) {
      incrementRecord = await prisma.productQuantityIncrement.findUnique({
        where: { entityId: product_id }
      });
      if (incrementRecord) {
        quantity_increment = incrementRecord.increment;
        matchedKey = product_id;
      }
    }
    
    if (!incrementRecord && variant_id) {
      incrementRecord = await prisma.productQuantityIncrement.findUnique({
        where: { entityId: variant_id }
      });
      if (incrementRecord) {
        quantity_increment = incrementRecord.increment;
        matchedKey = variant_id;
      }
    }
    
    if (!incrementRecord && product_title) {
      incrementRecord = await prisma.productQuantityIncrement.findFirst({
        where: { productTitle: product_title }
      });
      if (incrementRecord) {
        quantity_increment = incrementRecord.increment;
        matchedKey = incrementRecord.entityId;
      }
    }

    // If still not found, try resolving IDs via storefront search
    if (quantity_increment == null) {
      try {
        // Try to resolve by any identifier we have; include variant_id as a last-resort query
        const query = (product_title || product_id || variant_id);
        if (query && typeof query === 'string') {
          const searchResponse = await this.callStorefrontTool('search_shop_catalog', {
            query,
            context: 'Resolve product for quantity increment validation'
          });

          // Expected to be an object with content[0].text containing JSON with products
          let products = [];
          if (searchResponse?.content && Array.isArray(searchResponse.content) && searchResponse.content[0]) {
            const text = searchResponse.content[0].text;
            try {
              const parsed = typeof text === 'string' ? JSON.parse(text) : text;
              if (parsed?.products && Array.isArray(parsed.products)) {
                products = parsed.products;
              }
            } catch (e) {
              console.error('Failed parsing search_shop_catalog response:', e);
            }
          }

          if (products.length > 0) {
            const best = products[0];
            const resolvedProductId = best.product_id || best.id;
            const resolvedVariantId = (best.variants && best.variants[0] && (best.variants[0].variant_id || best.variants[0].id)) || null;

            // Check database for resolved IDs
            if (resolvedVariantId) {
              const resolvedIncrement = await prisma.productQuantityIncrement.findUnique({
                where: { entityId: resolvedVariantId }
              });
              if (resolvedIncrement) {
                quantity_increment = resolvedIncrement.increment;
                matchedKey = resolvedVariantId;
              }
            }
            
            if (!quantity_increment && resolvedProductId) {
              const resolvedIncrement = await prisma.productQuantityIncrement.findUnique({
                where: { entityId: resolvedProductId }
              });
              if (resolvedIncrement) {
                quantity_increment = resolvedIncrement.increment;
                matchedKey = resolvedProductId;
              }
            }
          }
        }
      } catch (e) {
        console.error('Error resolving product for quantity validation:', e);
      }
    }
    
    const result = {
      product_id: product_id,
      variant_id,
      product_title,
      quantity_increment: quantity_increment,
      message: quantity_increment 
        ? `Product requires quantity in increments of ${quantity_increment}. Use ${quantity_increment} or multiples (${quantity_increment * 2}, ${quantity_increment * 3}, etc.) when adding to cart.`
        : `Product has no quantity requirements. Default quantity of 1 can be used.`
    };
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result)
      }]
    };
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param {string} toolName - Name of the storefront tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If the tool call fails
   */
  async callStorefrontTool(toolName, toolArgs) {
    try {
      // Attempt to inject last known cart_id when missing
      try {
        const CART_TOOLS = new Set(['update_cart', 'get_cart']);
        if (CART_TOOLS.has(toolName) && toolArgs && typeof toolArgs === 'object' && !('cart_id' in toolArgs) && !('cartId' in toolArgs)) {
          let lastCartId = this.lastCartId;
          if (!lastCartId) {
            const conversation = await prisma.conversation.findUnique({
              where: { id: this.conversationId },
              select: { metadata: true }
            });
            lastCartId = conversation?.metadata?.last_cart_id;
            if (lastCartId) {
              this.lastCartId = lastCartId;
            }
          }
          if (lastCartId) {
            toolArgs.cart_id = lastCartId;
            console.warn(`[CART] Injected saved cart_id into ${toolName}: ${lastCartId}`);
          }
        }
      } catch (metaErr) {
        console.error('Failed to inject saved cart_id:', metaErr);
      }

      // Enforce quantity increments on cart updates server-side for safety
      if (toolName === 'update_cart' && toolArgs && Array.isArray(toolArgs.add_items)) {
        try {
          console.warn(`[CART] update_cart invoked with ${toolArgs.add_items.length} item(s)`);
          for (const item of toolArgs.add_items) {
            // Normalize expected field names for variant id
            if (item && item.product_variant_id && !item.variant_id) {
              item.variant_id = item.product_variant_id;
            }
            if (item && item.productVariantId && !item.variant_id) {
              item.variant_id = item.productVariantId;
            }

            const variantId = item.product_variant_id || item.variant_id;
            const productId = item.product_id;
            let increment = null;

            // Require a product identifier (variant or product)
            if (!variantId && !productId) {
                throw new Error('update_cart requires product_variant_id or product_id for each item');
            }

            // Check database for increment (variant first)
            if (typeof variantId === 'string' && variantId) {
              const incVar = await prisma.productQuantityIncrement.findUnique({
                where: { entityId: variantId }
              });
              if (incVar) {
                increment = incVar.increment;
                console.warn(`[CART] Increment for variant ${variantId}: ${increment}`);
              }
            }

            if (!increment && typeof productId === 'string' && productId) {
              const incProd = await prisma.productQuantityIncrement.findUnique({
                where: { entityId: productId }
              });
              if (incProd) {
                increment = incProd.increment;
                console.warn(`[CART] Increment for product ${productId}: ${increment}`);
              }
            }

            if (!increment) {
              try {
                const vq = await this.handleValidateProductQuantity({
                  product_id: productId || '',
                  product_title: '',
                  variant_id: variantId || ''
                });
                if (vq && Array.isArray(vq.content) && vq.content[0] && vq.content[0].text) {
                  const parsed = typeof vq.content[0].text === 'string' ? JSON.parse(vq.content[0].text) : vq.content[0].text;
                  const maybeInc = parseInt(String(parsed?.quantity_increment ?? ''), 10);
                  if (!Number.isNaN(maybeInc) && maybeInc > 0) {
                    increment = maybeInc;
                    console.warn(`[CART] Resolved increment via validate_product_quantity for ${variantId || productId}: ${increment}`);
                  }
                }
              } catch (err) {
                console.warn('validate_product_quantity fallback failed:', err && err.message ? err.message : String(err));
              }
            }

            if (increment && !Number.isNaN(increment)) {
              const requested = Number(item.quantity) || 0;
              const multiples = Math.ceil(Math.max(requested, Number(increment)) / Number(increment));
              const adjusted = Number(multiples) * Number(increment);
              if (adjusted !== requested) {
                item.quantity = adjusted;
                const entity = variantId || productId;
                console.warn(`[CART] Adjusted quantity for ${entity}: ${requested} -> ${adjusted}`);
              }
            } else {
              const entity = variantId || productId;
              console.warn(`[CART] No increment found for ${entity}; using requested quantity`);
            }
          }
        } catch (e) {
          console.error('Failed to enforce quantity increments on update_cart:', e);
        }
      }

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/call",
        {
          name: toolName,
          arguments: toolArgs,
        },
        headers
      );

      const result = response.result || response;

      // After successful cart-related calls, persist last cart info
      try {
        const CART_TOOLS = new Set(['update_cart', 'get_cart']);
        if (CART_TOOLS.has(toolName) && result) {
          const { cartId, checkoutUrl } = this._extractCartInfo(result);
          if (cartId || checkoutUrl) {
            await this._updateLastCartMetadata({ cartId, checkoutUrl });
          }
        }
      } catch (persistErr) {
        console.error('Failed to persist last cart metadata:', persistErr);
      }

      return result;
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Ensures customer account URL is available for authentication
   * @returns {Promise<boolean>} - True if customer account URL is available, false otherwise
   */
  async ensureCustomerAccountUrl() {
    const { getCustomerAccountUrl } = await import('./db.server');
    let customerAccountUrl = await getCustomerAccountUrl(this.conversationId);
    
    if (customerAccountUrl) {
      return true;
    }

    // Check if this is vapelocal.co.uk domain - use hardcoded URL
    if (this.hostUrl && this.hostUrl.includes('vapelocal.co.uk')) {
      return true; // We have a hardcoded URL available
    }

    // If not available, we need to fetch it from Shopify
    // This should be done at the MCP client initialization level, not here
    console.error('Customer account URL not available for conversation:', this.conversationId);
    return false;
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param {string} toolName - Name of the customer tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call or auth error
   * @throws {Error} If the tool call fails
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
        }
      }

      // If we still don't have a token, try fetching it directly via auth flow
      if (!accessToken || accessToken === "") {
        try {
          // Ensure customer account URL is available before generating auth URL
          const hasCustomerAccountUrl = await this.ensureCustomerAccountUrl();
          
          if (!hasCustomerAccountUrl) {
            return {
              error: {
                type: "auth_error",
                data: "Customer account URL not available. Please ensure the shop is properly configured for customer authentication."
              }
            };
          }

          // Generate auth URL - this will use the customer account URL from database
          // Use the same redirect URI for both web and WhatsApp
          // The auth callback will detect WhatsApp conversations and handle them appropriately
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

          // Instead of retrying, return the auth URL for the front-end
          return {
            error: {
              type: "auth_required",
              data: authResponse.url
            }
          };
        } catch (authError) {
          console.error("Failed to generate auth URL:", authError);
          return {
            error: {
              type: "auth_error",
              data: `Failed to initiate authentication: ${authError.message}`
            }
          };
        }
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken ? `Bearer ${accessToken}` : ""
      };

      try {
        
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        return response.result || response;
      } catch (error) {
        console.error('Customer MCP tool call error:', error);
        console.error('Error details:', {
          message: error.message,
          status: error.status,
          code: error.code,
          data: error.data
        });
        
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          try {
            // Ensure customer account URL is available before generating auth URL
            const hasCustomerAccountUrl = await this.ensureCustomerAccountUrl();
            
            if (!hasCustomerAccountUrl) {
              return {
                error: {
                  type: "auth_error",
                  data: "Customer account URL not available. Please ensure the shop is properly configured for customer authentication."
                }
              };
            }

            // Generate auth URL - this will use the customer account URL from database
            // Use the same redirect URI for both web and WhatsApp
            // The auth callback will detect WhatsApp conversations and handle them appropriately
            const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

            // Instead of retrying, return the auth URL for the front-end
            return {
              error: {
                type: "auth_required",
                data: authResponse.url
              }
            };
          } catch (authError) {
            console.error("Failed to generate auth URL:", authError);
            return {
              error: {
                type: "auth_error",
                data: `Failed to initiate authentication: ${authError.message}`
              }
            };
          }
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @private
   * @param {string} endpoint - The endpoint URL
   * @param {string} method - The JSON-RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {Object} headers - HTTP headers for the request
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: method,
        id: 1,
        params: params
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      const errorObj = new Error(`Request failed: ${response.status} ${error}`);
      errorObj.status = response.status;
      throw errorObj;
    }

    return await response.json();
  }

  /**
   * Formats raw tool data into a consistent format.
   *
   * @private
   * @param {Array} toolsData - Raw tools data from the API
   * @returns {Array} Formatted tools data
   */
  _formatToolsData(toolsData) {
    return toolsData
      .filter((tool) => !EXCLUDED_MCP_TOOLS.has(tool.name))
      .map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }

  /**
   * Extract cart id and checkout url from a tool response
   * @private
   * @param {Object} toolResponse
   * @returns {{cartId: string|null, checkoutUrl: string|null}}
   */
  _extractCartInfo(toolResponse) {
    let cartId = null;
    let checkoutUrl = null;
    try {
      const contentBlock = Array.isArray(toolResponse?.content) ? toolResponse.content[0] : null;
      let payload = contentBlock?.text ?? contentBlock ?? toolResponse;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          // leave as string
        }
      }

      const obj = payload && typeof payload === 'object' ? payload : {};

      // Common shapes
      // 1) { cart: { id, checkout_url } }
      if (obj.cart && typeof obj.cart === 'object') {
        cartId = obj.cart.id || obj.cart.cart_id || null;
        checkoutUrl = obj.cart.checkout_url || obj.cart.checkoutUrl || obj.cart.webUrl || null;
      }

      // 2) flat fields { id, checkout_url } or { cart_id, checkout_url }
      if (!cartId) {
        cartId = obj.cart_id || obj.cartId || obj.id || null;
      }
      if (!checkoutUrl) {
        checkoutUrl = obj.checkout_url || obj.checkoutUrl || obj.webUrl || null;
      }

      // Heuristic: only accept plausible cart GIDs/ids
      if (cartId && typeof cartId === 'string') {
        // Normalize: strip any query params accidentally included (e.g., ?key=...)
        const qIndex = cartId.indexOf('?');
        if (qIndex !== -1) {
          cartId = cartId.slice(0, qIndex);
        }
        cartId = cartId.trim();
        // keep as-is
      } else {
        cartId = null;
      }
      if (checkoutUrl && typeof checkoutUrl === 'string') {
        // keep as-is
      } else {
        checkoutUrl = null;
      }
    } catch (e) {
      // ignore parse errors
    }
    return { cartId, checkoutUrl };
  }

  /**
   * Persist last cart info on the conversation metadata
   * @private
   * @param {{cartId?: string|null, checkoutUrl?: string|null}} info
   */
  async _updateLastCartMetadata({ cartId, checkoutUrl }) {
      try {
        if (cartId) {
          this.lastCartId = cartId;
        }
        if (checkoutUrl) {
          this.lastCheckoutUrl = checkoutUrl;
        }
        const existing = await prisma.conversation.findUnique({
          where: { id: this.conversationId },
          select: { metadata: true }
        });
        const metadata = { ...(existing?.metadata || {}) };
        let changed = false;
        if (cartId && metadata.last_cart_id !== cartId) {
          metadata.last_cart_id = cartId;
          changed = true;
        }
        if (checkoutUrl && metadata.last_checkout_url !== checkoutUrl) {
          metadata.last_checkout_url = checkoutUrl;
          changed = true;
        }
        if (changed) {
          metadata.last_cart_updated_at = new Date().toISOString();
          await prisma.conversation.update({
            where: { id: this.conversationId },
            data: {
              metadata,
              updatedAt: new Date()
            }
          });
          console.warn(`[CART] Persisted last cart info: id=${metadata.last_cart_id || 'n/a'} checkout=${metadata.last_checkout_url ? 'yes' : 'no'}`);
        }
      } catch (e) {
        console.error('Failed updating conversation metadata with cart info:', e);
      }
  }
}

export default MCPClient;
