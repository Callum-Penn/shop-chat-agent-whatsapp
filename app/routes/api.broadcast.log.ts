import { json } from "@remix-run/node";
import { sendWhatsAppMessage, sendWhatsAppImageWithUrl, uploadImageToHosting } from "../utils/whatsapp.server";
import { getAllWhatsAppUsers, getAllWebUsers, getAllWebUsersWithConversations, saveMessage } from "../db.server";
import prisma from "../db.server";

// This is a server-only API route
export const config = {
  runtime: 'nodejs'
};

export const loader = async () => {
  try {
    const broadcasts = await prisma.broadcastLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    return json(broadcasts);
  } catch (error) {
    console.error('Error loading broadcast log:', error);
    return json([]);
  }
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { message, heading, image, imageName, imageType, channels, phones } = body || {};

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return json({ error: "Message is required" }, { status: 400 });
    }

    const website = !!(channels && channels.website);
    const whatsapp = !!(channels && channels.whatsapp);

    if (!website && !whatsapp) {
      return json({ error: "At least one channel must be selected" }, { status: 400 });
    }

    // Create broadcast log entry in database
    const entry = await prisma.broadcastLog.create({
      data: {
        message: message.trim(),
        heading: heading?.trim() || null,
        image: image || null,
        imageName: imageName || null,
        imageType: imageType || null,
        channels: { website, whatsapp },
        whatsappCount: 0, // Will be updated after processing
        status: 'processing',
        results: {
          whatsapp: { sent: 0, failed: 0, errors: [] },
          website: { sent: 0, failed: 0, errors: [] }
        }
      }
    });

    // Process WhatsApp messages asynchronously
    if (whatsapp) {
      processWhatsAppBroadcast(entry, message.trim());
    }

    // Process website messages asynchronously  
    if (website) {
      processWebsiteBroadcast(entry, message.trim());
    }

    return json(entry, { status: 201 });
  } catch (error) {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
};

