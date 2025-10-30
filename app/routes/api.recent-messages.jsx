import { json } from "@remix-run/node";
import { getConversationHistory } from "../db.server";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    
    if (!conversationId) {
      return json({ messages: [] });
    }

    // Get the last 10 messages from conversation history
    const messages = await getConversationHistory(conversationId, 10);
    
    // Format messages for the frontend
    const formattedMessages = messages.map(msg => {
      let content;
      try {
        content = JSON.parse(msg.content);
        if (!Array.isArray(content)) {
          content = [{ type: "text", text: String(content) }];
        }
      } catch (e) {
        content = [{ type: "text", text: msg.content }];
      }
      return {
        id: msg.id,
        role: msg.role,
        content: content,
        createdAt: msg.createdAt
      };
    });
    
    return json({ messages: formattedMessages });
  } catch (error) {
    console.error('Error fetching recent messages:', error);
    return json({ messages: [] });
  }
};

