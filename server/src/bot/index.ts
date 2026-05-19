import { Telegraf } from 'telegraf';
import { env } from '../env.js';
import { registerMoveCommand } from './commands/move.js';
import { registerReportCommand } from './commands/report.js';
import { registerStatusCommands } from './commands/status.js';
import { registerGetIdCommand } from './commands/getid.js';
import { registerGetInfoCommand } from './commands/getinfo.js';

export async function startBot() {
  const bot = new Telegraf(env.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const chatId = String(ctx.chat?.id ?? '');
    if (chatId !== env.GROUP_CHAT_ID) {
      console.warn(`[bot] ignored message from unauthorized chat ${chatId}`);
      return;
    }
    return next();
  });

  bot.start((ctx) => ctx.reply('MPL Smart Rack bot online. Try /help for commands.'));
  bot.help((ctx) =>
    ctx.reply(
      [
        '/getinfo <slotId>                              — show cargo details stored in a rack slot',
        '/getid <containerNo|blNo|cssCcdNo|consignee>   — look up the MCH/WH- ID for a cargo',
        '/move <id|containerNo> <toSlot>                — relocate cargo to a rack slot',
        '/move <fromSlot> <toSlot>                     — move whatever is in a slot to another slot',
        '/checking <id|containerNo>                     — move to Checking Area (frees slot)',
        '/cleared <id|containerNo>                      — mark cleared (frees slot)',
        '/auction <id|containerNo>                      — flag as checked for auction',
        '/disposal <id|containerNo>                     — mark for disposal',
        '/damaged <id|containerNo>                      — mark as damaged',
        '/report <id|containerNo|slotId> <note>         — log a condition note; attach a photo within 5 min',
      ].join('\n'),
    ),
  );

  registerMoveCommand(bot);
  registerReportCommand(bot);
  registerStatusCommands(bot);
  registerGetIdCommand(bot);
  registerGetInfoCommand(bot);

  await bot.launch();
  console.log('[bot] launched (polling)');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
