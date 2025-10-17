# Deployment Checklist - User Management & Archiving System

Use this checklist to deploy the new user management and archiving features.

## ⚠️ Pre-Deployment

- [ ] **Backup Production Database**
  ```bash
  pg_dump -h your-db-host -U your-username -d your-database > backup_$(date +%Y%m%d_%H%M%S).sql
  ```

- [ ] **Review Changes**
  - [ ] Read `USER_MANAGEMENT_GUIDE.md`
  - [ ] Review database migration SQL
  - [ ] Understand new cookie behavior

- [ ] **Test in Development/Staging**
  - [ ] Web chat creates cookies correctly
  - [ ] WhatsApp users are created and linked
  - [ ] Conversation history persists across sessions
  - [ ] Archiving functions work without errors

---

## 🗄️ Database Migration

### Step 1: Connect to Database

```bash
# Local PostgreSQL
psql -U your_username -d your_database

# Or using connection string
psql postgresql://user:password@host:port/database
```

### Step 2: Run Migration

**Option A: Using Prisma (Recommended)**
```bash
cd shop-chat-agent
npx prisma migrate deploy
```

**Option B: Manual SQL**
```bash
psql -U your_username -d your_database -f prisma/migrations/20250118000001_add_user_model_and_archiving/migration.sql
```

### Step 3: Verify Tables Created

```sql
-- Check User table exists
SELECT * FROM "User" LIMIT 1;

-- Check Conversation table updated
\d "Conversation"

-- Verify indexes created
\di "User_*"
```

Expected output:
- `User` table exists with columns: id, type, shopifyCustomerId, phoneNumber, email, name, lastSeenAt, createdAt, updatedAt
- `Conversation` table has new columns: userId, channel, archived, metadata
- Indexes created on User and Conversation tables

---

## 🔧 Environment Configuration

### Step 1: Update .env File

Add these variables to your `.env`:

```bash
# Generate secure API key
ARCHIVING_API_KEY=<generate_secure_key_here>

# Existing variables should remain
DATABASE_URL=postgresql://...
CLAUDE_API_KEY=...
# ... other variables
```

### Step 2: Generate Secure API Key

```bash
# On Linux/Mac
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and set as `ARCHIVING_API_KEY`.

---

## 📦 Code Deployment

### Step 1: Deploy Updated Code

```bash
# Pull latest changes
git pull origin main

# Install dependencies (if needed)
npm install

# Build for production
npm run build

# Restart your application
# (method depends on your hosting setup)
```

### Step 2: Verify Deployment

- [ ] Application starts without errors
- [ ] Check logs for any startup errors
- [ ] Web interface loads correctly
- [ ] API endpoints respond

---

## ✅ Post-Deployment Verification

### 1. Test Web Chat Cookie Persistence

1. Open web chat in browser
2. Send a message
3. Check cookies in DevTools (F12 → Application → Cookies)
4. Verify `shopAiConversationId` cookie exists with 90-day expiration
5. Close and reopen browser
6. Verify conversation history loads

**Expected:** Cookie persists and conversation resumes

### 2. Test WhatsApp User Creation

1. Send WhatsApp message to bot
2. Check database for user creation:
   ```sql
   SELECT * FROM "User" WHERE type = 'whatsapp' ORDER BY "createdAt" DESC LIMIT 1;
   ```
3. Check conversation linking:
   ```sql
   SELECT c.id, c.channel, u.phoneNumber 
   FROM "Conversation" c 
   JOIN "User" u ON c."userId" = u.id 
   WHERE u.type = 'whatsapp' 
   ORDER BY c."createdAt" DESC LIMIT 5;
   ```

**Expected:** User and conversation created with phoneNumber

### 3. Test Archiving Endpoint

```bash
# Check endpoint status
curl https://your-domain.com/api/archiving

# Run archiving tasks (use your actual API key)
curl -X POST https://your-domain.com/api/archiving \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "run_all"}'
```

**Expected Response:**
```json
{
  "timestamp": "2025-01-18T12:00:00.000Z",
  "tasksRun": [
    {"task": "archive_inactive_conversations", "result": "Archived X conversations", "count": X},
    {"task": "delete_old_archived_conversations", "result": "Deleted Y conversations", "count": Y}
  ],
  "success": true
}
```

### 4. Verify Database Integrity

```sql
-- Check user count by type
SELECT type, COUNT(*) as count FROM "User" GROUP BY type;

