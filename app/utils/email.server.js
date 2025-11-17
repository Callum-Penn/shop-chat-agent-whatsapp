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
 * @param {Array} [emailData.attachments] - Array of attachment objects with { filename, content, type }
 * @returns {Promise<Object>} Response from email service
 */
const TICKET_RECEIPT_SUPPORT_HOURS = "Mon - Fri 9am to 5pm";

export async function sendEmail({ to, subject, html, text, attachments }) {
  // Check if we have the Resend API key configured
  const resendApiKey = process.env.RESEND_API_KEY;
  const mailServiceApi = process.env.MAIL_SERVICE_API;
  
  if (mailServiceApi === 'resend' && resendApiKey) {
    return await sendEmailViaResend({ to, subject, html, text, attachments });
  }
  
  // Fallback to console logging for development
  console.log('📧 Email would be sent:');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('Body:', text || html);
  if (attachments && attachments.length > 0) {
    console.log('Attachments:', attachments.map(a => a.filename).join(', '));
  }
  
  // In production, you might want to throw an error if email is not configured
  if (process.env.NODE_ENV === 'production' && !resendApiKey) {
    throw new Error('Email service not configured. Set RESEND_API_KEY environment variable.');
  }
  
  return { success: true, message: 'Email logged to console (development mode)' };
}

/**
 * Send email via Resend using the SDK
 * @param {Object} emailData - Email data
 * @param {Array} [emailData.attachments] - Array of attachment objects
 * @returns {Promise<Object>} Response from Resend API
 */
async function sendEmailViaResend({ to, subject, html, text, attachments }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const mailFrom = process.env.MAIL_FROM || 'noreply@vapelocal.co.uk';
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable is required');
  }
  
  const resend = new Resend(resendApiKey);
  
  try {
    const emailPayload = {
      from: mailFrom,
      to: to,
      subject: subject,
      html: html,
      text: text
    };
    
    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      emailPayload.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content, // Base64 encoded content
        type: att.type || 'application/octet-stream'
      }));
    }
    
    const response = await resend.emails.send(emailPayload);
    
    console.log('Resend: Email sent successfully. Email ID:', response.data?.id);
    return response;
  } catch (error) {
    console.error('Resend: Failed to send email:', error);
    throw new Error(`Resend API error: ${error.message}`);
  }
}

/**
 * Extract plain text from message content (handles both JSON string and parsed content)
 * @param {string|Array} content - Message content
 * @returns {string} Plain text representation
 */
