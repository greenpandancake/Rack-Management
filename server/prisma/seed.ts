import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureSlotsForConfig, defaultConfig } from '../src/services/rack.js';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.rackConfig.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.rackConfig.create({
      data: {
        id: 1,
        rows: JSON.stringify(defaultConfig.rows),
        levels: defaultConfig.levels,
        slotsPerLevel: defaultConfig.slotsPerLevel,
      },
    });
    console.log('[seed] created default RackConfig');
  } else {
    console.log('[seed] RackConfig already exists');
  }

  const cfg = await prisma.rackConfig.findUniqueOrThrow({ where: { id: 1 } });
  const created = await ensureSlotsForConfig(prisma, cfg);
  console.log(`[seed] ensured ${created} slots`);

  const superAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (superAdmins === 0) {
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (existingAdmin) {
      await prisma.user.update({ where: { id: existingAdmin.id }, data: { role: 'SUPER_ADMIN', isActive: true } });
      console.log(`[seed] promoted ${existingAdmin.username} to super admin`);
      return;
    }
    await prisma.user.create({
      data: {
        username: 'admin',
        name: 'Administrator',
        passwordHash: await bcrypt.hash('admin123', 10),
        role: 'SUPER_ADMIN',
        mustChangePassword: true,
      },
    });
    console.log('[seed] created default super admin user: admin / admin123');
  } else {
    console.log('[seed] super admin user already exists');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
