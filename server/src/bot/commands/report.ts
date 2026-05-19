import type { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { prisma } from '../../db.js';
import { bus } from '../../realtime/bus.js';
import { resolveCargo } from '../resolveCargo.js';
import { downloadTelegramPhoto } from '../photoHandler.js';
import { resolveTelegramUser } from '../user.js';

type Pending = { cargoId: string; expiresAt: number };
const pendingPhotoForUser = new Map<number, Pending>();
const PENDING_TTL_MS = 5 * 60 * 1000;

function setPending(userId: number, cargoId: string) {
  pendingPhotoForUser.set(userId, { cargoId, expiresAt: Date.now() + PENDING_TTL_MS });
}

function takePending(userId: number): string | null {
  const p = pendingPhotoForUser.get(userId);
  if (!p) return null;
  if (p.expiresAt < Date.now()) {
    pendingPhotoForUser.delete(userId);
    return null;
  }
  pendingPhotoForUser.delete(userId);
  return p.cargoId;
}

async function createReport(args: {
  cargoId: string;
  note: string;
  reportedBy: string;
  photoId?: string;
}) {
  const report = await prisma.report.create({
    data: {
      cargoId: args.cargoId,
      note: args.note || '(no note)',
      reportedBy: args.reportedBy,
      photoId: args.photoId ?? null,
    },
  });
  bus.emitEvent({ type: 'cargo:report', cargoId: args.cargoId, reportId: report.id });
  return report;
}

export function registerReportCommand(bot: Telegraf) {
  bot.command('report', async (ctx) => {
    const text = ctx.message.text ?? '';
    const rest = text.replace(/^\/report(@\S+)?\s*/, '');
    const [identifier, ...noteParts] = rest.split(/\s+/);
    if (!identifier) {
      return ctx.reply('Usage: /report <containerNo|cargoId> <note>. Then send a photo within 5 minutes.');
    }
    const actor = await resolveTelegramUser(ctx);
    if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');

    const cargo = await resolveCargo(identifier);
    if (!cargo) return ctx.reply(`Cargo not found: ${identifier}`);

    const note = noteParts.join(' ').trim();

    await createReport({ cargoId: cargo.id, note, reportedBy: actor.displayName });

    if (ctx.from?.id) setPending(ctx.from.id, cargo.id);
    return ctx.reply(`Report logged for ${cargo.containerNo}. Send a photo within 5 minutes to attach it.`);
  });

  bot.on(message('photo'), async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;
    const fileId = photos[photos.length - 1].file_id;
    const caption = ctx.message.caption ?? '';
    const userId = ctx.from?.id ?? 0;

    let cargoId: string | null = null;
    let note = '';

    const reportCaption = caption.match(/^\/report(?:@\S+)?\s+(\S+)(?:\s+([\s\S]*))?$/);
    if (reportCaption) {
      const actor = await resolveTelegramUser(ctx);
      if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');
      const cargo = await resolveCargo(reportCaption[1]);
      if (!cargo) return ctx.reply(`Cargo not found: ${reportCaption[1]}`);
      cargoId = cargo.id;
      note = (reportCaption[2] ?? '').trim();
      const saved = await downloadTelegramPhoto(ctx.telegram, fileId, cargoId, actor.displayName, 'CONDITION_REPORT', caption || null);
      await createReport({ cargoId, note, reportedBy: actor.displayName, photoId: saved.id });
      bus.emitEvent({ type: 'cargo:photo', cargoId, photoId: saved.id });
      await ctx.reply(`Photo attached to cargo.`);
      return;
    }

    cargoId = takePending(userId);
    if (!cargoId) return;
    const actor = await resolveTelegramUser(ctx);
    if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');
    note = caption.trim();

    const saved = await downloadTelegramPhoto(ctx.telegram, fileId, cargoId, actor.displayName, 'CONDITION_REPORT', caption || null);
    await createReport({ cargoId, note, reportedBy: actor.displayName, photoId: saved.id });
    bus.emitEvent({ type: 'cargo:photo', cargoId, photoId: saved.id });

    await ctx.reply(`Photo attached to cargo.`);
  });
}
