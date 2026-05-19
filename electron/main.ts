import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const SERVER_PORT = 4000;
const DEFAULT_BACKUP_TIME = '02:00';

type UserDataLayout = {
  userData: string;
  dataDir: string;
  uploadsDir: string;
  dbPath: string;
  envPath: string;
};

type BackupState = {
  lastAutoBackupDate?: string;
  lastAutoBackupTarget?: string;
  lastAutoBackupPath?: string;
  lastAutoBackupAt?: string;
};

let backupTimer: NodeJS.Timeout | null = null;
let backupInProgress = false;

function resolveResource(relativePath: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  return path.join(__dirname, '..', '..', relativePath);
}

function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function ensureUserDataLayout(): UserDataLayout {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  const dbPath = path.join(dataDir, 'mpl_rack.db');
  const envPath = path.join(userData, '.env');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(
      envPath,
      [
        '# MPL Smart Rack — local configuration',
        '# Edit BOT_TOKEN and GROUP_CHAT_ID to enable the Telegram bot, then restart the app.',
        'BOT_TOKEN=',
        'GROUP_CHAT_ID=',
        'BACKUP_DIR=',
        `BACKUP_TIME=${DEFAULT_BACKUP_TIME}`,
        '',
      ].join('\n'),
    );
  }

  return { userData, dataDir, uploadsDir, dbPath, envPath };
}

function loadUserEnv(envPath: string) {
  for (const [key, val] of parseEnvFile(envPath)) process.env[key] = val;
}

function parseEnvFile(envPath: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!fs.existsSync(envPath)) return values;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    values.set(m[1], val);
  }
  return values;
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]*$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function setEnvValue(envPath: string, key: string, value: string) {
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').split(/\r?\n/) : [];
  const next = `${key}=${quoteEnvValue(value)}`;
  let replaced = false;

  const updated = lines.map((line) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true;
      return next;
    }
    return line;
  });

  if (!replaced) {
    if (updated.length && updated[updated.length - 1] !== '') updated.push('');
    updated.push(next);
  }

  fs.writeFileSync(envPath, updated.join('\n'));
  process.env[key] = value;
}

function initDatabase(dbPath: string) {
  const fresh = !fs.existsSync(dbPath);
  const initSqlPath = resolveResource(path.join('server', 'prisma', 'init.sql'));

  if (!fs.existsSync(initSqlPath)) {
    throw new Error(`init.sql not found at ${initSqlPath}. Run "npm run build:schema-sql".`);
  }

  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    if (fresh) {
      console.log('[db] fresh database — applying init.sql');
      const sql = fs.readFileSync(initSqlPath, 'utf-8');
      db.exec(sql);
    } else {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Cargo'").get();
      if (!tables) {
        console.log('[db] existing DB missing tables — applying init.sql');
        const sql = fs.readFileSync(initSqlPath, 'utf-8');
        db.exec(sql);
      }
    }
  } finally {
    db.close();
  }
}

function localDateStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localDateTimeStamp(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${localDateStamp(date)}_${hh}-${mm}-${ss}`;
}

function readBackupState(userData: string): BackupState {
  const statePath = path.join(userData, 'backup-state.json');
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as BackupState;
  } catch {
    return {};
  }
}

function writeBackupState(userData: string, state: BackupState) {
  fs.writeFileSync(path.join(userData, 'backup-state.json'), JSON.stringify(state, null, 2));
}

function isBackupConfigured(): boolean {
  return Boolean((process.env.BACKUP_DIR ?? '').trim());
}

function getBackupTime(): string {
  const raw = (process.env.BACKUP_TIME ?? DEFAULT_BACKUP_TIME).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : DEFAULT_BACKUP_TIME;
}

function ensureUniqueDir(baseDir: string): string {
  if (!fs.existsSync(baseDir)) return baseDir;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseDir}-${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find a unique backup folder name under ${path.dirname(baseDir)}`);
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function createFullBackup(layout: UserDataLayout, mode: 'auto' | 'manual' = 'auto'): Promise<string> {
  const backupRoot = (process.env.BACKUP_DIR ?? '').trim();
  if (!backupRoot) throw new Error('BACKUP_DIR is not configured.');
  if (isPathInside(backupRoot, layout.dataDir)) {
    throw new Error('Choose a backup folder outside the app data folder.');
  }
  if (backupInProgress) throw new Error('A backup is already in progress.');

  backupInProgress = true;
  const startedAt = new Date();
  const finalDir = ensureUniqueDir(path.join(backupRoot, `MPL-Smart-Rack-${mode}-${localDateTimeStamp(startedAt)}`));
  const tempDir = `${finalDir}.tmp`;

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    const db = new Database(layout.dbPath, { readonly: true });
    try {
      await db.backup(path.join(tempDir, 'mpl_rack.db'));
    } finally {
      db.close();
    }

    if (fs.existsSync(layout.uploadsDir)) {
      fs.cpSync(layout.uploadsDir, path.join(tempDir, 'uploads'), { recursive: true });
    } else {
      fs.mkdirSync(path.join(tempDir, 'uploads'), { recursive: true });
    }

    if (fs.existsSync(layout.envPath)) {
      fs.copyFileSync(layout.envPath, path.join(tempDir, 'app.env'));
    }

    fs.writeFileSync(
      path.join(tempDir, 'manifest.json'),
      JSON.stringify(
        {
          app: 'MPL Smart Rack',
          version: app.getVersion(),
          mode,
          createdAt: startedAt.toISOString(),
          sourceDataDir: layout.dataDir,
          contains: ['mpl_rack.db', 'uploads', 'app.env'],
        },
        null,
        2,
      ),
    );

    fs.renameSync(tempDir, finalDir);

    if (mode === 'auto') {
      writeBackupState(layout.userData, {
        lastAutoBackupDate: localDateStamp(startedAt),
        lastAutoBackupTarget: backupRoot,
        lastAutoBackupPath: finalDir,
        lastAutoBackupAt: startedAt.toISOString(),
      });
    }

    console.log(`[backup] ${mode} backup complete: ${finalDir}`);
    return finalDir;
  } catch (err) {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup only.
    }
    console.error(`[backup] ${mode} backup failed`, err);
    throw err;
  } finally {
    backupInProgress = false;
  }
}

function msUntilNextBackupTime(): number {
  const [hour, minute] = getBackupTime().split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleDailyBackups(layout: UserDataLayout) {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }

  if (!isBackupConfigured()) {
    console.log('[backup] disabled: set BACKUP_DIR in .env or choose a backup folder from the File menu');
    return;
  }

  const runAutoBackup = async () => {
    const backupRoot = (process.env.BACKUP_DIR ?? '').trim();
    const today = localDateStamp();
    const state = readBackupState(layout.userData);
    if (state.lastAutoBackupDate !== today || state.lastAutoBackupTarget !== backupRoot) {
      try {
        await createFullBackup(layout, 'auto');
      } catch {
        // Logged in createFullBackup; the next scheduled run will try again.
      }
    }
    backupTimer = setTimeout(runAutoBackup, msUntilNextBackupTime());
  };

  backupTimer = setTimeout(runAutoBackup, 60_000);
  console.log(`[backup] daily backups enabled at ${getBackupTime()} to ${(process.env.BACKUP_DIR ?? '').trim()}`);
}

function showAppMessage(options: Electron.MessageBoxOptions) {
  if (mainWindow) return dialog.showMessageBox(mainWindow, options);
  return dialog.showMessageBox(options);
}

function showFolderPicker(options: Electron.OpenDialogOptions) {
  if (mainWindow) return dialog.showOpenDialog(mainWindow, options);
  return dialog.showOpenDialog(options);
}

let mainWindow: BrowserWindow | null = null;

