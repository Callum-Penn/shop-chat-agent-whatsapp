/**
 * WhatsApp utility functions
 */

/**
 * Send a message to WhatsApp
 * @param {string} to - Phone number to send message to
 * @param {string} text - Message text to send
 */
export async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  
  console.log('WhatsApp: Sending message to', to);
  console.log('WhatsApp: Message content:', text.substring(0, 100) + '...');
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send message:', response.status, response.statusText);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  
  console.log('WhatsApp: Message sent successfully');
}
