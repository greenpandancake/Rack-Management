-- CreateTable
CREATE TABLE "RackConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "rows" TEXT NOT NULL,
    "levels" INTEGER NOT NULL,
    "slotsPerLevel" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RackSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "row" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Cargo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cssCcdNo" TEXT NOT NULL,
    "vesselName" TEXT NOT NULL,
    "dateOfArrival" DATETIME NOT NULL,
    "containerNo" TEXT NOT NULL,
    "blNo" TEXT NOT NULL,
    "consigneeName" TEXT NOT NULL,
    "mark" TEXT NOT NULL DEFAULT '',
    "commodity" TEXT NOT NULL DEFAULT 'GENERAL CARGO',
    "cargoDescription" TEXT NOT NULL DEFAULT '',
    "pkgsType" TEXT NOT NULL,
    "noOfPkgs" INTEGER NOT NULL,
    "cbm" REAL NOT NULL DEFAULT 0,
    "fclLcl" TEXT NOT NULL DEFAULT 'LCL',
    "containerSize" TEXT NOT NULL DEFAULT 'NA',
    "detainedByCustoms" BOOLEAN NOT NULL DEFAULT false,
    "detainedByHealth" BOOLEAN NOT NULL DEFAULT false,
    "detainedCargoRefNo" TEXT,
    "reasonOfShifting" TEXT NOT NULL,
    "clearanceOfficer" TEXT NOT NULL,
    "clearanceEmployId" TEXT NOT NULL,
    "shiftedDate" DATETIME NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "currentSlotId" TEXT,
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'IN_RACK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Cargo_currentSlotId_fkey" FOREIGN KEY ("currentSlotId") REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CargoPortion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cargoId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pkgsType" TEXT NOT NULL,
    "currentSlotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_RACK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CargoPortion_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CargoPortion_currentSlotId_fkey" FOREIGN KEY ("currentSlotId") REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MoveLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cargoId" TEXT NOT NULL,
    "portionId" TEXT,
    "fromSlotId" TEXT,
    "toSlotId" TEXT,
    "movedBy" TEXT NOT NULL,
    "userId" TEXT,
    "movedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    CONSTRAINT "MoveLog_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MoveLog_portionId_fkey" FOREIGN KEY ("portionId") REFERENCES "CargoPortion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MoveLog_fromSlotId_fkey" FOREIGN KEY ("fromSlotId") REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MoveLog_toSlotId_fkey" FOREIGN KEY ("toSlotId") REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MoveLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLERK',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "telegramUsername" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "permissions" TEXT
);

-- CreateTable
CREATE TABLE "CargoPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cargoId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'INTAKE',
    CONSTRAINT "CargoPhoto_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cargoId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photoId" TEXT,
    CONSTRAINT "Report_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Report_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "CargoPhoto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RackSlot_row_level_slot_idx" ON "RackSlot"("row", "level", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Cargo_cssCcdNo_key" ON "Cargo"("cssCcdNo");

-- CreateIndex
CREATE INDEX "Cargo_containerNo_idx" ON "Cargo"("containerNo");

-- CreateIndex
CREATE INDEX "Cargo_blNo_idx" ON "Cargo"("blNo");

-- CreateIndex
CREATE INDEX "Cargo_consigneeName_idx" ON "Cargo"("consigneeName");

-- CreateIndex
CREATE INDEX "Cargo_currentSlotId_idx" ON "Cargo"("currentSlotId");

-- CreateIndex
CREATE INDEX "CargoPortion_cargoId_idx" ON "CargoPortion"("cargoId");

-- CreateIndex
CREATE INDEX "CargoPortion_currentSlotId_idx" ON "CargoPortion"("currentSlotId");

-- CreateIndex
CREATE INDEX "MoveLog_cargoId_idx" ON "MoveLog"("cargoId");

-- CreateIndex
CREATE INDEX "MoveLog_portionId_idx" ON "MoveLog"("portionId");

-- CreateIndex
CREATE INDEX "MoveLog_userId_idx" ON "MoveLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUsername_key" ON "User"("telegramUsername");

-- CreateIndex
CREATE INDEX "User_telegramUsername_idx" ON "User"("telegramUsername");

-- CreateIndex
CREATE INDEX "CargoPhoto_cargoId_idx" ON "CargoPhoto"("cargoId");

-- CreateIndex
CREATE INDEX "Report_cargoId_idx" ON "Report"("cargoId");