async function startServer(opts: { dbPath: string; uploadsDir: string }) {
  process.env.DATABASE_URL = `file:${opts.dbPath.replace(/\\/g, '/')}`;
  process.env.UPLOADS_DIR = opts.uploadsDir;
  process.env.HOST = '0.0.0.0';
  process.env.PORT = String(SERVER_PORT);
  process.env.CLIENT_DIST = resolveResource(path.join('client', 'dist'));

  const serverEntry = resolveResource(path.join('server', 'dist', 'index.js'));
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`server entry not found at ${serverEntry}. Run "npm run build:server".`);
  }

  const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
  await dynamicImport(pathToFileURL(serverEntry).href);
}

async function waitForServer(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy in time');
}

function createMainWindow(layout: UserDataLayout) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MPL Smart Rack',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}/`);

  const sameOriginPrefix = `http://127.0.0.1:${SERVER_PORT}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(sameOriginPrefix)) {
      shell.openExternal(url);
    } else if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(sameOriginPrefix)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menu = Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        {
          label: 'Open data folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: 'Choose backup folder...',
          click: async () => {
            const result = await showFolderPicker({
              title: 'Choose daily backup folder',
              properties: ['openDirectory', 'createDirectory'],
            });
            if (result.canceled || result.filePaths.length === 0) return;

            const backupDir = result.filePaths[0];
            setEnvValue(layout.envPath, 'BACKUP_DIR', backupDir);
            if (!process.env.BACKUP_TIME) setEnvValue(layout.envPath, 'BACKUP_TIME', DEFAULT_BACKUP_TIME);
            scheduleDailyBackups(layout);

            try {
              const backupPath = await createFullBackup(layout, 'manual');
              showAppMessage({
                type: 'info',
                title: 'Backup folder saved',
                message: 'Daily backups are enabled.',
                detail: `Backup folder:\n${backupDir}\n\nA full backup was created now:\n${backupPath}`,
              });
            } catch (err) {
              dialog.showErrorBox('Backup folder saved, but backup failed', String(err));
            }
          },
        },
        {
          label: 'Run backup now',
          click: async () => {
            if (!isBackupConfigured()) {
              showAppMessage({
                type: 'warning',
                title: 'No backup folder selected',
                message: 'Choose a backup folder first.',
                detail: 'Use File > Choose backup folder, preferably selecting a network share.',
              });
              return;
            }

            try {
              const backupPath = await createFullBackup(layout, 'manual');
              showAppMessage({
                type: 'info',
                title: 'Backup complete',
                message: 'Full backup created.',
                detail: backupPath,
              });
            } catch (err) {
              dialog.showErrorBox('Backup failed', String(err));
            }
          },
        },
        {
          label: 'Open backup folder',
          click: () => {
            const backupDir = (process.env.BACKUP_DIR ?? '').trim();
            if (backupDir) {
              shell.openPath(backupDir);
            } else {
              showAppMessage({
                type: 'warning',
                title: 'No backup folder selected',
                message: 'Choose a backup folder first.',
              });
            }
          },
        },
        {
          label: 'Edit .env (Telegram bot config)',
          click: () => shell.openPath(layout.envPath),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'LAN connection info',
          click: () => {
            const ip = getLanIp();
            dialog.showMessageBox({
              type: 'info',
              title: 'LAN access',
              message: 'Other office screens can open the dashboard at:',
              detail: `http://${ip}:${SERVER_PORT}/\n\nAllow port ${SERVER_PORT} through Windows Firewall.`,
            });
          },
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'MPL Smart Rack',
              message: `MPL Smart Rack ${app.getVersion()}`,
              detail: 'Local-only warehouse management system.',
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const layout = ensureUserDataLayout();
      loadUserEnv(layout.envPath);
      initDatabase(layout.dbPath);
      await startServer({ dbPath: layout.dbPath, uploadsDir: layout.uploadsDir });
      await waitForServer();
      createMainWindow(layout);
      scheduleDailyBackups(layout);
    } catch (err) {
      console.error('[startup] failed', err);
      dialog.showErrorBox('MPL Smart Rack failed to start', String(err));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
