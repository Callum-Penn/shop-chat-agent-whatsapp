/**
 * Token Usage Analysis Script
 * Analyzes what's being sent to Claude API to identify token optimization opportunities
 */

const fs = require('fs');
const prompts = require('./app/prompts/prompts.json');

// Approximate token calculation (1 token ≈ 4 characters)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

console.log('='.repeat(80));
console.log('CLAUDE API TOKEN USAGE ANALYSIS');
console.log('='.repeat(80));
console.log();

// 1. System Prompt Analysis
console.log('1. SYSTEM PROMPT');
console.log('-'.repeat(80));
const standardPrompt = prompts.systemPrompts.standardAssistant.content;
const enthusiasticPrompt = prompts.systemPrompts.enthusiasticAssistant.content;
console.log(`Standard prompt: ${standardPrompt.length} chars ≈ ${estimateTokens(standardPrompt)} tokens`);
console.log(`Enthusiastic prompt: ${enthusiasticPrompt.length} chars ≈ ${estimateTokens(enthusiasticPrompt)} tokens`);
console.log(`Config maxSystemPromptLength: 500 chars (but not being enforced!)`);
console.log();

// 2. Tool Definitions Analysis
console.log('2. TOOL DEFINITIONS (sent with every request)');
console.log('-'.repeat(80));

// Custom tools
const customTools = [
  {
    name: "validate_product_quantity",
    description: "Check if a product has quantity requirements (minimum or increment). ALWAYS call this before adding products to cart. If a quantity_increment exists, you MUST use that value or a multiple of it as the quantity. Example: if increment is 5, use 5, 10, 15, etc.",
    schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product ID to check (can be GID or product title)" },
        product_title: { type: "string", description: "Optional product title to check if ID not found" },
        variant_id: { type: "string", description: "Optional variant ID to check variant-level increment" }
      },
      required: ["product_id"]
    }
  },
  {
    name: "escalate_to_customer_service",
    description: "Escalate the conversation to a human customer service representative. Use this when the customer explicitly requests to speak with a person, needs help beyond the bot's capabilities, or is frustrated. The customer must provide their name, email, and phone number before this tool can be used. IMPORTANT: Only one support ticket can be created per conversation within a 24-hour period. If a ticket was created less than 24 hours ago, inform the customer that their request is already being processed and the team will be in touch soon. After 24 hours, a new ticket can be created if needed.",
    schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "The customer's full name" },
        customer_email: { type: "string", description: "The customer's email address" },
        customer_phone: { type: "string", description: "The customer's phone number" },
        reason: { type: "string", description: "Brief reason for the handoff (optional)" }
      },
      required: ["customer_name", "customer_email", "customer_phone"]
    }
  },
  {
    name: "send_order_template",
    description: "Send a spreadsheet order template to the customer via WhatsApp. Use this when customers ask about bestsellers, want to place bulk orders, or need an order form. The template includes business details fields and a product list where they can enter quantities.",
    schema: {
      type: "object",
      properties: {
        template_type: { type: "string", enum: ["bestsellers", "general"], description: "Type of template to send: 'bestsellers' for pre-filled bestseller products, 'general' for blank order form" },
        message: { type: "string", description: "Optional custom message to include with the template" }
      },
      required: ["template_type"]
    }
  }
];

let totalToolTokens = 0;
customTools.forEach(tool => {
  const toolStr = JSON.stringify(tool, null, 2);
  const tokens = estimateTokens(toolStr);
  totalToolTokens += tokens;
  console.log(`${tool.name}: ${toolStr.length} chars ≈ ${tokens} tokens`);
});
console.log(`Total custom tools: ${totalToolTokens} tokens`);
console.log(`+ MCP tools (storefront + customer): ~5-10 tools, ~2000-4000 tokens estimated`);
console.log(`Total tools: ~${totalToolTokens + 3000} tokens`);
console.log();