-- Check conversation-user linking
SELECT 
  (SELECT COUNT(*) FROM "Conversation" WHERE "userId" IS NOT NULL) as linked,
  (SELECT COUNT(*) FROM "Conversation" WHERE "userId" IS NULL) as unlinked;

-- Check archived conversations
SELECT archived, COUNT(*) FROM "Conversation" GROUP BY archived;
```

---

## 🔄 Setup Automated Archiving

### Option 1: Cron Job (Linux/Mac)

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * curl -X POST https://your-domain.com/api/archiving -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"action": "run_all"}' >> /var/log/shop-chat-archiving.log 2>&1
```

### Option 2: GitHub Actions (if using GitHub)

Create `.github/workflows/archiving.yml`:

```yaml
name: Daily Archiving

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:  # Manual trigger

jobs:
  archive:
    runs-on: ubuntu-latest
    steps:
      - name: Run Archiving Tasks
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/archiving \
            -H "Authorization: Bearer ${{ secrets.ARCHIVING_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"action": "run_all"}'
```

### Option 3: DigitalOcean App Platform (if using DO)

Add a cron job in your app spec:

```yaml
jobs:
  - name: archiving
    kind: PRE_DEPLOY
    run_command: node scripts/run-archiving.js
    schedule: "0 2 * * *"
```

---

## 🎯 Success Criteria

Deployment is successful when:

- [x] Database migration completed without errors
- [x] No application errors in logs
- [x] Web chat creates persistent cookies
- [x] WhatsApp users are created and linked to conversations
- [x] Conversation history persists across sessions
- [x] Archiving API endpoint responds correctly
- [x] Cron job scheduled for automated archiving
- [x] No existing functionality broken

---

## 🐛 Rollback Plan

If issues occur, follow this rollback procedure:

### 1. Revert Code

```bash
git revert <commit_hash>
git push origin main
```

### 2. Revert Database (if necessary)

⚠️ **CAUTION:** This will lose new data created after migration

```bash
# Restore from backup
psql -U your_username -d your_database < backup_file.sql
```

### 3. Safer Alternative: Disable New Features

If data loss is unacceptable, comment out user creation code:

```javascript
// In chat.jsx and api.whatsapp-webhook.jsx
// Comment out these lines:
// const user = await createOrGetUser(...);
// await linkConversationToUser(...);
```

---

## 📊 Monitoring

### Things to Monitor Post-Deployment

1. **User Table Growth**
   ```sql
   SELECT DATE("createdAt"), COUNT(*) 
   FROM "User" 
   GROUP BY DATE("createdAt") 
   ORDER BY DATE("createdAt") DESC 
   LIMIT 7;
   ```

2. **Conversation Archiving Stats**
   ```sql
   SELECT 
     COUNT(*) FILTER (WHERE archived = false) as active,
     COUNT(*) FILTER (WHERE archived = true) as archived
   FROM "Conversation";
   ```

3. **Database Size**
   ```sql
   SELECT 
     pg_size_pretty(pg_database_size(current_database())) as db_size,
     pg_size_pretty(pg_total_relation_size('"User"')) as user_table_size,
     pg_size_pretty(pg_total_relation_size('"Conversation"')) as conversation_table_size,
     pg_size_pretty(pg_total_relation_size('"Message"')) as message_table_size;
   ```

4. **Application Logs**
   - Watch for "User created/linked" log messages
   - Check for any database connection errors
   - Monitor archiving task execution logs

---

## 📞 Support & Troubleshooting

### Common Issues

**Issue:** "Table 'User' does not exist"
- **Fix:** Run database migration again

**Issue:** "ARCHIVING_API_KEY not set"
- **Fix:** Add variable to .env and restart application

**Issue:** Cookies not persisting
- **Fix:** Check domain settings and HTTPS in production

**Issue:** Archiving cron job not running
- **Fix:** Verify cron schedule and check system logs

---

## ✨ Next Steps

After successful deployment:

1. Monitor system for 24 hours
2. Review user creation patterns
3. Check archiving task results after first run
4. Consider implementing analytics dashboard
5. Plan for future enhancements (see USER_MANAGEMENT_GUIDE.md)

---

**Deployment Date:** _____________

**Deployed By:** _____________

**Notes:**

_____________________________________________

_____________________________________________

_____________________________________________

