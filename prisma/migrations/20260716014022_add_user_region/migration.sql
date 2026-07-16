-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "managerId" INTEGER,
    "regionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "users_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("createdAt", "id", "isActive", "managerId", "passwordHash", "role", "username") SELECT "createdAt", "id", "isActive", "managerId", "passwordHash", "role", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_managerId_key" ON "users"("managerId");
CREATE UNIQUE INDEX "users_regionId_key" ON "users"("regionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
