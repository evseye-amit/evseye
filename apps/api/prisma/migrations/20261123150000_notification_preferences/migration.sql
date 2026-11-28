CREATE TABLE "NotificationConsent" (
 "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL, "application" VARCHAR(30) NOT NULL,
 "marketingEnabled" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("clientId","userId","application"),
 FOREIGN KEY ("clientId","userId") REFERENCES "User"("clientId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 CHECK ("application" IN ('RIDER','FLEET_MANAGER','TEAM_LEADER','ADMIN'))
);
CREATE TABLE "NotificationPreference" (
 "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL, "application" VARCHAR(30) NOT NULL,
 "categoryCode" VARCHAR(100) NOT NULL, "pushEnabled" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("clientId","userId","application","categoryCode"),
 FOREIGN KEY ("clientId","userId") REFERENCES "User"("clientId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("categoryCode") REFERENCES "NotificationCategory"(code) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("application" IN ('RIDER','FLEET_MANAGER','TEAM_LEADER','ADMIN'))
);
