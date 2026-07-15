-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_route_visits" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "managerId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "day" DATETIME NOT NULL,
    "visitedAt" DATETIME,
    "latitude" REAL,
    "longitude" REAL,
    "hasGeo" BOOLEAN NOT NULL DEFAULT false,
    "distanceM" REAL,
    "clientLat" REAL,
    "clientLng" REAL,
    CONSTRAINT "route_visits_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "route_visits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_route_visits" ("clientId", "day", "id", "latitude", "longitude", "managerId", "visitedAt") SELECT "clientId", "day", "id", "latitude", "longitude", "managerId", "visitedAt" FROM "route_visits";
DROP TABLE "route_visits";
ALTER TABLE "new_route_visits" RENAME TO "route_visits";
CREATE UNIQUE INDEX "route_visits_managerId_clientId_day_key" ON "route_visits"("managerId", "clientId", "day");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
