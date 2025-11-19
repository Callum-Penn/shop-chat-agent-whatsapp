UPDATE "Message" SET "readAt" = "createdAt" WHERE "role" = 'assistant' AND "readAt" IS NULL;
