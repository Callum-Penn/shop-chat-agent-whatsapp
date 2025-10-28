/**
 * Reset Chat API Route
 * Clears conversation history for a specific conversation ID
 */
import { json } from "@remix-run/node";
import { deleteConversationHistory } from "../db.server";

/**
 * Handle POST requests to reset chat
 */
export const action = async ({ request }) => {
  try {
    const body = await request.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return json({ error: "Conversation ID is required" }, { status: 400 });
    }

    // Delete all messages for this conversation
    await deleteConversationHistory(conversation_id);

    console.log(`Chat reset: Cleared conversation history for ${conversation_id}`);

    return json({ 
      success: true, 
      message: "Chat history cleared successfully" 
    });

  } catch (error) {
    console.error('Error resetting chat:', error);
    return json({ 
      error: "Failed to reset chat", 
      details: error.message 
    }, { status: 500 });
  }
};

/**
 * Handle OPTIONS requests (CORS preflight)
 */
export const loader = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Allow-Credentials": "true",
    }
  });
};
