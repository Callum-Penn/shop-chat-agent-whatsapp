-- CreateTable
CREATE TABLE "ProductQuantityIncrement" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "increment" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "productTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductQuantityIncrement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductQuantityIncrement_entityId_key" ON "ProductQuantityIncrement"("entityId");

-- CreateIndex
CREATE INDEX "ProductQuantityIncrement_entityType_idx" ON "ProductQuantityIncrement"("entityType");

