import { json } from "@remix-run/node";
import { getConversationHistory } from "../db.server";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    const since = url.searchParams.get('since'); // ISO timestamp of last check
    
    if (!conversationId) {
      return json({ messages: [] });
    }

    // Get conversation history
    const allMessages = await getConversationHistory(conversationId);
    
    // Get assistant messages that were created after the 'since' timestamp
    const recentMessages = [];
    const sinceDate = since ? new Date(since) : new Date(0); // If no 'since', get all
    
    for (const message of allMessages) {
      if (message.role === 'assistant' && new Date(message.createdAt) > sinceDate) {
        recentMessages.push({
          content: message.content,
          createdAt: message.createdAt
        });
      }
    }
    
    return json({ 
      messages: recentMessages,
      latestTimestamp: allMessages.length > 0 
        ? allMessages[allMessages.length - 1].createdAt 
        : null
    });
  } catch (error) {
    console.error('Error fetching recent messages:', error);
    return json({ messages: [] });
  }
};

