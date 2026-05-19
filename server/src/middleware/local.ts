import type { Request, Response, NextFunction } from 'express';

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLocalRequest(req: Request): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return LOCAL_ADDRESSES.has(addr);
}

export function requireLocal(req: Request, res: Response, next: NextFunction) {
  if (isLocalRequest(req)) return next();
  return res.status(403).json({ error: 'admin_local_only' });
}
