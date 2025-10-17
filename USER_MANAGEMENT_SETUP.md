# User Management & Archiving Setup Guide

This guide explains the new user management system and conversation archiving features implemented in the shop-chat-agent.

## Features Implemented

### ✅ 1. Cookie-Based Web User Identification
- **Persistent Storage**: Web conversations now use cookies instead of sessionStorage
- **Duration**: 90-day cookie lifespan
- **Shopify Integration**: Automatically links to Shopify customer ID when logged in
- **Anonymous Support**: Creates unique IDs for non-logged-in users

### ✅ 2. User Metadata Table
- **User Model**: Tracks users across web and WhatsApp channels
- **Unified Identity**: Links multiple conversations to single user
- **Metadata Storage**: Stores preferences, first seen date, source channel

### ✅ 3. Conversation Archiving
- **Automatic Archiving**: Archives conversations inactive for 30+ days
- **Cleanup**: Deletes archived conversations older than 90 days
- **Statistics**: Monitor database health and conversation metrics

---

## Database Migration

### Apply Migration to Production

**Important**: Run this migration on your production database before deploying the code changes.

```bash
# Navigate to project directory
cd shop-chat-agent

# Apply migration (will connect to DATABASE_URL from .env)
npx prisma migrate deploy
```

The migration file is located at:
```
prisma/migrations/20250520000002_add_user_model_and_conversation_updates/migration.sql
```

### Verify Migration

```bash
# Check database schema
npx prisma db pull

# Generate Prisma client
npx prisma generate
```

---

## User Identification Flow

### Web Users

#### Logged-In Customers
```javascript
// Conversation ID format: web_customer_{SHOPIFY_CUSTOMER_ID}
conversationId = `web_customer_${window.Shopify.customer.id}`;

// User lookup by shopifyCustomerId
// Resumes conversation across devices/sessions
```

#### Anonymous Users
```javascript
// Conversation ID format: web_anon_{TIMESTAMP}_{RANDOM}
conversationId = `web_anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// User created with anonymous flag
// Linked via cookie (90-day persistence)
```

### WhatsApp Users

```javascript
// Conversation ID format: whatsapp_{PHONE_NUMBER}
conversationId = `whatsapp_${phoneNumber}`;

// User lookup by phoneNumber
// Permanent linking via phone number
```

---

## Archiving System

### Manual Archiving

#### Trigger via API
```bash
# Run archiving process manually
curl -X POST https://your-domain.com/api/archiving

# Get database statistics
curl https://your-domain.com/api/archiving
```

#### View Statistics
```json
{
  "success": true,
  "stats": {
    "totalConversations": 1500,
    "activeConversations": 1200,
    "archivedConversations": 300,
    "totalUsers": 850,
    "totalMessages": 45000
  }
}
```

### Automatic Archiving (Recommended)

Add to your application startup code (e.g., `entry.server.jsx`):

```javascript
import { scheduleArchiving } from "./services/archiving.server";

// Run archiving every 24 hours
scheduleArchiving(24);
```

### Archiving Rules

| Action | Condition | Default Threshold |
|--------|-----------|-------------------|
| Archive | Last updated > X days ago | 30 days |
| Delete | Archived and updated > X days ago | 90 days |

### Custom Archiving Periods

```javascript
import { archiveOldConversations, deleteOldArchivedConversations } from "./db.server";

// Archive after 14 days of inactivity
await archiveOldConversations(14);

// Delete archived conversations after 60 days
await deleteOldArchivedConversations(60);
```

---

## Database Functions Reference

### User Management

```javascript
// Create or get user
const user = await createOrGetUser({
  type: 'web', // or 'whatsapp'
  shopifyCustomerId: '12345',
  phoneNumber: '+1234567890',
  email: 'user@example.com',
  name: 'John Doe',
  metadata: { preferences: {} }
});

// Get user by ID
const user = await getUserById(userId);

// Get user by phone
const user = await getUserByPhoneNumber('+1234567890');

// Get user by Shopify customer ID
const user = await getUserByShopifyCustomerId('12345');

// Update user
await updateUser(userId, { name: 'Jane Doe' });

// Link conversation to user
await linkConversationToUser(conversationId, userId, 'web');
```

### Archiving

```javascript
// Archive old conversations
const archivedCount = await archiveOldConversations(30);

// Delete old archived conversations
const deletedCount = await deleteOldArchivedConversations(90);

// Get statistics
const stats = await getConversationStats();
```

---

## Testing

### Test Web User Flow

1. **Anonymous User**:
   - Clear cookies
   - Open web chat
   - Check cookie: `shopAiConversationId` should be set
   - Send message
   - Close browser
   - Reopen and verify conversation persists

2. **Logged-In Customer**:
   - Log in to Shopify store
   - Open web chat
   - Conversation ID should be `web_customer_{ID}`
   - Switch devices/browsers
   - Log in and verify conversation syncs

### Test WhatsApp User Flow

1. Send WhatsApp message
2. Check database for User record with phoneNumber
3. Verify Conversation is linked to User
4. Send another message from same number
5. Verify it uses existing User record

### Test Archiving

```bash
# Get current stats
curl https://your-domain.com/api/archiving

# Run archiving
curl -X POST https://your-domain.com/api/archiving

# Verify stats changed
curl https://your-domain.com/api/archiving
```

---

## Monitoring

### Database Health Checks

```javascript
import { getConversationStats } from "./db.server";

// Add to your monitoring/dashboard
const stats = await getConversationStats();

// Alert if:
// - activeConversations > 10,000 (consider more aggressive archiving)
// - archivedConversations > 50,000 (run cleanup)
// - totalMessages > 1,000,000 (optimize message retention)
```

### Archiving Logs

```bash
# Check application logs for archiving results
grep "Archived" runtime-logs.txt
grep "Deleted" runtime-logs.txt
```

---

## Migration Checklist

- [ ] Apply database migration to production
- [ ] Generate Prisma client (`npx prisma generate`)
- [ ] Deploy updated code
- [ ] Test web chat (anonymous user)
- [ ] Test web chat (logged-in customer)
- [ ] Test WhatsApp flow
- [ ] Set up automatic archiving scheduler
- [ ] Verify archiving API works
- [ ] Monitor database statistics
- [ ] Set up alerts for database size

---

## Troubleshooting

### Cookie Not Persisting
- Check browser cookie settings
- Verify SameSite attribute compatibility
- Test on different browsers

### User Not Linking
- Check logs for "Error creating or getting user"
- Verify Prisma client is up to date
- Check database connection

### Archiving Not Running
- Verify scheduler is initialized
- Check application logs
- Manually trigger via API to test

### Migration Errors
- Ensure database is accessible
- Check for conflicting schema changes
- Review migration SQL for compatibility

---

## Security Considerations

1. **Archiving API**: Currently unprotected. Consider adding authentication:
   ```javascript
   // Add to api.archiving.jsx
   if (!request.headers.get('X-Admin-Token') === process.env.ADMIN_TOKEN) {
     return json({ error: 'Unauthorized' }, { status: 401 });
   }
   ```

2. **Cookie Security**: Cookies use SameSite=Lax. For HTTPS-only, update to:
   ```javascript
   document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
   ```

3. **User Data**: Consider GDPR compliance for EU users:
   - Implement user data deletion endpoint
   - Add consent tracking to User metadata
   - Document data retention policies

---

## Future Enhancements

- [ ] Cross-channel user linking (WhatsApp + Web)
- [ ] User analytics dashboard
- [ ] Conversation export feature
- [ ] Machine learning on conversation patterns
- [ ] Automatic customer profile enrichment from Shopify
- [ ] Conversation sentiment tracking

