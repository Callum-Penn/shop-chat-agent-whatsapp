/**
 * Claude Service
 * Manages interactions with the Claude API
 */
import { Anthropic } from "@anthropic-ai/sdk";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

/**
 * Log the payload being sent to Claude for debugging token usage
 * @param {string} operation - The operation being performed (streamConversation | getConversationResponse)
 * @param {Object} payload - The payload being sent to Claude
 */
function logClaudeRequest(operation, payload) {
  try {
    const messages = payload?.messages || [];
    const totalContentChars = messages.reduce((sum, message) => {
      if (!message?.content) {
        return sum;
      }

      if (Array.isArray(message.content)) {
        return (
          sum +
          message.content.reduce((blockSum, block) => {
            if (typeof block === "string") {
              return blockSum + block.length;
            }
            if (block?.text) {
              return blockSum + block.text.length;
            }
            return blockSum + JSON.stringify(block).length;
          }, 0)
        );
      }

      if (typeof message.content === "string") {
        return sum + message.content.length;
      }

      return sum + JSON.stringify(message.content).length;
    }, 0);

    const summary = {
      operation,
      promptType: payload?.promptType,
      model: payload?.model,
      maxTokens: payload?.max_tokens,
      messageCount: messages.length,
      totalContentChars,
      toolCount: payload?.tools ? payload.tools.length : 0,
      toolNames:
        payload?.tools?.map((tool) => tool?.name || tool?.type || "unknown") || [],
    };

    console.log("[Claude Payload Summary]", summary);

    // Log the full payload for detailed inspection (capped to avoid enormous logs)
    const payloadString = JSON.stringify(payload, null, 2);
    const MAX_LOG_LENGTH = 50000; // ~50KB
    if (payloadString.length > MAX_LOG_LENGTH) {
      console.log(
        `[Claude Payload] (truncated ${payloadString.length - MAX_LOG_LENGTH} chars)\n` +
          payloadString.substring(0, MAX_LOG_LENGTH)
      );
    } else {
      console.log("[Claude Payload]", payloadString);
    }
  } catch (error) {
    console.error("Failed to log Claude request payload:", error);
  }
}

/**
 * Creates a Claude service instance
 * @param {string} apiKey - Claude API key
 * @returns {Object} Claude service with methods for interacting with Claude API
 */
export function createClaudeService(apiKey = process.env.CLAUDE_API_KEY) {
  // Initialize Claude client
  const anthropic = new Anthropic({ apiKey });

  /**
   * Streams a conversation with Claude
   * @param {Object} params - Stream parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {Array} params.tools - Available tools for Claude
   * @param {Object} streamHandlers - Stream event handlers
   * @param {Function} streamHandlers.onText - Handles text chunks
   * @param {Function} streamHandlers.onMessage - Handles complete messages
   * @param {Function} streamHandlers.onToolUse - Handles tool use requests
   * @returns {Promise<Object>} The final message
   */
  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools
  }, streamHandlers) => {
    // Get system prompt from configuration or use default
    const systemInstruction = getSystemPrompt(promptType);

    const requestPayload = {
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.maxTokens,
      system: systemInstruction,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      promptType,
    };

    logClaudeRequest("streamConversation", requestPayload);

    // Create stream
    const stream = await anthropic.messages.stream(requestPayload);

    // Set up event handlers
    if (streamHandlers.onText) {
      stream.on('text', streamHandlers.onText);
    }

    if (streamHandlers.onMessage) {
      stream.on('message', streamHandlers.onMessage);
    }

    if (streamHandlers.onContentBlock) {
      stream.on('contentBlock', streamHandlers.onContentBlock);
    }

    // Wait for final message
    const finalMessage = await stream.finalMessage();

    // Process tool use requests
    if (streamHandlers.onToolUse && finalMessage.content) {
      for (const content of finalMessage.content) {
        if (content.type === "tool_use") {
          await streamHandlers.onToolUse(content);
        }
      }
    }

    return finalMessage;
  };

  /**
   * Gets a complete conversation response from Claude (non-streaming)
   * @param {Object} params - Conversation parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {Array} params.tools - Available tools for Claude
   * @returns {Promise<Object>} The complete response
   */
  const getConversationResponse = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools
  }) => {
    // Get system prompt from configuration or use default
    const systemInstruction = getSystemPrompt(promptType);

    const requestPayload = {
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.maxTokens,
      system: systemInstruction,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      promptType,
    };

    logClaudeRequest("getConversationResponse", requestPayload);

    // Create non-streaming request
    const response = await anthropic.messages.create(requestPayload);

    return response;
  };

  /**
   * Gets the system prompt content for a given prompt type
   * @param {string} promptType - The prompt type to retrieve
   * @returns {string} The system prompt content
   */
  const getSystemPrompt = (promptType) => {
    const prompt = systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
    
    // Truncate system prompt to reduce token usage
    const maxLength = AppConfig.conversation.maxSystemPromptLength;
    if (prompt.length > maxLength) {
      return prompt.substring(0, maxLength) + '...';
    }
    
    return prompt;
  };

  return {
    streamConversation,
    getConversationResponse,
    getSystemPrompt
  };
}

export default {
  createClaudeService
};
