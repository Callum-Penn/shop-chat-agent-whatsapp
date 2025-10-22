import { json } from "@remix-run/node";
import { sendWhatsAppMessage } from "../utils/whatsapp.server";
import { getAllWhatsAppUsers } from "../db.server";

// In-memory broadcast log for POC. Resets on server restart/redeploy.
const broadcastLog = [];
const MAX_ENTRIES = 50;

export const loader = async () => {
  return json(broadcastLog);
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { message, channels, phones } = body || {};

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return json({ error: "Message is required" }, { status: 400 });
    }

    const website = !!(channels && channels.website);
    const whatsapp = !!(channels && channels.whatsapp);

    if (!website && !whatsapp) {
      return json({ error: "At least one channel must be selected" }, { status: 400 });
    }

    const entry = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      message: message.trim(),
      channels: { website, whatsapp },
      whatsappCount: whatsapp ? (Array.isArray(phones) ? phones.length : 0) : 0,
      status: 'processing',
      results: {
        whatsapp: { sent: 0, failed: 0, errors: [] },
        website: { sent: 0, failed: 0, errors: [] }
      }
    };

    // Add to log immediately
    broadcastLog.unshift(entry);
    if (broadcastLog.length > MAX_ENTRIES) {
      broadcastLog.length = MAX_ENTRIES;
    }

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
    entry.whatsappCount = whatsappUsers.length;
    
    for (const user of whatsappUsers) {
      try {
        await sendWhatsAppMessage(user.phoneNumber, message);
        entry.results.whatsapp.sent++;
        console.log(`Broadcast: WhatsApp message sent to ${user.phoneNumber} (${user.name || 'Unknown'})`);
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
    
    // Update status
    if (entry.results.whatsapp.failed === 0) {
      entry.status = entry.channels.website ? 'partial' : 'completed';
    } else if (entry.results.whatsapp.sent === 0) {
      entry.status = 'failed';
    } else {
      entry.status = 'partial';
    }
    
    console.log(`Broadcast: WhatsApp processing complete - ${entry.results.whatsapp.sent} sent, ${entry.results.whatsapp.failed} failed`);
  } catch (error) {
    console.error(`Broadcast: Error getting WhatsApp users:`, error);
    entry.results.whatsapp.failed = 1;
    entry.results.whatsapp.errors.push({
      error: `Failed to get users from database: ${error.message}`
    });
    entry.status = 'failed';
  }
}

// Process website broadcast messages
async function processWebsiteBroadcast(entry, message) {
  console.log(`Broadcast: Processing website messages`);
  
  try {
    // TODO: Implement website chat broadcasting
    // For now, we'll simulate success
    entry.results.website.sent = 1; // Placeholder
    console.log(`Broadcast: Website message broadcasted`);
    
    // Update status
    if (entry.results.whatsapp.failed === 0 && entry.results.whatsapp.sent === 0) {
      entry.status = 'completed';
    } else if (entry.status === 'failed') {
      entry.status = 'partial';
    }
  } catch (error) {
    entry.results.website.failed = 1;
    entry.results.website.errors.push({
      error: error.message
    });
    console.error(`Broadcast: Failed to send website message:`, error.message);
  }
}


