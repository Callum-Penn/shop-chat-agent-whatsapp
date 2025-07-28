import { json } from "@remix-run/node";

// Helper to send a message back to WhatsApp (reuse from whatsapp-webhook)
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  
  console.log('WhatsApp API Request:', {
    url,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    to,
    payload
  });
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    const responseData = await response.json();
    console.log('WhatsApp API Response:', {
      status: response.status,
      statusText: response.statusText,
      data: responseData
    });
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${response.status} ${response.statusText} - ${JSON.stringify(responseData)}`);
    }
    
    return responseData;
  } catch (error) {
    console.error('WhatsApp API Error:', error);
    throw error;
  }
}

export const action = async ({ request }) => {
  try {
    const { phoneNumber } = await request.json();
    if (!phoneNumber) {
      return json({ error: "Phone number is required." }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    console.log('Received WhatsApp invite request for:', phoneNumber);
    
    // Send WhatsApp invite message
    const result = await sendWhatsAppMessage(phoneNumber, "Hi! You can continue your chat with our AI assistant here on WhatsApp.");
    
    console.log('WhatsApp message sent successfully:', result);
    
    return json({ status: "sent", result }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error in WhatsApp invite action:', error);
    return json({ 
      error: "Failed to send WhatsApp message", 
      details: error.message 
    }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }
};

// Handle CORS preflight requests (OPTIONS)
export const loader = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  return new Response('Method not allowed', { status: 405 });
}; 