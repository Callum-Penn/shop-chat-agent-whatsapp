import { json } from "@remix-run/node";

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
    };

    broadcastLog.unshift(entry);
    if (broadcastLog.length > MAX_ENTRIES) {
      broadcastLog.length = MAX_ENTRIES;
    }

    return json(entry, { status: 201 });
  } catch (error) {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
};


