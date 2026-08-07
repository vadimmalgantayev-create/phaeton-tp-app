/*
  Warnings:

  - You are about to drop the `sales_facts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "sales_facts_managerId_clientId_brand_month_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "sales_facts";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "sale_skus" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "regionId" INTEGER NOT NULL,
    "managerId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "productGroup" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "volumeL" REAL,
    "revenueKzt" REAL,
    "revenueEur" REAL,
    CONSTRAINT "sale_skus_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sale_skus_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sale_skus_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_managers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "regionId" INTEGER NOT NULL,
    "isServiceAccount" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "managers_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_managers" ("id", "name", "regionId") SELECT "id", "name", "regionId" FROM "managers";
DROP TABLE "managers";
ALTER TABLE "new_managers" RENAME TO "managers";
CREATE UNIQUE INDEX "managers_name_regionId_key" ON "managers"("name", "regionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "sale_skus_clientId_month_idx" ON "sale_skus"("clientId", "month");

-- CreateIndex
CREATE INDEX "sale_skus_managerId_month_idx" ON "sale_skus"("managerId", "month");

-- CreateIndex
CREATE INDEX "sale_skus_clientId_brand_month_idx" ON "sale_skus"("clientId", "brand", "month");

-- CreateIndex
CREATE INDEX "sale_skus_clientId_sku_idx" ON "sale_skus"("clientId", "sku");

-- CreateIndex
CREATE INDEX "sale_skus_regionId_month_idx" ON "sale_skus"("regionId", "month");
