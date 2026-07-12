-- CreateTable
CREATE TABLE "regions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "managers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "regionId" INTEGER NOT NULL,
    CONSTRAINT "managers_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clients" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "managerId" INTEGER,
    "route" TEXT,
    CONSTRAINT "clients_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "client_addresses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "deliveryType" TEXT,
    "phone" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    CONSTRAINT "client_addresses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "article" TEXT NOT NULL,
    "article1c" TEXT,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tnved" TEXT,
    "packQty" INTEGER,
    "priceGross" REAL,
    "generalDiscountPct" REAL,
    "priceNet" REAL,
    "application" TEXT,
    "isServiceRow" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "warehouse" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    CONSTRAINT "stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "regionId" INTEGER,
    "clientId" INTEGER,
    "brand" TEXT NOT NULL,
    "percent" REAL NOT NULL,
    "validUntil" DATETIME,
    CONSTRAINT "discounts_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "discounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "totalDebt" REAL NOT NULL,
    "limitAmount" REAL,
    "nearestPaymentDate" DATETIME,
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

-- CreateTable
CREATE TABLE "sales_facts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "managerId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "brand" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "volumeL" REAL NOT NULL DEFAULT 0,
    "revenueEur" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "sales_facts_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sales_facts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plans" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "managerId" INTEGER NOT NULL,
    "taskType" TEXT NOT NULL,
    "productGroup" TEXT,
    "planValue" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "weightPct" REAL NOT NULL,
    CONSTRAINT "plans_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "acb_plans" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "managerId" INTEGER NOT NULL,
    "acbTotal" INTEGER NOT NULL,
    "acbOil" INTEGER NOT NULL,
    "weightPct" REAL NOT NULL,
    CONSTRAINT "acb_plans_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "missing_invoices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "managerId" INTEGER,
    "orderRef" TEXT NOT NULL,
    "deliveryVariant" TEXT,
    CONSTRAINT "missing_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "missing_invoices_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_loads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceFile" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "loadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsTotal" INTEGER NOT NULL,
    "rowsOk" INTEGER NOT NULL,
    "rowsError" INTEGER NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "validation_errors" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dataLoadId" INTEGER NOT NULL,
    "sheet" TEXT,
    "rowNumber" INTEGER,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "rawValue" TEXT,
    CONSTRAINT "validation_errors_dataLoadId_fkey" FOREIGN KEY ("dataLoadId") REFERENCES "data_loads" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_name_key" ON "regions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "managers_name_regionId_key" ON "managers"("name", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_name_managerId_key" ON "clients"("name", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "products_article_brand_key" ON "products"("article", "brand");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_productId_warehouse_key" ON "stocks"("productId", "warehouse");

-- CreateIndex
CREATE UNIQUE INDEX "debts_clientId_key" ON "debts"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_facts_managerId_clientId_brand_month_key" ON "sales_facts"("managerId", "clientId", "brand", "month");

-- CreateIndex
CREATE UNIQUE INDEX "acb_plans_managerId_key" ON "acb_plans"("managerId");
