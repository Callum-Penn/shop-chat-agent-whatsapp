# User Management & Conversation Archiving Guide

This guide explains the new user identification, conversation management, and archiving system implemented for the Shop Chat Agent.

## 🎯 What's New

### 1. **Persistent User Identification**
- **Web Users**: Now use cookies instead of sessionStorage for persistent identification
- **WhatsApp Users**: Continue using phone number-based identification
- **Shopify Customers**: Can be linked to their Shopify customer ID when logged in

### 2. **User Database Model**
- All users (web, WhatsApp, Shopify customers) are tracked in a `User` table
- Conversations are now linked to users for better tracking and analytics
- User activity timestamps for last seen tracking

### 3. **Conversation Archiving**
- Automatic archiving of inactive conversations (30+ days)
- Automatic deletion of old archived conversations (90+ days)
- Prevents database bloat and improves performance

---

## 📊 Database Schema

### User Model
```prisma
model User {
  id                String         @id @default(cuid())
  type              String         // "web", "whatsapp", "web_customer"
  shopifyCustomerId String?        @unique
  phoneNumber       String?        @unique
  email             String?
  name              String?
  conversations     Conversation[]
  lastSeenAt        DateTime       @default(now())
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
}
```

### Updated Conversation Model
```prisma
model Conversation {
  id        String    @id
  userId    String?
  user      User?     @relation(fields: [userId], references: [id])
  channel   String    @default("web") // "web", "whatsapp"
  messages  Message[]
  archived  Boolean   @default(false)
  metadata  Json?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

---

## 🔧 Implementation Details

### Web Chat - Cookie-Based Identification

**Before:** Used `sessionStorage` (lost on browser close)
**After:** Uses cookies with 90-day expiration

```javascript
// Cookie functions in chat.js
CookieManager.set('shopAiConversationId', conversationId, 90); // 90 days
const conversationId = CookieManager.get('shopAiConversationId');
```

**Benefits:**
- Persistent across browser sessions
- Works across tabs
- Survives browser restarts
- Users can resume conversations on same device

### User Creation & Linking

**Web Users:**
```javascript
// Anonymous web user
const user = await createOrGetUser({
  type: 'web',
  email: customerEmail // optional
});

// Logged-in Shopify customer
const user = await createOrGetUser({
  type: 'web_customer',
  shopifyCustomerId: customerId,
  email: customerEmail,
  name: customerName
});
```

**WhatsApp Users:**
```javascript
const user = await createOrGetUser({
  type: 'whatsapp',
  phoneNumber: phoneNumber
});
```

---

## 🗄️ Conversation Archiving

### Automatic Archiving

The system includes automatic archiving to prevent database bloat:

1. **Inactive Conversations** (30+ days): Marked as archived
2. **Old Archives** (90+ days): Permanently deleted with messages

### Running Archiving Tasks

#### Option 1: API Endpoint (Recommended for Cron Jobs)

```bash
# Run all archiving tasks
curl -X POST https://your-domain.com/api/archiving \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "run_all"}'

# Archive specific conversation
curl -X POST https://your-domain.com/api/archiving \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "archive_conversation", "conversationId": "abc123"}'
```

#### Option 2: Direct Function Call

```javascript
import { runArchivingTasks } from './app/services/archiving.server.js';

// Run in a scheduled job
await runArchivingTasks();
```

### Setting Up Cron Job

Add to your cron schedule (runs daily at 2 AM):

```bash
0 2 * * * curl -X POST https://your-domain.com/api/archiving \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "run_all"}' >> /var/log/archiving.log 2>&1
```

---

## 🔒 Security

### API Key Setup

Add to your `.env` file:

```bash
ARCHIVING_API_KEY=your_secure_random_key_here
```

Generate a secure key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Cookie Security

Cookies are set with:
- `SameSite=Lax` for CSRF protection
- 90-day expiration
- Path scope: `/`

---

## 🚀 Migration Guide

### 1. Run Database Migration

**Option A: If you have database access**
```bash
cd shop-chat-agent
npx prisma migrate deploy
```

**Option B: Manual migration**
Run the SQL in `prisma/migrations/20250118000001_add_user_model_and_archiving/migration.sql` on your PostgreSQL database.

### 2. Update Environment Variables

Add to `.env`:
```bash
ARCHIVING_API_KEY=your_secure_api_key
```

### 3. Deploy Changes

Deploy the updated codebase to your production environment.

### 4. Verify

Check that:
- Web chat creates cookies (check browser DevTools → Application → Cookies)
- Conversations are linked to users (check database `User` and `Conversation` tables)
- Archiving endpoint responds: `GET https://your-domain.com/api/archiving`

