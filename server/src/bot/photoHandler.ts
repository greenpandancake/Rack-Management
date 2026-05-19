import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Telegram } from 'telegraf';
import { prisma } from '../db.js';
import { env } from '../env.js';

const uploadsRoot = path.resolve(env.UPLOADS_DIR);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);

export async function downloadTelegramPhoto(
  telegram: Telegram,
  fileId: string,
  cargoId: string,
  uploadedBy: string,
  kind: 'INTAKE' | 'CONDITION_REPORT',
  caption: string | null,
) {
  if (!UUID_RE.test(cargoId)) throw new Error('invalid_cargo_id');

  const link = await telegram.getFileLink(fileId);
  const res = await fetch(link.toString());
  if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const dir = path.resolve(uploadsRoot, cargoId);
  if (!dir.startsWith(uploadsRoot + path.sep)) throw new Error('invalid_cargo_id');
  fs.mkdirSync(dir, { recursive: true });

  const rawExt = path.extname(link.pathname).toLowerCase();
  const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : '.jpg';
  const filename = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  const rel = path.posix.join(cargoId, filename);
  return prisma.cargoPhoto.create({
    data: { cargoId, filePath: rel, uploadedBy, kind, caption },
  });
}
