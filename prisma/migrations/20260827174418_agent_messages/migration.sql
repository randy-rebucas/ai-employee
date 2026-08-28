-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "deadline" DATETIME,
    "expectedOutput" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentMessage_shop_receiverId_idx" ON "AgentMessage"("shop", "receiverId");

-- CreateIndex
CREATE INDEX "AgentMessage_shop_senderId_idx" ON "AgentMessage"("shop", "senderId");
