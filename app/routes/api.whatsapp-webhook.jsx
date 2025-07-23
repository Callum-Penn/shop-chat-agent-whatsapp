import { json } from "@remix-run/node";
import { createClaudeService } from "../services/claude.server";

// Helper to send a message back to WhatsApp
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

const claude = createClaudeService();

export const action = async ({ request }) => {
  const body = await request.json();
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (message && message.text) {
    const userMessage = message.text.body;
    const from = message.from;
    // Call Claude AI for a response
    const aiResult = await claude.streamConversation({
      messages: [
        { role: "user", content: userMessage }
      ]
    }, {});
    const aiResponse = aiResult?.content?.[0]?.text || "Sorry, I couldn't generate a response.";
    await sendWhatsAppMessage(from, aiResponse);
  }
  return json({ status: "ok" });
};

// WhatsApp webhook verification (GET request)
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}; 