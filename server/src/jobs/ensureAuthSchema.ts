import { prisma } from '../db.js';
import bcrypt from 'bcryptjs';

type ColRow = { name: string };
type TblRow = { name: string };

export async function ensureAuthSchema() {
  const tables = (await prisma.$queryRawUnsafe<TblRow[]>(
    "SELECT name FROM sqlite_master WHERE type='table'",
  )).map((t) => t.name);

  if (!tables.includes('User')) {
    console.log('[migrate] creating User table');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'CLERK',
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "telegramUsername" TEXT,
        "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "lastLoginAt" DATETIME
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "User_telegramUsername_key" ON "User"("telegramUsername")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "User_telegramUsername_idx" ON "User"("telegramUsername")`);
  } else {
    const userCols = (await prisma.$queryRawUnsafe<ColRow[]>(
      `PRAGMA table_info("User")`,
    )).map((c) => c.name);
    const addColumn = async (name: string, sql: string) => {
      if (!userCols.includes(name)) await prisma.$executeRawUnsafe(sql);
    };

    await addColumn('username', `ALTER TABLE "User" ADD COLUMN "username" TEXT NOT NULL DEFAULT ''`);
    await addColumn('name', `ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT ''`);
    await addColumn('passwordHash', `ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT ''`);
    await addColumn('role', `ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'CLERK'`);
    await addColumn('isActive', `ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1`);
    await addColumn('telegramUsername', `ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT`);
    await addColumn('mustChangePassword', `ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0`);
    await addColumn('createdAt', `ALTER TABLE "User" ADD COLUMN "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await addColumn('updatedAt', `ALTER TABLE "User" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await addColumn('lastLoginAt', `ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramUsername_key" ON "User"("telegramUsername")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_telegramUsername_idx" ON "User"("telegramUsername")`);
  }

  const moveLogCols = (await prisma.$queryRawUnsafe<ColRow[]>(
    `PRAGMA table_info("MoveLog")`,
  )).map((c) => c.name);

  if (!moveLogCols.includes('userId')) {
    console.log('[migrate] adding MoveLog.userId column');
    await prisma.$executeRawUnsafe(`ALTER TABLE "MoveLog" ADD COLUMN "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL`);
  }
  if (!moveLogCols.includes('portionId')) {
    console.log('[migrate] adding MoveLog.portionId column');
    await prisma.$executeRawUnsafe(`ALTER TABLE "MoveLog" ADD COLUMN "portionId" TEXT REFERENCES "CargoPortion"("id") ON DELETE CASCADE`);
  }
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MoveLog_userId_idx" ON "MoveLog"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MoveLog_portionId_idx" ON "MoveLog"("portionId")`);

  const cargoCols = (await prisma.$queryRawUnsafe<ColRow[]>(
    `PRAGMA table_info("Cargo")`,
  )).map((c) => c.name);
  const addCargoColumn = async (name: string, sql: string) => {
    if (!cargoCols.includes(name)) await prisma.$executeRawUnsafe(sql);
  };
  await addCargoColumn('mark', `ALTER TABLE "Cargo" ADD COLUMN "mark" TEXT NOT NULL DEFAULT ''`);
  await addCargoColumn('commodity', `ALTER TABLE "Cargo" ADD COLUMN "commodity" TEXT NOT NULL DEFAULT 'GENERAL CARGO'`);
  await addCargoColumn('cargoDescription', `ALTER TABLE "Cargo" ADD COLUMN "cargoDescription" TEXT NOT NULL DEFAULT ''`);

  if (!tables.includes('CargoPortion')) {
    console.log('[migrate] creating CargoPortion table');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CargoPortion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "cargoId" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "pkgsType" TEXT NOT NULL,
        "currentSlotId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'IN_RACK',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CargoPortion_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CargoPortion_currentSlotId_fkey" FOREIGN KEY ("currentSlotId") REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
  }
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CargoPortion_cargoId_idx" ON "CargoPortion"("cargoId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CargoPortion_currentSlotId_idx" ON "CargoPortion"("currentSlotId")`);

  await ensureDefaultAdmin();
}

async function ensureDefaultAdmin() {
  const superAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (superAdmins > 0) return;

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (existingAdmin) {
    await prisma.user.update({ where: { id: existingAdmin.id }, data: { role: 'SUPER_ADMIN', isActive: true } });
    console.log(`[seed] promoted ${existingAdmin.username} to super admin`);
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      username: 'admin',
      name: 'Administrator',
      passwordHash,
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
    },
  });
  console.log('[seed] created default super admin user: admin / admin123');
}
