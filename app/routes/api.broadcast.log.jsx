import { json } from "@remix-run/node";
import { sendWhatsAppMessage } from "../utils/whatsapp.server";

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
    if (whatsapp && Array.isArray(phones) && phones.length > 0) {
      processWhatsAppBroadcast(entry, phones, message.trim());
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
async function processWhatsAppBroadcast(entry, phones, message) {
  console.log(`Broadcast: Processing WhatsApp messages to ${phones.length} recipients`);
  
  for (const phone of phones) {
    try {
      await sendWhatsAppMessage(phone, message);
      entry.results.whatsapp.sent++;
      console.log(`Broadcast: WhatsApp message sent to ${phone}`);
    } catch (error) {
      entry.results.whatsapp.failed++;
      entry.results.whatsapp.errors.push({
        phone,
        error: error.message
      });
      console.error(`Broadcast: Failed to send WhatsApp message to ${phone}:`, error.message);
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


