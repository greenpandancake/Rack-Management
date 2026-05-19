import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { bus } from '../realtime/bus.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';

export const photosRouter = Router();
photosRouter.use(requireAuth);

const uploadsRoot = path.resolve(env.UPLOADS_DIR);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) return cb(null, true);
    cb(null, false);
  },
});

photosRouter.post('/cargo/:cargoId', upload.single('photo'), async (req, res) => {
  const cargoId = req.params.cargoId;
  if (!UUID_RE.test(cargoId)) return res.status(400).json({ error: 'invalid_cargo_id' });
  if (!req.file) return res.status(400).json({ error: 'no_file_or_unsupported_type' });

  const cargo = await prisma.cargo.findUnique({ where: { id: cargoId } });
  if (!cargo) return res.status(404).json({ error: 'cargo_not_found' });

  const dir = path.resolve(uploadsRoot, cargoId);
  if (!dir.startsWith(uploadsRoot + path.sep)) {
    return res.status(400).json({ error: 'invalid_cargo_id' });
  }

  await fs.promises.mkdir(dir, { recursive: true });
  const ext = MIME_TO_EXT[req.file.mimetype];
  const filename = `${randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(dir, filename), req.file.buffer);

  const rel = path.posix.join(cargoId, filename);
  const photo = await prisma.cargoPhoto.create({
    data: {
      cargoId: cargo.id,
      filePath: rel,
      caption: (req.body?.caption as string | undefined) ?? null,
      uploadedBy: req.session.user!.username,
      kind: (req.body?.kind as 'INTAKE' | 'CONDITION_REPORT' | undefined) ?? 'INTAKE',
    },
  });
  bus.emitEvent({ type: 'cargo:photo', cargoId: cargo.id, photoId: photo.id });
  res.status(201).json(photo);
});
