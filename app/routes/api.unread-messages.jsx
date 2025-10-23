import { json } from "@remix-run/node";
import { getConversationHistory } from "../db.server";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    
    if (!conversationId) {
      return json({ unread_count: 0 });
    }

    // Get conversation history
    const messages = await getConversationHistory(conversationId);
    
    // Count broadcast messages that are from assistant and contain "[Broadcast Message]"
    let unreadCount = 0;
    const now = new Date();
    
    for (const message of messages) {
      if (message.role === 'assistant' && message.content.includes('[Broadcast Message]')) {
        // Check if message is recent (within last 7 days) and hasn't been "read"
        // For now, we'll consider all broadcast messages as potentially unread
        // In a more sophisticated implementation, you'd track read status
        const messageTime = new Date(message.createdAt);
        const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
        
        if (hoursDiff <= 168) { // 7 days = 168 hours
          unreadCount++;
        }
      }
    }
    
    return json({ unread_count: unreadCount });
  } catch (error) {
    console.error('Error checking unread messages:', error);
    return json({ unread_count: 0 });
  }
};
