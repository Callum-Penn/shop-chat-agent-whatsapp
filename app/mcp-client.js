import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

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
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];
    
    // Add custom tools that aren't from MCP servers
    this.customTools = [
      {
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
      },
      {
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
      }
    ];
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
      console.log(`Connecting to MCP server at ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
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
      console.log('Customer MCP server tools response:', JSON.stringify(toolsData, null, 2));
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
      console.log(`Connecting to MCP server at ${this.storefrontMcpEndpoint}`);

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
    console.log(`Custom tool called: ${toolName}`, toolArgs);
    
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
    
    // Import quantity increments config
    const quantityIncrements = await import('./config/quantity-increments.json');
    
    let quantity_increment = null;
    let matchedKey = null;
    
    // Check if product ID or title matches in config
    if (product_id && quantityIncrements.default[product_id] != null) {
      quantity_increment = quantityIncrements.default[product_id];
      matchedKey = product_id;
      console.log(`Found quantity_increment in config by product_id ${product_id}: ${quantity_increment}`);
    } else if (variant_id && quantityIncrements.default[variant_id] != null) {
      quantity_increment = quantityIncrements.default[variant_id];
      matchedKey = variant_id;
      console.log(`Found quantity_increment in config by variant_id ${variant_id}: ${quantity_increment}`);
    } else if (product_title && quantityIncrements.default[product_title] != null) {
      quantity_increment = quantityIncrements.default[product_title];
      matchedKey = product_title;
      console.log(`Found quantity_increment in config by product_title "${product_title}": ${quantity_increment}`);
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
    
    console.log('validate_product_quantity result:', result);
    
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
      console.log("Calling storefront tool", toolName, toolArgs);

      // Enforce quantity increments on cart updates server-side for safety
      if (toolName === 'update_cart' && toolArgs && Array.isArray(toolArgs.add_items)) {
        try {
          const incrementsModule = await import('./config/quantity-increments.json');
          const incrementsMap = incrementsModule.default || {};

          toolArgs.add_items = toolArgs.add_items.map((item) => {
            const variantId = item.product_variant_id || item.variant_id;
            const productId = item.product_id;
            let increment = null;

            if (variantId && incrementsMap[variantId] != null) {
              increment = parseInt(incrementsMap[variantId], 10);
            } else if (productId && incrementsMap[productId] != null) {
              increment = parseInt(incrementsMap[productId], 10);
            }

            if (increment && !Number.isNaN(increment)) {
              const requested = Number(item.quantity) || 0;
              // If requested is less than 1 or not a multiple, round up to next valid multiple
              const multiples = Math.ceil(Math.max(requested, increment) / increment);
              const adjusted = multiples * increment;
              if (adjusted !== requested) {
                console.log(`Adjusted quantity for ${variantId || productId} from ${requested} to ${adjusted} based on increment ${increment}`);
              }
              return { ...item, quantity: adjusted };
            }

            return item;
          });
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

      return response.result || response;
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
      console.log('Using hardcoded customer account URL for vapelocal.co.uk');
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
      console.log("Calling customer tool", toolName, toolArgs);
      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken ? `Bearer ${accessToken}` : ""
      };

      try {
        console.log('Making JSON-RPC request to customer MCP server...');
        console.log('Request details:', {
          endpoint: this.customerMcpEndpoint,
          toolName: toolName,
          toolArgs: toolArgs,
          hasToken: !!accessToken,
          tokenLength: accessToken ? accessToken.length : 0
        });
        
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        console.log('Customer MCP server response:', response);
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
          console.log("Unauthorized, generating authorization URL for customer");

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
    return toolsData.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }
}

export default MCPClient;