// Process WhatsApp broadcast messages
async function processWhatsAppBroadcast(entry, message) {
  console.log(`Broadcast: Getting WhatsApp users from database...`);
  
  try {
    // Get all WhatsApp users from database
    const whatsappUsers = await getAllWhatsAppUsers();
    console.log(`Broadcast: Found ${whatsappUsers.length} WhatsApp users in database`);
    
    if (whatsappUsers.length === 0) {
      console.log(`Broadcast: No WhatsApp users found in database`);
      entry.status = 'completed';
      return;
    }
    
    // Update the entry with actual count
    await prisma.broadcastLog.update({
      where: { id: entry.id },
      data: { whatsappCount: whatsappUsers.length }
    });
    
    // Upload image to hosting service if provided
    let imageUrl = null;
    if (entry.image) {
      try {
        imageUrl = await uploadImageToHosting(entry.image, 'image.jpg');
        console.log(`Broadcast: Uploaded image to hosting, URL: ${imageUrl}`);
        
        // Add additional delay to ensure image is fully accessible
        console.log(`Broadcast: Waiting for image to be fully accessible...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        console.log(`Broadcast: Image should now be accessible`);
      } catch (error) {
        console.error('Broadcast: Failed to upload image to hosting:', error);
        entry.results.whatsapp.failed = whatsappUsers.length;
        entry.results.whatsapp.errors.push({
          error: `Failed to upload image to hosting: ${error.message}`
        });
        return; // Stop processing if image upload fails
      }
    }

    for (const user of whatsappUsers) {
      try {
        // Ensure phone number is in correct format (remove + if present, add if missing)
        let phoneNumber = user.phoneNumber;
        if (phoneNumber.startsWith('+')) {
          phoneNumber = phoneNumber.substring(1);
        }
        if (!phoneNumber.startsWith('44')) {
          phoneNumber = '44' + phoneNumber;
        }
        
        console.log(`Broadcast: Sending to phone number: ${phoneNumber} (original: ${user.phoneNumber})`);
        
        // Format message with bold heading if provided
        let formattedMessage = message;
        if (entry.heading) {
          formattedMessage = `*${entry.heading}*\n\n${message}`;
        }
        
        // Send image if provided, otherwise send text message
        if (entry.image && imageUrl) {
          // For images: send image with caption using public URL
          const imageCaption = entry.heading 
            ? `*${entry.heading}*\n\n${message}`
            : message;
          console.log(`Broadcast: About to send image with URL: ${imageUrl}`);
          await sendWhatsAppImageWithUrl(phoneNumber, imageUrl, imageCaption);
        } else {
          // For text only: send formatted message with bold heading
          await sendWhatsAppMessage(phoneNumber, formattedMessage);
        }
        
        entry.results.whatsapp.sent++;
        console.log(`Broadcast: WhatsApp message sent to ${user.phoneNumber} (${user.name || 'Unknown'})`);
        
        // Save the broadcast message to the user's conversation history
        // so Claude AI knows about it when they respond
        try {
          const conversationId = `whatsapp_${user.phoneNumber}`;
          const conversationMessage = entry.heading 
            ? ` *${entry.heading}*\n\n${message}`
            : ` ${message}`;
          await saveMessage(conversationId, 'assistant', conversationMessage);
          console.log(`Broadcast: Saved message to conversation history for ${user.phoneNumber}`);
        } catch (saveError) {
          console.error(`Broadcast: Failed to save message to conversation for ${user.phoneNumber}:`, saveError);
          // Don't fail the broadcast if we can't save to conversation
        }
        
        // Add small delay between messages to avoid rate limiting
        if (whatsappUsers.indexOf(user) < whatsappUsers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }
      } catch (error) {
        entry.results.whatsapp.failed++;
        entry.results.whatsapp.errors.push({
          phone: user.phoneNumber,
          name: user.name,
          error: error.message
        });
        console.error(`Broadcast: Failed to send WhatsApp message to ${user.phoneNumber}:`, error.message);
      }
    }
    
    // Update status and results in database
    let newStatus = 'completed';
    if (entry.results.whatsapp.failed > 0) {
      newStatus = entry.results.whatsapp.sent === 0 ? 'failed' : 'partial';
    } else if (entry.channels.website) {
      newStatus = 'partial';
    }
    
    await prisma.broadcastLog.update({
      where: { id: entry.id },
      data: {
        status: newStatus,
        results: entry.results
      }
    });
    
    console.log(`Broadcast: WhatsApp processing complete - ${entry.results.whatsapp.sent} sent, ${entry.results.whatsapp.failed} failed`);
  } catch (error) {
    console.error(`Broadcast: Error getting WhatsApp users:`, error);
    entry.results.whatsapp.failed = 1;
    entry.results.whatsapp.errors.push({
      error: `Failed to get users from database: ${error.message}`
    });
    
    // Update database with error status
    await prisma.broadcastLog.update({
      where: { id: entry.id },
      data: {
        status: 'failed',
        results: entry.results
      }
    });
  }
}

// Process website broadcast messages
async function processWebsiteBroadcast(entry, message) {
  console.log(`Broadcast: Processing website messages`);
  
  try {
    // Get all web chat users with their conversation IDs from database
    const webUsers = await getAllWebUsersWithConversations();
    console.log(`Broadcast: Found ${webUsers.length} web chat users in database`);
    
    // Log customer-based users for debugging
    const customerUsers = webUsers.filter(user => user.shopifyCustomerId);
    console.log(`Broadcast: Found ${customerUsers.length} logged-in customers for cross-device sync`);
    
    if (webUsers.length === 0) {
      console.log(`Broadcast: No web chat users found in database`);
      entry.results.website.sent = 0;
      entry.results.website.failed = 0;
    } else {
      // Upload image to hosting service if provided
      let imageUrl = null;
      if (entry.image) {
        try {
          imageUrl = await uploadImageToHosting(entry.image, 'image.jpg');
          console.log(`Broadcast: Uploaded image to hosting, URL: ${imageUrl}`);
        } catch (error) {
          console.error('Broadcast: Failed to upload image to hosting:', error);
          entry.results.website.failed = webUsers.length;
          entry.results.website.errors.push({
            error: `Failed to upload image to hosting: ${error.message}`
          });
          return; // Stop processing if image upload fails
        }
      }
      
      // Send broadcast message to each web chat user's actual conversation
      for (const user of webUsers) {
        try {
          // Get the user's actual conversation IDs
          const conversations = user.conversations || [];
          
          if (conversations.length === 0) {
            console.log(`Broadcast: User ${user.id} has no conversations, skipping`);
            continue;
          }
          
          // For logged-in customers, prioritize customer-based conversations
          let targetConversation = null;
          
          if (user.shopifyCustomerId) {
            // Look for customer-based conversation first
            targetConversation = conversations.find(conv => conv.id.startsWith('web_customer_'));
          }
          
          // If no customer conversation found, use any available conversation
          if (!targetConversation && conversations.length > 0) {
            targetConversation = conversations[0];
          }
          
          if (targetConversation) {
            try {
              // Save the broadcast message to the user's conversation history
              let broadcastMessage = entry.heading 
                ? ` **${entry.heading}**\n\n${message}`
                : ` ${message}`;
              
              // Include image markdown if image was provided
              if (entry.image && imageUrl) {
                broadcastMessage = `![Broadcast Image](${imageUrl})\n\n${broadcastMessage}`;
              }
              
              await saveMessage(targetConversation.id, 'assistant', broadcastMessage);
              console.log(`Broadcast: Saved message to conversation ${targetConversation.id} for customer ${user.shopifyCustomerId || user.id} (${user.name || 'Unknown'})`);
              
              entry.results.website.sent++;
            } catch (conversationError) {
              entry.results.website.failed++;
              entry.results.website.errors.push({
                userId: user.id,
                customerId: user.shopifyCustomerId,
                conversationId: targetConversation.id,
                name: user.name,
                error: conversationError.message
              });
              console.error(`Broadcast: Failed to save message for conversation ${targetConversation.id}:`, conversationError.message);
            }
          }
        } catch (error) {
          entry.results.website.failed++;
          entry.results.website.errors.push({
            userId: user.id,
            customerId: user.shopifyCustomerId,
            name: user.name,
            error: error.message
          });
          console.error(`Broadcast: Failed to process user ${user.id}:`, error.message);
        }
      }
    }
    
    console.log(`Broadcast: Website processing complete - ${entry.results.website.sent} sent, ${entry.results.website.failed} failed`);
    
    // Update status in database
    let newStatus = 'completed';
    if (entry.results.whatsapp.failed > 0 || entry.results.website.failed > 0) {
      newStatus = (entry.results.whatsapp.sent === 0 && entry.results.website.sent === 0) ? 'failed' : 'partial';
    }
    
    await prisma.broadcastLog.update({
      where: { id: entry.id },
      data: {
        status: newStatus,
        results: entry.results
      }
    });
  } catch (error) {
    entry.results.website.failed = 1;
    entry.results.website.errors.push({
      error: error.message
    });
    console.error(`Broadcast: Failed to process website broadcast:`, error.message);
    
    // Update database with error
    await prisma.broadcastLog.update({
      where: { id: entry.id },
      data: {
        results: entry.results
      }
    });
  }
}


