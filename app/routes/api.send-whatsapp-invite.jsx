import { json } from "@remix-run/node";
import { sendWhatsAppTemplate } from "../utils/whatsapp.server";

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
    
    // Send WhatsApp template message (bypasses 24-hour window)
    // Using the default 'hello_world' template which is pre-approved by Meta
    const result = await sendWhatsAppTemplate(phoneNumber, 'hello_world', 'en_US');
    
    return json({ success: true, messageId: result.messages?.[0]?.id || null });
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