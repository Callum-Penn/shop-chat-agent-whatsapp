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

/**
 * Send an image message to WhatsApp
 * @param {string} to - Phone number to send message to
 * @param {string} imageData - Base64 encoded image data
 * @param {string} caption - Optional caption for the image
 * @returns {Promise<Object>} Response from WhatsApp API
 */
export async function sendWhatsAppImage(to, imageData, caption = '') {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const token = process.env.WHATSAPP_TOKEN;
  
  // Convert base64 to buffer
  const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
  
  // Create form data for multipart upload
  const FormData = require('form-data');
  const form = new FormData();
  
  form.append('messaging_product', 'whatsapp');
  form.append('to', to);
  form.append('type', 'image');
  form.append('image', imageBuffer, {
    filename: 'image.jpg',
    contentType: 'image/jpeg'
  });
  
  if (caption) {
    form.append('caption', caption);
  }
  
  console.log('WhatsApp: Sending image to', to);
  console.log('WhatsApp: Image size:', imageBuffer.length, 'bytes');
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      ...form.getHeaders()
    },
    body: form
  });
  
  const responseData = await response.json();
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send image:', response.status, response.statusText);
    console.error('WhatsApp: Error response:', JSON.stringify(responseData, null, 2));
    throw new Error(`WhatsApp API error: ${response.status} - ${responseData.error?.message || response.statusText}`);
  }
  
  console.log('WhatsApp: Image sent successfully:', JSON.stringify(responseData));
  return responseData;
}

/**
 * Download media from WhatsApp
 * @param {string} mediaId - Media ID from WhatsApp
 * @returns {Promise<{buffer: Buffer, mimeType: string, fileSize: number}>} File data and metadata
 */
export async function downloadWhatsAppMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  
  console.log('WhatsApp: Getting media URL for ID:', mediaId);
  
  // Step 1: Get the media URL
  const mediaUrlResponse = await fetch(
    `https://graph.facebook.com/v22.0/${mediaId}`,
    {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    }
  );
  
  if (!mediaUrlResponse.ok) {
    throw new Error(`Failed to get media URL: ${mediaUrlResponse.status}`);
  }
  
  const mediaData = await mediaUrlResponse.json();
  const mediaUrl = mediaData.url;
  const mimeType = mediaData.mime_type;
  const fileSize = mediaData.file_size;
  
  console.log('WhatsApp: Downloading media from:', mediaUrl);
  console.log('WhatsApp: File type:', mimeType, 'Size:', fileSize);
  
  // Step 2: Download the actual file
  const fileResponse = await fetch(mediaUrl, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  
  if (!fileResponse.ok) {
    throw new Error(`Failed to download media: ${fileResponse.status}`);
  }
  
  const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
  
  console.log('WhatsApp: Media downloaded successfully, size:', fileBuffer.length, 'bytes');
  
  return {
    buffer: fileBuffer,
    mimeType: mimeType,
    fileSize: fileSize
  };
}

/**
 * Send a document to WhatsApp
 * @param {string} to - Phone number to send to
 * @param {Buffer} fileBuffer - File data
 * @param {string} filename - Original filename
 * @param {string} caption - Optional caption
 * @returns {Promise<Object>} Response from WhatsApp API
 */
export async function sendWhatsAppDocument(to, fileBuffer, filename, caption = '') {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  console.log('WhatsApp: Uploading document:', filename, 'Size:', fileBuffer.length, 'bytes');
  
  // Step 1: Upload the file to WhatsApp
  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('file', fileBuffer, { filename: filename });
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); // Default to Excel
  
  const uploadResponse = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/media`,
    {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${token}`,
        ...formData.getHeaders()
      },
      body: formData
    }
  );
  
  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json();
    console.error('WhatsApp: File upload failed:', JSON.stringify(errorData));
    throw new Error(`Failed to upload media: ${uploadResponse.status}`);
  }
  
  const uploadData = await uploadResponse.json();
  const mediaId = uploadData.id;
  
  console.log('WhatsApp: File uploaded, media ID:', mediaId);
  
  // Step 2: Send the document message
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      caption: caption,
      filename: filename
    }
  };
  
  const response = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  
  const responseData = await response.json();
  
  if (!response.ok) {
    console.error('WhatsApp: Failed to send document:', JSON.stringify(responseData));
    throw new Error(`Failed to send document: ${response.status}`);
  }
  
  console.log('WhatsApp: Document sent successfully');
  return responseData;
}

/**
 * Send a document from a URL to WhatsApp
 * @param {string} to - Phone number to send to
 * @param {string} fileUrl - URL of the file to download and send
 * @param {string} filename - Filename to use when sending
 * @param {string} caption - Optional caption
 * @returns {Promise<Object>} Response from WhatsApp API
 */
export async function sendWhatsAppDocumentFromUrl(to, fileUrl, filename, caption = '') {
  console.log('WhatsApp: Downloading file from URL:', fileUrl);
  
  try {
    // Download the file from the URL
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from URL: ${fileResponse.status}`);
    }
    
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    console.log('WhatsApp: File downloaded from URL, size:', fileBuffer.length, 'bytes');
    
    // Send the document using the existing function
    return await sendWhatsAppDocument(to, fileBuffer, filename, caption);
    
  } catch (error) {
    console.error('WhatsApp: Error downloading/sending file from URL:', error);
    throw error;
  }
}
