/**
 * API Route: Send follow-up messages for inactive conversations
 */
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendWhatsAppMessage } from "../utils/whatsapp.server";

export const config = { runtime: 'nodejs' };

export async function loader({ request }) {
  // This endpoint should only be called by a scheduled job (e.g., cron)
  const authToken = request.headers.get('Authorization');
  
  // Simple auth check - compare against a secret token from env
  if (authToken !== `Bearer ${process.env.FOLLOWUP_SECRET}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    
    // Find conversations that haven't had a message in 3 minutes (180000 ms) and haven't received the first follow-up
    const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000);
    const allInactiveConversations = await prisma.conversation.findMany({
      where: {
        lastMessageAt: {
          lte: threeMinutesAgo
        },
        archived: false
      },
      include: {
        user: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    // Filter in JavaScript to check metadata
    const conversationsForFirstFollowup = allInactiveConversations.filter(conv => {
      const metadata = conv.metadata as any;
      return !metadata || !metadata.followup1_sent;
    });

    // Find conversations that got the first follow-up 2 minutes ago (120000 ms) and haven't received the second
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const allOldInactiveConversations = await prisma.conversation.findMany({
      where: {
        lastMessageAt: {
          lte: fiveMinutesAgo
        },
        archived: false
      },
      include: {
        user: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    // Filter to get only those with followup1_sent but not followup2_sent
    const conversationsForSecondFollowup = allOldInactiveConversations.filter(conv => {
      const metadata = conv.metadata as any;
      return metadata && metadata.followup1_sent && !metadata.followup2_sent;
    });

    const results = {
      firstFollowup: { sent: 0, failed: 0 },
      secondFollowup: { sent: 0, failed: 0 }
    };

    // Send first follow-up messages
    for (const conversation of conversationsForFirstFollowup) {
      try {
        const message = "It looks like you may have stepped away. Don't worry I'll remember our conversation and if you need any further help, just send me a message back here.";
        
        // Save the message to conversation history WITHOUT updating lastMessageAt
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: JSON.stringify([{ type: "text", text: message }])
          }
        });

        // Update conversation metadata to mark followup1 as sent
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            metadata: {
              ...(conversation.metadata as any || {}),
              followup1_sent: true,
              followup1_sentAt: new Date().toISOString()
            }
          }
        });

        // Send message based on channel
        if (conversation.channel === 'whatsapp' && conversation.user?.phoneNumber) {
          await sendWhatsAppMessage(conversation.user.phoneNumber, message);
        }

        results.firstFollowup.sent++;
        console.log(`Sent first follow-up to conversation ${conversation.id}`);
      } catch (error) {
        console.error(`Failed to send first follow-up to conversation ${conversation.id}:`, error);
        results.firstFollowup.failed++;
      }
    }

    // Send second follow-up messages (WhatsApp community invite)
    for (const conversation of conversationsForSecondFollowup) {
      try {
        const message = "Do you want to get notified on best sellers, restocks deals and more? Then join our WhatsApp community here and be the first to hear about all the latest news.";
        
        // Save the message to conversation history WITHOUT updating lastMessageAt
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: JSON.stringify([{ type: "text", text: message }])
          }
        });

        // Update conversation metadata to mark followup2 as sent
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            metadata: {
              ...(conversation.metadata as any || {}),
              followup2_sent: true,
              followup2_sentAt: new Date().toISOString()
            }
          }
        });

        // Send message based on channel
        if (conversation.channel === 'whatsapp' && conversation.user?.phoneNumber) {
          await sendWhatsAppMessage(conversation.user.phoneNumber, message);
        }

        results.secondFollowup.sent++;
        console.log(`Sent second follow-up to conversation ${conversation.id}`);
      } catch (error) {
        console.error(`Failed to send second follow-up to conversation ${conversation.id}:`, error);
        results.secondFollowup.failed++;
      }
    }

    return json({
      success: true,
      results,
      processed: conversationsForFirstFollowup.length + conversationsForSecondFollowup.length
    });
  } catch (error) {
    console.error('Error processing follow-ups:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

