import cron from 'node-cron';
import { subDays } from 'date-fns';
import { prisma } from '../db.js';
import { bus } from '../realtime/bus.js';

const OVERDUE_DAYS = 30;

export async function runAgingOnce() {
  const cutoff = subDays(new Date(), OVERDUE_DAYS);

  const RACK_STATUSES = ['IN_RACK', 'CHECKED_FOR_AUCTION'];

  const overdueRes = await prisma.cargo.updateMany({
    where: { status: { in: RACK_STATUSES }, isOverdue: false, shiftedDate: { lte: cutoff } },
    data: { isOverdue: true },
  });

  const recoveredRes = await prisma.cargo.updateMany({
    where: {
      isOverdue: true,
      OR: [{ status: { notIn: RACK_STATUSES } }, { shiftedDate: { gt: cutoff } }],
    },
    data: { isOverdue: false },
  });

  if (overdueRes.count > 0 || recoveredRes.count > 0) {
    bus.emitEvent({ type: 'config:updated' });
    console.log(`[aging] flagged ${overdueRes.count} overdue, cleared ${recoveredRes.count}`);
  }
  return { flagged: overdueRes.count, cleared: recoveredRes.count };
}

export function startAgingCron() {
  cron.schedule('5 * * * *', () => {
    runAgingOnce().catch((err) => console.error('[aging] error', err));
  });
  runAgingOnce().catch((err) => console.error('[aging] error', err));
  console.log('[aging] cron scheduled hourly');
}

if (process.argv.includes('--once')) {
  runAgingOnce()
    .then((r) => {
      console.log('aging result', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
