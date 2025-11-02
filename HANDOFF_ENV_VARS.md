# Customer Service Handoff - Environment Variables

This document lists the environment variables required for the customer service handoff feature.

## Required Environment Variables

### Email Configuration (Resend)

To enable email handoff notifications, configure Resend:

```bash
MAIL_SERVICE_API=resend
RESEND_API_KEY=your_resend_api_key_here
MAIL_FROM=noreply@yourdomain.com  # Optional, defaults to noreply@vapelocal.co.uk
```

### Support Email

Set the email address where customer service handoff notifications should be sent:

```bash
SUPPORT_EMAIL=support@yourdomain.com  # Defaults to support@vapelocal.co.uk if not set
```

## Development vs Production

- **Development**: If `RESEND_API_KEY` is not set, emails will be logged to the console instead of being sent.
- **Production**: If `RESEND_API_KEY` is not set, the application will throw an error when attempting to send handoff emails.

## How to Get Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Create an API key in your dashboard
3. Add it to `RESEND_API_KEY`

## Digital Ocean Configuration

For Digital Ocean App Platform, add these environment variables in your app settings:

1. Go to your Digital Ocean App Platform dashboard
2. Navigate to Settings > App-Level Environment Variables
3. Add each variable listed above with its corresponding value:
   - `MAIL_SERVICE_API=resend`
   - `RESEND_API_KEY=your_key_here`
   - `SUPPORT_EMAIL=support@yourdomain.com`
4. Redeploy your application

## Testing

To test the handoff feature without sending real emails in development:
- Don't set `RESEND_API_KEY` - emails will be logged to console
- Check your server logs to see the email that would be sent