---

## 📈 Analytics & Insights

With the new user system, you can now:

### Track User Engagement
```sql
-- Most active users
SELECT u.id, u.type, u.phoneNumber, u.email, COUNT(c.id) as conversation_count
FROM "User" u
LEFT JOIN "Conversation" c ON c."userId" = u.id
GROUP BY u.id
ORDER BY conversation_count DESC
LIMIT 10;
```

### Monitor Conversation Health
```sql
-- Active vs archived conversations
SELECT 
  archived,
  COUNT(*) as count
FROM "Conversation"
GROUP BY archived;
```

### User Types Distribution
```sql
-- Distribution of user types
SELECT type, COUNT(*) as count
FROM "User"
GROUP BY type;
```

---

## 🔍 Available Database Functions

### User Management

- `createOrGetUser({ type, shopifyCustomerId?, phoneNumber?, email?, name? })` - Create or retrieve user
- `updateUser(userId, data)` - Update user information
- `getUserById(userId)` - Get user with conversations
- `linkConversationToUser(conversationId, userId, channel)` - Link conversation to user

### Conversation Archiving

- `archiveInactiveConversations(daysInactive)` - Archive old conversations
- `archiveConversation(conversationId)` - Archive specific conversation
- `unarchiveConversation(conversationId)` - Unarchive conversation
- `deleteOldArchivedConversations(daysArchived)` - Delete old archives
- `getConversationWithUser(conversationId)` - Get conversation with user data

### Message Management

- `saveMessage(conversationId, role, content)` - Save message
- `getConversationHistory(conversationId, limit)` - Get messages
- `cleanupOldMessages(conversationId, keepCount)` - Cleanup old messages

---

## 🎨 Frontend Changes

### Passing Shopify Customer Data

To link web users to Shopify customers, pass customer data in the chat request:

```javascript
// In your Shopify theme or app embed
const requestBody = {
  message: userMessage,
  conversation_id: conversationId,
  
  // Add these if customer is logged in
  shopify_customer_id: window.Shopify?.customer?.id,
  customer_email: window.Shopify?.customer?.email,
  customer_name: `${window.Shopify?.customer?.first_name} ${window.Shopify?.customer?.last_name}`
};
```

---

## 🐛 Troubleshooting

### Issue: Conversations not linking to users

**Check:**
1. Database migration ran successfully
2. User creation logs show no errors
3. `linkConversationToUser` is being called

**Fix:**
```javascript
// Check console logs for errors
console.log('User created/linked:', user.id);
```

### Issue: Cookies not persisting

**Check:**
1. Domain matches between cookie and site
2. No third-party cookie blocking
3. HTTPS in production

**Fix:**
```javascript
// Add secure flag in production
const expires = "expires=" + date.toUTCString();
const secure = window.location.protocol === 'https:' ? ';Secure' : '';
document.cookie = name + "=" + value + ";" + expires + ";path=/;SameSite=Lax" + secure;
```

### Issue: Archiving tasks not running

**Check:**
1. API key is set correctly
2. Endpoint is accessible
3. Cron job is scheduled

**Fix:**
```bash
# Test endpoint manually
curl https://your-domain.com/api/archiving

# Check cron logs
tail -f /var/log/archiving.log
```

---

## 📝 Best Practices

1. **Run archiving daily** - Prevents database bloat
2. **Monitor user growth** - Track user table size
3. **Backup before migration** - Always backup production database
4. **Test in staging first** - Verify changes work as expected
5. **Monitor cookie size** - Ensure not exceeding browser limits (4KB)

---

## 📞 Support

For issues or questions:
1. Check console logs for errors
2. Verify database schema matches expected
3. Test archiving endpoint manually
4. Review user creation logs

---

## 🔄 Future Enhancements

Potential improvements to consider:

1. **User Profiles** - Store preferences, settings
2. **Cross-Device Sync** - Link web and WhatsApp users
3. **Analytics Dashboard** - Visualize user engagement
4. **Customer Segmentation** - Group users by behavior
5. **Conversation Export** - Allow users to download history

---

## 📄 License

This implementation follows the same license as the main Shop Chat Agent project.

