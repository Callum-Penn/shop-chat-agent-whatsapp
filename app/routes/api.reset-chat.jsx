/**
 * Reset Chat API Route
 * Clears conversation history for a specific conversation ID
 */
import { json } from "@remix-run/node";
import { deleteConversationHistory, updateConversationMetadata } from "../db.server";

/**
 * Handle POST requests to reset chat
 */
export const action = async ({ request }) => {
  try {
    const body = await request.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return json({ error: "Conversation ID is required" }, { 
        status: 400,
        headers: getCorsHeaders(request)
      });
    }

    // Delete all messages for this conversation
    await deleteConversationHistory(conversation_id);

    // Reset handoff flags and clear any persisted cart_id
    await updateConversationMetadata(conversation_id, {
      handoff_requested: false,
      handoff_at: null,
      cart_id: null
    });

    console.log(`Chat reset: Cleared conversation history and reset handoff flag for ${conversation_id}`);

    return json({ 
      success: true, 
      message: "Chat history cleared successfully" 
    }, {
      headers: getCorsHeaders(request)
    });

  } catch (error) {
    console.error('Error resetting chat:', error);
    return json({ 
        error: "Failed to reset chat", 
        details: error.message 
      }, { 
        status: 500,
        headers: getCorsHeaders(request)
      }
    );
  }
};

/**
 * Get CORS headers for responses
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Handle OPTIONS requests (CORS preflight)
 */
export const loader = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
};
