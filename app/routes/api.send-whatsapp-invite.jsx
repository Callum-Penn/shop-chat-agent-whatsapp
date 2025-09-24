import { json } from "@remix-run/node";
import { sendWhatsAppMessage } from "../utils/whatsapp.server";

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