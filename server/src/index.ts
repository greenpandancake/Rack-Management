import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import path from 'node:path';
import { env, botEnabled } from './env.js';
import { wireBusToSocket } from './realtime/bus.js';
import { cargoRouter } from './api/cargo.js';
import { slotsRouter } from './api/slots.js';
import { configRouter } from './api/config.js';
import { photosRouter } from './api/photos.js';
import { authRouter } from './api/auth.js';
import { reportsRouter } from './api/reports.js';
import { startBot } from './bot/index.js';
import { startAgingCron } from './jobs/aging.js';
import { ensureAuthSchema } from './jobs/ensureAuthSchema.js';
import { normalizePhotoPaths } from './jobs/normalizePhotoPaths.js';
import { isLocalRequest } from './middleware/local.js';
import { buildSessionMiddleware } from './auth/session.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(buildSessionMiddleware());

const uploadsPath = path.resolve(env.UPLOADS_DIR);
app.use('/uploads', express.static(uploadsPath));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, botEnabled, isLocal: isLocalRequest(req) });
});

app.use('/api/auth', authRouter);
app.use('/api/cargo', cargoRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/config', configRouter);
app.use('/api/photos', photosRouter);
app.use('/api/reports', reportsRouter);

if (env.CLIENT_DIST && fs.existsSync(env.CLIENT_DIST)) {
  const clientDist = path.resolve(env.CLIENT_DIST);
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/uploads|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[client] serving SPA from ${clientDist}`);
}

const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: '*' },
});
wireBusToSocket(io);

io.on('connection', (socket) => {
  socket.emit('hello', { ts: Date.now() });
});

async function main() {
  await ensureAuthSchema();
  httpServer.listen(env.PORT, env.HOST, () => {
    console.log(`[server] listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[uploads] serving from ${uploadsPath}`);
  });

  if (botEnabled) {
    startBot().catch((err) => console.error('[bot] failed to start', err));
  } else {
    console.warn('[bot] disabled: set BOT_TOKEN and GROUP_CHAT_ID in .env to enable');
  }

  startAgingCron();
  normalizePhotoPaths().catch((err) => console.error('[migrate] photo path normalization failed', err));
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
