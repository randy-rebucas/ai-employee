-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "autonomy" TEXT NOT NULL DEFAULT 'advisor',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Agent" ("autonomy", "createdAt", "department", "description", "id", "jobTitle", "key", "name", "shop", "updatedAt") SELECT "autonomy", "createdAt", "department", "description", "id", "jobTitle", "key", "name", "shop", "updatedAt" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE INDEX "Agent_shop_idx" ON "Agent"("shop");
CREATE UNIQUE INDEX "Agent_shop_key_key" ON "Agent"("shop", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
