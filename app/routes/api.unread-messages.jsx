import { json } from "@remix-run/node";
import { getConversationHistory } from "../db.server";

/**
 * Get CORS headers for responses
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    
    if (!conversationId) {
      return json({ unread_count: 0 }, {
        headers: getCorsHeaders(request)
      });
    }

    // Get conversation history (returns in chronological order - oldest first)
    const messages = await getConversationHistory(conversationId);
    
    // Find the last user message timestamp to determine what's unread
    let lastUserMessageTime = null;
    // Iterate from the end to find the most recent user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageTime = new Date(messages[i].createdAt);
        break;
      }
    }
    
    // Count assistant messages created after the last user message
    let unreadCount = 0;
    
    if (lastUserMessageTime) {
      // Only count messages after the last user interaction
      for (const message of messages) {
        if (message.role === 'assistant' && new Date(message.createdAt) > lastUserMessageTime) {
          unreadCount++;
        }
      }
    } else {
      // If no user messages yet, count all assistant messages from last 7 days
      const now = new Date();
      for (const message of messages) {
        if (message.role === 'assistant') {
          const messageTime = new Date(message.createdAt);
          const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
          if (hoursDiff <= 168) { // 7 days = 168 hours
            unreadCount++;
          }
        }
      }
    }
    
    return json({ unread_count: unreadCount }, {
      headers: getCorsHeaders(request)
    });
  } catch (error) {
    console.error('Error checking unread messages:', error);
    return json({ unread_count: 0 }, {
      headers: getCorsHeaders(request)
    });
  }
};
