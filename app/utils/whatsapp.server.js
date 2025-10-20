/**
 * WhatsApp utility functions
 */

/**
 * Send a message to WhatsApp
 * @param {string} to - Phone number to send message to
 * @param {string} text - Message text to send
 * @returns {Promise<Object>} Response from WhatsApp API
 */
export async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
  
  const responseData = await response.json();
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send message:', response.status, response.statusText);
    console.error('WhatsApp: Error response:', JSON.stringify(responseData, null, 2));
    
    // Check for specific WhatsApp error about messaging window
    if (responseData.error?.code === 131047 || responseData.error?.message?.includes('24 hour')) {
      console.error('WhatsApp: Message outside 24-hour window - user needs to initiate conversation');
      throw new Error('MESSAGING_WINDOW_EXPIRED: User needs to message first to open 24-hour window');
    }
    
    throw new Error(`WhatsApp API error: ${response.status} - ${responseData.error?.message || response.statusText}`);
  }
  
  console.log('WhatsApp: Message sent successfully:', JSON.stringify(responseData));
  return responseData;
}

/**
 * Send a template message to WhatsApp (bypasses 24-hour window)
 * @param {string} to - Phone number to send message to
 * @param {string} templateName - Name of the approved template
 * @param {string} languageCode - Language code (e.g., 'en_US')
 * @returns {Promise<Object>} Response from WhatsApp API
 */
export async function sendWhatsAppTemplate(to, templateName = 'hello_world', languageCode = 'en_US') {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode
      }
    }
  };
  
  console.log('WhatsApp: Sending template message to', to);
  console.log('WhatsApp: Template name:', templateName);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  
  const responseData = await response.json();
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send template:', response.status, response.statusText);
    console.error('WhatsApp: Error response:', JSON.stringify(responseData, null, 2));
    throw new Error(`WhatsApp API error: ${response.status} - ${responseData.error?.message || response.statusText}`);
  }
  
  console.log('WhatsApp: Template sent successfully:', JSON.stringify(responseData));
  return responseData;
}
