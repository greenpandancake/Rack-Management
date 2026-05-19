import type { Context } from 'telegraf';
import { prisma } from '../db.js';

export type BotUser = {
  userId: string;
  displayName: string;
};

export async function resolveTelegramUser(ctx: Context): Promise<BotUser | null> {
  const username = ctx.from?.username?.trim().replace(/^@/, '');
  if (!username) return null;

  const user = await prisma.user.findUnique({
    where: { telegramUsername: username },
    select: { id: true, username: true, name: true, isActive: true },
  });
  if (!user?.isActive) return null;

  return { userId: user.id, displayName: user.username || user.name };
}