// 3. Conversation History Analysis
console.log('3. CONVERSATION HISTORY');
console.log('-'.repeat(80));
console.log('Current limit: 20 messages');
console.log('Each message includes:');
console.log('  - role (user/assistant): ~10 chars');
console.log('  - content array with text blocks: variable');
console.log('  - tool_use blocks (if any): ~200-500 chars each');
console.log('  - tool_result blocks (if any): can be VERY large (product data, etc.)');
console.log();
console.log('Example message sizes:');
console.log('  - Simple user message: ~50-100 chars ≈ 12-25 tokens');
console.log('  - Assistant response: ~100-300 chars ≈ 25-75 tokens');
console.log('  - Tool result (product search): ~2000-5000 chars ≈ 500-1250 tokens');
console.log('  - Tool result (cart update): ~500-1000 chars ≈ 125-250 tokens');
console.log();
console.log('With 20 messages:');
console.log('  - Conservative estimate: 20 × 100 chars = 2000 chars ≈ 500 tokens');
console.log('  - With tool results: 20 × 1000 chars = 20000 chars ≈ 5000 tokens');
console.log('  - Worst case (many tool results): 20 × 3000 chars = 60000 chars ≈ 15000 tokens');
console.log();

// 4. Total Token Estimate
console.log('4. TOTAL TOKEN ESTIMATE PER REQUEST');
console.log('-'.repeat(80));
const systemTokens = estimateTokens(standardPrompt);
const toolsTokens = totalToolTokens + 3000; // Custom + MCP tools
const historyTokens = 5000; // Average case with tool results
const totalTokens = systemTokens + toolsTokens + historyTokens;

console.log(`System prompt: ~${systemTokens} tokens`);
console.log(`Tools: ~${toolsTokens} tokens`);
console.log(`Conversation history (20 msgs): ~${historyTokens} tokens`);
console.log(`TOTAL: ~${totalTokens} tokens per request`);
console.log();

// 5. Optimization Opportunities
console.log('5. OPTIMIZATION OPPORTUNITIES');
console.log('-'.repeat(80));
console.log();
console.log('HIGH IMPACT:');
console.log('  ✓ Reduce system prompt size (currently 4577 chars, config says 500 but not enforced)');
console.log('    - Remove redundant instructions');
console.log('    - Consolidate similar rules');
console.log('    - Use shorter, more concise language');
console.log('    - Potential savings: ~2000-3000 tokens');
console.log();
console.log('  ✓ Truncate tool results in conversation history');
console.log('    - Product search results can be huge (full product objects)');
console.log('    - Keep only essential fields: id, title, price, quantity_increment');
console.log('    - Remove: description, images, variants details, etc.');
console.log('    - Potential savings: ~2000-4000 tokens per tool result');
console.log();
console.log('  ✓ Reduce conversation history limit');
console.log('    - Currently 20 messages');
console.log('    - Consider 10-15 messages (first + recent)');
console.log('    - Potential savings: ~1000-2500 tokens');
console.log();
console.log('MEDIUM IMPACT:');
console.log('  ✓ Shorten tool descriptions');
console.log('    - Remove redundant explanations');
console.log('    - Keep only essential information');
console.log('    - Potential savings: ~500-1000 tokens');
console.log();
console.log('  ✓ Remove tool_use blocks from history after processing');
console.log('    - Tool_use is only needed once, not in every subsequent request');
console.log('    - Keep tool_result but remove tool_use');
console.log('    - Potential savings: ~200-500 tokens per tool use');
console.log();
console.log('  ✓ Compress assistant messages');
console.log('    - Remove verbose explanations');
console.log('    - Keep only user-facing content');
console.log('    - Potential savings: ~100-300 tokens per message');
console.log();
console.log('LOW IMPACT:');
console.log('  ✓ Remove unnecessary fields from message structure');
console.log('  ✓ Use shorter variable names in tool schemas');
console.log('  ✓ Cache tool definitions (not sent with every request)');
console.log();

// 6. Recommended Actions
console.log('6. RECOMMENDED ACTIONS (Priority Order)');
console.log('-'.repeat(80));
console.log('1. Truncate tool results - remove unnecessary product data');
console.log('2. Enforce system prompt length limit (500 chars) or optimize prompt');
console.log('3. Reduce conversation history to 10-15 messages');
console.log('4. Remove tool_use blocks from history after processing');
console.log('5. Shorten tool descriptions');
console.log();
console.log('Expected total savings: ~5000-8000 tokens per request');
console.log('New estimated total: ~${totalTokens - 6000} tokens per request');
console.log('='.repeat(80));

