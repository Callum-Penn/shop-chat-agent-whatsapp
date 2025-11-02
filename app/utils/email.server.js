/**
 * Email utility functions for sending emails
 */
import { Resend } from 'resend';

/**
 * Send an email using a simple HTTP-based email service or SMTP
 * @param {Object} emailData - Email data
 * @param {string} emailData.to - Recipient email address
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.html - HTML body content
 * @param {string} [emailData.text] - Plain text body content (optional)
 * @returns {Promise<Object>} Response from email service
 */
export async function sendEmail({ to, subject, html, text }) {
  // Check if we have the Resend API key configured
  const resendApiKey = process.env.RESEND_API_KEY;
  const mailServiceApi = process.env.MAIL_SERVICE_API;
  
  if (mailServiceApi === 'resend' && resendApiKey) {
    return await sendEmailViaResend({ to, subject, html, text });
  }
  
  // Fallback to console logging for development
  console.log('📧 Email would be sent:');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('Body:', text || html);
  
  // In production, you might want to throw an error if email is not configured
  if (process.env.NODE_ENV === 'production' && !resendApiKey) {
    throw new Error('Email service not configured. Set RESEND_API_KEY environment variable.');
  }
  
  return { success: true, message: 'Email logged to console (development mode)' };
}

/**
 * Send email via Resend using the SDK
 * @param {Object} emailData - Email data
 * @returns {Promise<Object>} Response from Resend API
 */
async function sendEmailViaResend({ to, subject, html, text }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const mailFrom = process.env.MAIL_FROM || 'noreply@vapelocal.co.uk';
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable is required');
  }
  
  const resend = new Resend(resendApiKey);
  
  try {
    const response = await resend.emails.send({
      from: mailFrom,
      to: to,
      subject: subject,
      html: html,
      text: text
    });
    
    console.log('Resend: Email sent successfully:', JSON.stringify(response));
    return response;
  } catch (error) {
    console.error('Resend: Failed to send email:', error);
    throw new Error(`Resend API error: ${error.message}`);
  }
}

/**
 * Generate HTML email template for customer service handoff
 * @param {Object} handoffData - Handoff data
 * @returns {string} HTML email content
 */
export function generateHandoffEmailHTML(handoffData) {
  const { 
    customerName, 
    customerEmail, 
    customerPhone, 
    channel, 
    conversationId,
    conversationSummary,
    lastMessages 
  } = handoffData;
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
          .info-row { margin: 10px 0; padding: 10px; background-color: white; border-left: 3px solid #4CAF50; }
          .label { font-weight: bold; color: #555; }
          .summary { background-color: white; padding: 15px; margin: 15px 0; border-radius: 3px; }
          .messages { background-color: white; padding: 15px; margin: 15px 0; border-radius: 3px; }
          .message { margin: 10px 0; padding: 10px; border-radius: 3px; }
          .message-user { background-color: #e3f2fd; }
          .message-assistant { background-color: #f5f5f5; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
          .badge-web { background-color: #2196F3; color: white; }
          .badge-whatsapp { background-color: #25D366; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🔔 New Customer Service Handoff Request</h2>
          </div>
          <div class="content">
            <div class="info-row">
              <div class="label">Customer Name:</div>
              <div>${customerName || 'Not provided'}</div>
            </div>
            <div class="info-row">
              <div class="label">Customer Email:</div>
              <div>${customerEmail || 'Not provided'}</div>
            </div>
            <div class="info-row">
              <div class="label">Customer Phone:</div>
              <div>${customerPhone || 'Not provided'}</div>
            </div>
            <div class="info-row">
              <div class="label">Channel:</div>
              <div>
                <span class="badge badge-${channel === 'whatsapp' ? 'whatsapp' : 'web'}">
                  ${channel === 'whatsapp' ? 'WhatsApp' : 'Web Chat'}
                </span>
              </div>
            </div>
            <div class="info-row">
              <div class="label">Conversation ID:</div>
              <div>${conversationId}</div>
            </div>
            
            ${conversationSummary ? `
              <div class="summary">
                <h3>Conversation Summary:</h3>
                <p>${conversationSummary}</p>
              </div>
            ` : ''}
            
            ${lastMessages && lastMessages.length > 0 ? `
              <div class="messages">
                <h3>Recent Messages:</h3>
                ${lastMessages.map(msg => `
                  <div class="message message-${msg.role}">
                    <strong>${msg.role === 'user' ? 'Customer' : 'Assistant'}:</strong><br>
                    ${msg.content.replace(/\n/g, '<br>')}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate plain text email template for customer service handoff
 * @param {Object} handoffData - Handoff data
 * @returns {string} Plain text email content
 */
export function generateHandoffEmailText(handoffData) {
  const { 
    customerName, 
    customerEmail, 
    customerPhone, 
    channel, 
    conversationId,
    conversationSummary,
    lastMessages 
  } = handoffData;
  
  return `
New Customer Service Handoff Request

Customer Name: ${customerName || 'Not provided'}
Customer Email: ${customerEmail || 'Not provided'}
Customer Phone: ${customerPhone || 'Not provided'}
Channel: ${channel === 'whatsapp' ? 'WhatsApp' : 'Web Chat'}
Conversation ID: ${conversationId}

${conversationSummary ? `
Conversation Summary:
${conversationSummary}
` : ''}

${lastMessages && lastMessages.length > 0 ? `
Recent Messages:
${lastMessages.map(msg => `
${msg.role === 'user' ? 'Customer' : 'Assistant'}:
${msg.content}

`).join('')}
` : ''}
  `.trim();
}

