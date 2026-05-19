import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../env.js';
import type { UserPermissions } from './permissions.js';

const SQLiteStore = SQLiteStoreFactory(session);

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      username: string;
      name: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
      permissions: UserPermissions;
    };
  }
}

function resolveSessionDir(): string {
  if (env.SESSION_DIR) return env.SESSION_DIR;
  return path.dirname(path.resolve(env.UPLOADS_DIR));
}

function resolveSecret(): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const dir = resolveSessionDir();
  fs.mkdirSync(dir, { recursive: true });
  const secretFile = path.join(dir, '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

export function buildSessionMiddleware() {
  const dir = resolveSessionDir();
  fs.mkdirSync(dir, { recursive: true });
  const store = new SQLiteStore({ dir, db: 'sessions.sqlite' }) as session.Store;
  return session({
    name: 'mpl.sid',
    secret: resolveSecret(),
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 12,
    },
  });
}
