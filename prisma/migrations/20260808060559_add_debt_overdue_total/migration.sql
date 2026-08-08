-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_debts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "totalDebt" REAL NOT NULL,
    "limitAmount" REAL,
    "nearestPaymentDate" DATETIME,
    "overdueTotal" REAL NOT NULL DEFAULT 0,
    "bucketUnder3d" REAL NOT NULL DEFAULT 0,
    "bucket3to7d" REAL NOT NULL DEFAULT 0,
    "bucket7to14d" REAL NOT NULL DEFAULT 0,
    "bucket14to30d" REAL NOT NULL DEFAULT 0,
    "bucket30to60d" REAL NOT NULL DEFAULT 0,
    "bucket60to90d" REAL NOT NULL DEFAULT 0,
    "bucket90to180d" REAL NOT NULL DEFAULT 0,
    "bucket180dTo1y" REAL NOT NULL DEFAULT 0,
    "bucket1to2y" REAL NOT NULL DEFAULT 0,
    "bucket2to3y" REAL NOT NULL DEFAULT 0,
    "bucketOver3y" REAL NOT NULL DEFAULT 0,
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "debts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_debts" ("bucket14to30d", "bucket180dTo1y", "bucket1to2y", "bucket2to3y", "bucket30to60d", "bucket3to7d", "bucket60to90d", "bucket7to14d", "bucket90to180d", "bucketOver3y", "bucketUnder3d", "clientId", "id", "isOverdue", "limitAmount", "nearestPaymentDate", "totalDebt") SELECT "bucket14to30d", "bucket180dTo1y", "bucket1to2y", "bucket2to3y", "bucket30to60d", "bucket3to7d", "bucket60to90d", "bucket7to14d", "bucket90to180d", "bucketOver3y", "bucketUnder3d", "clientId", "id", "isOverdue", "limitAmount", "nearestPaymentDate", "totalDebt" FROM "debts";
DROP TABLE "debts";
ALTER TABLE "new_debts" RENAME TO "debts";
CREATE UNIQUE INDEX "debts_clientId_key" ON "debts"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
