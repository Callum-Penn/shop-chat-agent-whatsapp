import { json } from "@remix-run/node";
import {
  getUnreadAssistantMessageCount,
  markAssistantMessagesAsRead
} from "../db.server";

const ALLOWED_METHODS = "GET, POST, OPTIONS";

/**
 * Get CORS headers for responses
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    
    if (!conversationId) {
      return json({ unread_count: 0 }, {
        headers: getCorsHeaders(request)
      });
    }

    const unreadCount = await getUnreadAssistantMessageCount(conversationId);
    
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

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  if (request.method !== "POST") {
    return json(
      { success: false, message: "Method not allowed" },
      { status: 405, headers: getCorsHeaders(request) }
    );
  }

  try {
    const body = await request.json();
    const conversationId = body?.conversation_id || body?.conversationId;

    if (!conversationId) {
      return json(
        { success: false, message: "conversation_id is required" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const updated = await markAssistantMessagesAsRead(conversationId);

    return json(
      { success: true, updated },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    console.error('Error marking messages as read:', error);
    return json(
      { success: false, message: 'Failed to mark messages as read' },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
};
