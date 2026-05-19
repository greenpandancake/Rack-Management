import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';

export async function normalizePhotoPaths() {
  const uploadsRoot = path.resolve(env.UPLOADS_DIR).replace(/\\/g, '/');
  const photos = await prisma.cargoPhoto.findMany({ select: { id: true, filePath: true } });
  let fixed = 0;
  for (const p of photos) {
    const normalized = p.filePath.replace(/\\/g, '/');
    let stripped = normalized;
    if (stripped.toLowerCase().startsWith(uploadsRoot.toLowerCase())) {
      stripped = stripped.slice(uploadsRoot.length);
    } else if (stripped.startsWith('uploads/')) {
      stripped = stripped.slice('uploads/'.length);
    }
    stripped = stripped.replace(/^\/+/, '');
    if (stripped !== p.filePath) {
      await prisma.cargoPhoto.update({ where: { id: p.id }, data: { filePath: stripped } });
      fixed++;
    }
  }
  if (fixed > 0) console.log(`[migrate] normalized ${fixed} photo path(s)`);
}