function extractMessageText(content) {
  try {
    let parsed = content;
    
    // If it's a string, try to parse it as JSON
    if (typeof content === 'string') {
      parsed = JSON.parse(content);
    }
    
    // If it's an array (standard message format)
    if (Array.isArray(parsed)) {
      return parsed
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }
    
    // Fallback to string representation
    return String(content);
  } catch (e) {
    // If parsing fails, just return as string
    return String(content);
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
    lastMessages,
    ticketReference
  } = handoffData;
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1766ff; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
          .info-row { margin: 10px 0; padding: 10px; background-color: white; border-left: 3px solid #ffd203; }
          .label { font-weight: bold; color: #555; }
          .summary { background-color: white; padding: 15px; margin: 15px 0; border-radius: 3px; }
          .messages { background-color: white; padding: 15px; margin: 15px 0; border-radius: 3px; }
          .message { margin: 10px 0; padding: 10px; border-radius: 3px; }
          .message-user { background-color: #e3f2fd; }
          .message-assistant { background-color: #f5f5f5; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
          .badge-web { background-color: #1766ff; color: white; }
          .badge-whatsapp { background-color: #25D366; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>New Customer Service Handoff Request</h2>
          </div>
          <div class="content">
            <div class="info-row">
              <div class="label">Ticket Reference:</div>
              <div>${ticketReference ? `#${ticketReference}` : 'Pending assignment'}</div>
            </div>
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
                ${lastMessages.map(msg => {
                  const text = extractMessageText(msg.content);
                  return `
                  <div class="message message-${msg.role}">
                    <strong>${msg.role === 'user' ? 'Customer' : 'Assistant'}:</strong><br>
                    ${text.replace(/\n/g, '<br>')}
                  </div>
                `;
                }).join('')}
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
    lastMessages,
    ticketReference
  } = handoffData;
  
  return `
New Customer Service Handoff Request

Ticket Reference: ${ticketReference ? `#${ticketReference}` : 'Pending assignment'}
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
${lastMessages.map(msg => {
  const text = extractMessageText(msg.content);
  return `
${msg.role === 'user' ? 'Customer' : 'Assistant'}:
${text}

`;
}).join('')}
` : ''}
  `.trim();
}

/**
 * Generate confirmation HTML email for the customer after a ticket is created
 * @param {Object} data - Confirmation data
 * @param {string} [data.customerName] - Name to greet
 * @param {string} data.ticketReference - Ticket reference number
 * @param {string} [data.supportHours] - Support hours string
 * @returns {string} HTML email content
 */
export function generateTicketReceiptEmailHTML({
  customerName,
  ticketReference,
  supportHours = TICKET_RECEIPT_SUPPORT_HOURS
}) {
  const greetingName = customerName || "there";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; }
          .container { max-width: 560px; margin: 0 auto; padding: 24px; }
          .card { background-color: #ffffff; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
          .ticket { margin: 16px 0; padding: 12px; border-left: 4px solid #1766ff; background-color: #f0f5ff; font-weight: bold; }
          .hours { margin-top: 20px; padding: 12px; background-color: #fafafa; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <p>Hi ${greetingName},</p>
            <p>Thanks for reaching out. We've opened a support ticket and our team will be in touch shortly.</p>
            <div class="ticket">
              Reference: #${ticketReference}
            </div>
            <div class="hours">
              <strong>Customer service hours</strong>
              <p>${supportHours}</p>
            </div>
            <p>If you have any new details to share, just reply to this email and we'll add it to your ticket.</p>
            <p>- The Team</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate confirmation text email for the customer after a ticket is created
 * @param {Object} data - Confirmation data
 * @param {string} [data.customerName] - Name to greet
 * @param {string} data.ticketReference - Ticket reference number
 * @param {string} [data.supportHours] - Support hours string
 * @returns {string} Plain text email content
 */
export function generateTicketReceiptEmailText({
  customerName,
  ticketReference,
  supportHours = TICKET_RECEIPT_SUPPORT_HOURS
}) {
  const greetingName = customerName || "there";

  return `
Hi ${greetingName},

Thanks for reaching out. We've opened a support ticket for you and our team will respond shortly.

Reference: #${ticketReference}

Customer service hours:
${supportHours}

If you have more details to share, reply to this email and we'll add it to your ticket.

- The Team
  `.trim();
}

/**
 * Generate HTML email template for spreadsheet submission
 * @param {Object} submissionData - Submission data
 * @returns {string} HTML email content
 */
export function generateSpreadsheetEmailHTML(submissionData) {
  const { 
    customerPhone, 
    filename, 
    fileType, 
    fileSize,
    caption 
  } = submissionData;
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1766ff; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
          .info-row { margin: 10px 0; padding: 10px; background-color: white; border-left: 3px solid #ffd203; }
          .label { font-weight: bold; color: #555; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; background-color: #25D366; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>New Spreadsheet Order Submission</h2>
          </div>
          <div class="content">
            <div class="info-row">
              <div class="label">Customer Phone:</div>
              <div>${customerPhone || 'Not provided'}</div>
            </div>
            <div class="info-row">
              <div class="label">Filename:</div>
              <div>${filename || 'Unknown'}</div>
            </div>
            <div class="info-row">
              <div class="label">File Size:</div>
              <div>${fileSize || 'Unknown'}</div>
            </div>
            <div class="info-row">
              <div class="label">Channel:</div>
              <div>
                <span class="badge">WhatsApp</span>
              </div>
            </div>
            ${caption ? `
              <div class="info-row">
                <div class="label">Customer Note:</div>
                <div>${caption}</div>
              </div>
            ` : ''}
            <div class="info-row" style="margin-top: 20px; padding: 15px; background-color: #e8f5e9;">
              <p><strong>📎 The spreadsheet file is attached to this email.</strong></p>
              <p>Please review the order and process it accordingly.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate plain text email template for spreadsheet submission
 * @param {Object} submissionData - Submission data
 * @returns {string} Plain text email content
 */
export function generateSpreadsheetEmailText(submissionData) {
  const { 
    customerPhone, 
    filename, 
    fileType, 
    fileSize,
    caption 
  } = submissionData;
  
  return `
New Spreadsheet Order Submission

Customer Phone: ${customerPhone || 'Not provided'}
Filename: ${filename || 'Unknown'}
File Type: ${fileType || 'Unknown'}
File Size: ${fileSize || 'Unknown'}
Channel: WhatsApp

${caption ? `Customer Note:\n${caption}\n` : ''}

The spreadsheet file is attached to this email.
Please review the order and process it accordingly.
  `.trim();
}

