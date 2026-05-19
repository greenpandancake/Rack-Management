import type { Telegraf } from 'telegraf';
import { prisma } from '../../db.js';

export function registerGetInfoCommand(bot: Telegraf) {
  bot.command('getinfo', async (ctx) => {
    const text = ctx.message.text ?? '';
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 1) {
      return ctx.reply('Usage: /getinfo <slotId>  e.g. /getinfo A-1-06');
    }
    const slotId = parts[0].toUpperCase();

    const slot = await prisma.rackSlot.findUnique({ where: { id: slotId } });
    if (!slot) return ctx.reply(`Slot not found: ${slotId}`);

    const cargos = await prisma.cargo.findMany({
      where: { currentSlotId: slotId },
      select: {
        cssCcdNo: true,
        containerNo: true,
        blNo: true,
        consigneeName: true,
        vesselName: true,
        dateOfArrival: true,
        commodity: true,
        cargoDescription: true,
        noOfPkgs: true,
        pkgsType: true,
        cbm: true,
        fclLcl: true,
        containerSize: true,
        status: true,
        isOverdue: true,
        detainedByCustoms: true,
        detainedByHealth: true,
        detainedCargoRefNo: true,
        remarks: true,
        portions: {
          select: { label: true, quantity: true, pkgsType: true, currentSlotId: true, status: true },
        },
      },
    });

    const portions = await prisma.cargoPortion.findMany({
      where: { currentSlotId: slotId },
      select: {
        label: true,
        quantity: true,
        pkgsType: true,
        status: true,
        cargo: {
          select: {
            cssCcdNo: true,
            containerNo: true,
            blNo: true,
            consigneeName: true,
            vesselName: true,
            dateOfArrival: true,
            commodity: true,
            noOfPkgs: true,
            cbm: true,
            status: true,
            isOverdue: true,
            detainedByCustoms: true,
            detainedByHealth: true,
            detainedCargoRefNo: true,
            remarks: true,
          },
        },
      },
    });

    // Exclude portions whose parent cargo is already shown (currentSlotId === slotId)
    const cargoIds = new Set(cargos.map((c) => c.cssCcdNo));
    const standalonePortions = portions.filter((p) => !cargoIds.has(p.cargo.cssCcdNo));

    if (cargos.length === 0 && standalonePortions.length === 0) {
      return ctx.reply(`Slot ${slotId} is empty.`);
    }

    const blocks: string[] = [`Slot ${slotId}\n`];

    for (const c of cargos) {
      blocks.push(formatCargo(c));
    }

    for (const p of standalonePortions) {
      blocks.push(formatPortionEntry(p));
    }

    return ctx.reply(blocks.join('\n---\n'), { parse_mode: 'HTML' });
  });
}

type CargoBrief = {
  cssCcdNo: string;
  containerNo: string;
  blNo: string;
  consigneeName: string;
  vesselName: string;
  dateOfArrival: Date;
  commodity: string;
  cargoDescription: string;
  noOfPkgs: number;
  pkgsType: string;
  cbm: number;
  fclLcl: string;
  containerSize: string;
  status: string;
  isOverdue: boolean;
  detainedByCustoms: boolean;
  detainedByHealth: boolean;
  detainedCargoRefNo: string | null;
  remarks: string;
  portions: { label: string; quantity: number; pkgsType: string; currentSlotId: string | null; status: string }[];
};

function formatCargo(c: CargoBrief): string {
  const lines = [
    `<b>${c.containerNo}</b>  <i>${c.cssCcdNo}</i>`,
    `Consignee: ${c.consigneeName}`,
    `BL No: ${c.blNo}`,
    `Vessel: ${c.vesselName}  |  Arrived: ${c.dateOfArrival.toISOString().slice(0, 10)}`,
    `Commodity: ${c.commodity}${c.cargoDescription ? ' — ' + c.cargoDescription : ''}`,
    `Packages: ${c.noOfPkgs} ${c.pkgsType}  |  CBM: ${c.cbm}  |  ${c.fclLcl}${c.containerSize !== 'NA' ? ' ' + c.containerSize : ''}`,
    `Status: ${formatStatus(c.status)}${c.isOverdue ? '  ⚠ OVERDUE' : ''}`,
  ];

  const flags: string[] = [];
  if (c.detainedByCustoms) flags.push(`Detained by Customs${c.detainedCargoRefNo ? ' (Ref: ' + c.detainedCargoRefNo + ')' : ''}`);
  if (c.detainedByHealth) flags.push('Detained by Health');
  if (flags.length) lines.push(flags.join('  |  '));
  if (c.remarks) lines.push(`Remarks: ${c.remarks}`);

  if (c.portions.length > 0) {
    lines.push(`Portions (${c.portions.length}):`);
    for (const p of c.portions) {
      const loc = p.currentSlotId ? p.currentSlotId : 'unassigned';
      lines.push(`  • ${p.label}: ${p.quantity} ${p.pkgsType} — ${loc} [${formatStatus(p.status)}]`);
    }
  }

  return lines.join('\n');
}

type PortionEntry = {
  label: string;
  quantity: number;
  pkgsType: string;
  status: string;
  cargo: {
    cssCcdNo: string;
    containerNo: string;
    blNo: string;
    consigneeName: string;
    vesselName: string;
    dateOfArrival: Date;
    commodity: string;
    noOfPkgs: number;
    cbm: number;
    status: string;
    isOverdue: boolean;
    detainedByCustoms: boolean;
    detainedByHealth: boolean;
    detainedCargoRefNo: string | null;
    remarks: string;
  };
};

function formatPortionEntry(p: PortionEntry): string {
  const c = p.cargo;
  const lines = [
    `<b>${c.containerNo}</b>  <i>${c.cssCcdNo}</i>  (portion: ${p.label})`,
    `Consignee: ${c.consigneeName}`,
    `BL No: ${c.blNo}`,
    `Vessel: ${c.vesselName}  |  Arrived: ${c.dateOfArrival.toISOString().slice(0, 10)}`,
    `Commodity: ${c.commodity}`,
    `This portion: ${p.quantity} ${p.pkgsType}  |  Total CBM: ${c.cbm}`,
    `Status: ${formatStatus(p.status)}${c.isOverdue ? '  ⚠ OVERDUE' : ''}`,
  ];

  const flags: string[] = [];
  if (c.detainedByCustoms) flags.push(`Detained by Customs${c.detainedCargoRefNo ? ' (Ref: ' + c.detainedCargoRefNo + ')' : ''}`);
  if (c.detainedByHealth) flags.push('Detained by Health');
  if (flags.length) lines.push(flags.join('  |  '));
  if (c.remarks) lines.push(`Remarks: ${c.remarks}`);

  return lines.join('\n');
}

function formatStatus(status: string): string {
  const MAP: Record<string, string> = {
    IN_RACK: 'In Rack',
    CHECKED_FOR_AUCTION: 'Checked for Auction',
    IN_CHECKING_AREA: 'In Checking Area',
    CLEARED: 'Cleared',
    MARKED_FOR_DISPOSAL: 'Marked for Disposal',
    DAMAGED: 'Damaged',
  };
  return MAP[status] ?? status.replace(/_/g, ' ');
}
