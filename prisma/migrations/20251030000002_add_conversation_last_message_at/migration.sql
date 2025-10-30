-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

