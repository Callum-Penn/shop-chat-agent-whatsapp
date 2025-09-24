import { json } from "@remix-run/node";
import { getCustomerToken, storeCustomerToken } from "../db.server";
import { sendWhatsAppMessage } from "./api.whatsapp-webhook";

// Helper to send a message back to WhatsApp (reuse from whatsapp-webhook)
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  
  console.log('WhatsApp Auth: Sending message to', to);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    console.error('WhatsApp Auth: Failed to send message:', response.status, response.statusText);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  
  console.log('WhatsApp Auth: Message sent successfully');
}

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  
  console.log('WhatsApp Auth: Callback received', { code: !!code, state, error });
  
  if (error) {
    console.error('WhatsApp Auth: OAuth error:', error);
    return json({ success: false, error });
  }
  
  if (!code || !state) {
    console.error('WhatsApp Auth: Missing code or state');
    return json({ success: false, error: 'Missing authorization code or state' });
  }
  
  try {
    // Parse state to get conversation ID and shop ID
    const stateParts = state.split("-");
    const conversationId = stateParts[1];
    const shopId = stateParts[2];
    
    console.log('WhatsApp Auth: Processing for conversation:', conversationId, 'shop:', shopId);
    
    // Extract phone number from conversation ID (format: whatsapp_phoneNumber)
    const phoneNumber = conversationId.replace('whatsapp_', '');
    
    // Exchange code for token
    const tokenUrl = await getTokenUrl(shopId, conversationId);
    console.log('WhatsApp Auth: Token URL:', tokenUrl);
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.SHOPIFY_API_KEY,
        code: code,
        redirect_uri: `${process.env.APP_URL}/api/whatsapp-auth-callback`,
        code_verifier: await getCodeVerifier(conversationId)
      })
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('WhatsApp Auth: Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${errorText}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('WhatsApp Auth: Token received, length:', tokenData.access_token?.length);
    
    // Store the token
    await storeCustomerToken(conversationId, tokenData.access_token);
    console.log('WhatsApp Auth: Token stored for conversation:', conversationId);
    
    // Send success message to WhatsApp user
    const successMessage = "✅ Authorization successful! I can now help you with your order information. Please send me a message and I'll be able to assist you with your orders.";
    await sendWhatsAppMessage(phoneNumber, successMessage);
    
    console.log('WhatsApp Auth: Success message sent to user');
    
    return json({ success: true });
    
  } catch (error) {
    console.error('WhatsApp Auth: Callback error:', error);
    
    // Try to send error message to user if we have the phone number
    try {
      const stateParts = state.split("-");
      const conversationId = stateParts[1];
      const phoneNumber = conversationId.replace('whatsapp_', '');
      
      const errorMessage = "❌ Authorization failed. Please try again or contact support if the issue persists.";
      await sendWhatsAppMessage(phoneNumber, errorMessage);
    } catch (sendError) {
      console.error('WhatsApp Auth: Failed to send error message:', sendError);
    }
    
    return json({ success: false, error: error.message });
  }
};

// Helper to get token URL (reuse from auth.callback.jsx)
async function getTokenUrl(shopId, conversationId) {
  const { getCustomerAccountUrl } = await import('../db.server');
  let customerAccountUrl = await getCustomerAccountUrl(conversationId);
  
  // Hardcode the customer account URL for vapelocal.co.uk
  if (!customerAccountUrl) {
    console.log('WhatsApp Auth: Using hardcoded customer account URL for vapelocal.co.uk');
    customerAccountUrl = 'https://account.vapelocal.co.uk';
  }
  
  return `${customerAccountUrl}/authentication/oauth/token`;
}

// Helper to get code verifier (reuse from auth.callback.jsx)
async function getCodeVerifier(conversationId) {
  const { getCodeVerifier } = await import('../db.server');
  return await getCodeVerifier(conversationId);
}
