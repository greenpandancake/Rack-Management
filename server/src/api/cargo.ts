import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { prisma } from '../db.js';
import { bus } from '../realtime/bus.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { parseManifestBuffer } from '../services/vesselManifest.js';

export const cargoRouter = Router();
cargoRouter.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ID_PREFIX = 'MCH/WH-';
const ID_PAD = 5;
const UNIDENTIFIED_BL_NO = 'PENDING';
const UNKNOWN_CONSIGNEE = 'Unknown Consignee';
const UNIDENTIFIED_DESCRIPTION = 'Unidentified general cargo';

function normalizeVesselName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => {
      if (/^[a-z]{1,2}$/i.test(part)) return part.toUpperCase();
      return part.replace(/[a-z]+/gi, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
    })
    .join(' ');
}

async function nextCargoId(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.cargo.findFirst({
    where: { cssCcdNo: { startsWith: ID_PREFIX } },
    orderBy: { cssCcdNo: 'desc' },
    select: { cssCcdNo: true },
  });
  let next = 1;
  if (last) {
    const m = last.cssCcdNo.match(/^MCH\/WH-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${ID_PREFIX}${String(next).padStart(ID_PAD, '0')}`;
}

const cargoSchema = z.object({
  vesselName: z.string().min(1),
  dateOfArrival: z.coerce.date(),
  containerNo: z.string().min(1),
  blNo: z.string().min(1),
  consigneeName: z.string().min(1),
  mark: z.string().default(''),
  commodity: z.string().default('GENERAL CARGO'),
  cargoDescription: z.string().default(''),
  pkgsType: z.string().min(1),
  noOfPkgs: z.coerce.number().int().nonnegative(),
  cbm: z.coerce.number().nonnegative().default(0),
  fclLcl: z.enum(['FCL', 'LCL']).default('LCL'),
  containerSize: z.enum(['FT20', 'FT40', 'NA']).default('NA'),
  detainedByCustoms: z.coerce.boolean().default(false),
  detainedByHealth: z.coerce.boolean().default(false),
  detainedCargoRefNo: z.string().optional().nullable(),
  reasonOfShifting: z.string().default(''),
  clearanceOfficer: z.string().default(''),
  clearanceEmployId: z.string().default(''),
  shiftedDate: z.coerce.date(),
  remarks: z.string().default(''),
  currentSlotId: z.string().optional().nullable(),
});

type CargoInput = z.infer<typeof cargoSchema>;

async function createCargoRecord(
  tx: Prisma.TransactionClient,
  data: CargoInput,
  user: NonNullable<Express.Request['session']['user']>,
) {
  const cssCcdNo = await nextCargoId(tx);
  const created = await tx.cargo.create({
    data: {
      ...data,
      cssCcdNo,
      detainedCargoRefNo: data.detainedCargoRefNo ?? null,
      currentSlotId: data.currentSlotId ?? null,
    },
  });
  if (data.currentSlotId) {
    await tx.moveLog.create({
      data: {
        cargoId: created.id,
        fromSlotId: null,
        toSlotId: data.currentSlotId,
        movedBy: user.username,
        userId: user.id,
        source: 'OFFICE',
      },
    });
  }
  return created;
}

const vesselRowSchema = z.object({
  manifestRef: z.string().min(1),
  consigneeName: z.string().min(1),
  mark: z.string().default(''),
  commodity: z.string().min(1),
  cargoDescription: z.string().default(''),
  pkgsType: z.string().min(1).default('PKG'),
  noOfPkgs: z.coerce.number().int().nonnegative().default(0),
  clearedQty: z.coerce.number().int().nonnegative().default(0),
  remarks: z.string().default(''),
});

const vesselBulkSchema = z.object({
  vesselName: z.string().min(1),
  arrivalDate: z.coerce.date(),
  rows: z.array(vesselRowSchema).min(1),
});

const vesselManualSchema = z.object({
  vesselName: z.string().min(1),
  arrivalDate: z.coerce.date(),
});

const vesselManualDetailSchema = vesselManualSchema.extend({
  row: vesselRowSchema,
});

const vesselMergeSchema = z.object({
  vesselName: z.string().min(1),
  arrivalDate: z.coerce.date(),
  row: vesselRowSchema,
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

function manualVesselCargoToCargo(data: z.infer<typeof vesselManualSchema>): CargoInput {
  return {
    vesselName: normalizeVesselName(data.vesselName),
    dateOfArrival: data.arrivalDate,
    containerNo: 'VESSEL',
    blNo: UNIDENTIFIED_BL_NO,
    consigneeName: UNKNOWN_CONSIGNEE,
    mark: '',
    commodity: 'GENERAL CARGO',
    cargoDescription: UNIDENTIFIED_DESCRIPTION,
    pkgsType: 'PKG',
    noOfPkgs: 0,
    cbm: 0,
    fclLcl: 'LCL',
    containerSize: 'NA',
    detainedByCustoms: false,
    detainedByHealth: false,
    detainedCargoRefNo: null,
    reasonOfShifting: 'Manual vessel intake',
    clearanceOfficer: '',
    clearanceEmployId: '',
    shiftedDate: new Date(),
    remarks: '',
    currentSlotId: null,
  };
}

function vesselRowToCargo(data: { vesselName: string; arrivalDate: Date }, row: z.infer<typeof vesselRowSchema>): CargoInput {
  return {
    vesselName: normalizeVesselName(data.vesselName),
    dateOfArrival: data.arrivalDate,
    containerNo: 'VESSEL',
    blNo: row.manifestRef,
    consigneeName: row.consigneeName,
    mark: row.mark,
    commodity: 'GENERAL CARGO',
    cargoDescription: row.cargoDescription || row.commodity,
    pkgsType: row.pkgsType,
    noOfPkgs: row.noOfPkgs,
    cbm: 0,
    fclLcl: 'LCL',
    containerSize: 'NA',
    detainedByCustoms: false,
    detainedByHealth: false,
    detainedCargoRefNo: null,
    reasonOfShifting: 'Vessel intake',
    clearanceOfficer: '',
    clearanceEmployId: '',
    shiftedDate: new Date(),
    remarks: '',
    currentSlotId: null,
  };
}

function vesselRowMergeData(row: z.infer<typeof vesselRowSchema>): Prisma.CargoUpdateInput {
  return {
    blNo: row.manifestRef,
    consigneeName: row.consigneeName,
    mark: row.mark,
    commodity: 'GENERAL CARGO',
    cargoDescription: row.cargoDescription || row.commodity,
    pkgsType: row.pkgsType,
    noOfPkgs: row.noOfPkgs,
    remarks: '',
    reasonOfShifting: 'Vessel intake',
  };
}

function isSameArrivalDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function isUnidentifiedManualVesselCargo(cargo: { blNo: string; containerNo: string; reasonOfShifting: string }): boolean {
  return cargo.containerNo === 'VESSEL' &&
    cargo.blNo === UNIDENTIFIED_BL_NO &&
    cargo.reasonOfShifting === 'Manual vessel intake';
}

function buildDistinctVesselItems(rows: Array<{ vesselName: string; dateOfArrival: Date }>) {
  const seen = new Set<string>();
  const items: Array<{ vesselName: string; arrivalDate: string }> = [];
  for (const row of rows) {
    const arrivalDate = row.dateOfArrival.toISOString().slice(0, 10);
    const vesselName = normalizeVesselName(row.vesselName);
    const key = `${vesselName.toLowerCase()}\u0000${arrivalDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ vesselName, arrivalDate });
  }
  return items;
}

export const manualVesselCargoToCargoForTest = manualVesselCargoToCargo;
export const vesselRowToCargoForTest = vesselRowToCargo;
export const vesselRowMergeDataForTest = vesselRowMergeData;
export const normalizeVesselNameForTest = normalizeVesselName;
export const buildDistinctVesselItemsForTest = buildDistinctVesselItems;

function nextPortionLabel(count: number): string {
  return `Part ${count + 1}`;
}

async function ensureCargoPortions(tx: Prisma.TransactionClient, cargo: Awaited<ReturnType<typeof prisma.cargo.findUnique>>) {
  if (!cargo) throw new Error('cargo_not_found');
  const portions = await tx.cargoPortion.findMany({
    where: { cargoId: cargo.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (portions.length > 0) return portions;
  const created = await tx.cargoPortion.create({
    data: {
      cargoId: cargo.id,
      label: 'Part 1',
      quantity: cargo.noOfPkgs,
      pkgsType: cargo.pkgsType,
      currentSlotId: cargo.currentSlotId,
      status: cargo.status,
    },
  });
  return [created];
}

cargoRouter.get('/', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const statusParam = (req.query.status as string | undefined)?.trim();
  const unassigned = req.query.unassigned === 'true';
  const vesselName = (req.query.vesselName as string | undefined)?.trim();
  const arrivalDate = (req.query.arrivalDate as string | undefined)?.trim();
  const rawStatuses = statusParam ? statusParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const statuses = rawStatuses.filter((s): s is (typeof CARGO_STATUSES)[number] =>
    (CARGO_STATUSES as readonly string[]).includes(s),
  );
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));

  const where = buildCargoWhere({ q, statuses, unassigned, vesselName, arrivalDate });

  const pageItems = await prisma.cargo.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    include: { currentSlot: true, portions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { currentSlot: true } } },
    take: unassigned ? 1000 : undefined,
  });

  const visibleItems = unassigned ? pageItems.filter(isCargoLocationUnassigned) : pageItems;
  const total = visibleItems.length;
  const items = visibleItems.slice((page - 1) * pageSize, page * pageSize);

  res.json({ items, total, page, pageSize });
});

cargoRouter.get('/vessels', async (_req, res) => {
  const rows = await prisma.cargo.findMany({
    where: { vesselName: { not: '' } },
    select: { vesselName: true, dateOfArrival: true },
    orderBy: [{ dateOfArrival: 'desc' }, { vesselName: 'asc' }],
  });
  res.json({ items: buildDistinctVesselItems(rows) });
});

type BuildCargoWhereInput = {
  q?: string;
  statuses: readonly (typeof CARGO_STATUSES)[number][];
  unassigned: boolean;
  vesselName?: string;
  arrivalDate?: string;
};

function buildCargoWhere({
  q,
  statuses,
  unassigned,
  vesselName,
  arrivalDate,
}: BuildCargoWhereInput): Prisma.CargoWhereInput {
  return {
    ...(q
      ? {
          OR: [
            { containerNo: { contains: q } },
            { blNo: { contains: q } },
            { consigneeName: { contains: q } },
            { cssCcdNo: { contains: q } },
            { vesselName: { contains: q } },
          ],
        }
      : {}),
    ...(statuses.length > 0 ? { status: { in: [...statuses] } } : {}),
    ...(unassigned ? { currentSlotId: null } : {}),
    ...(vesselName ? { vesselName } : {}),
    ...(arrivalDate ? { dateOfArrival: arrivalDateRange(arrivalDate) } : {}),
  };
}

function arrivalDateRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

export const buildCargoWhereForTest = buildCargoWhere;

function isCargoLocationUnassigned(cargo: { currentSlotId: string | null; portions?: Array<{ currentSlotId: string | null }> }): boolean {
  if (!cargo.portions || cargo.portions.length === 0) return cargo.currentSlotId == null;
  return cargo.portions.some((portion) => portion.currentSlotId == null);
}

function buildBulkDeleteWhere(ids: string[]): Prisma.CargoWhereInput {
  const cleanIds = ids.map((id) => id.trim()).filter(Boolean);
  if (cleanIds.length === 0) throw new Error('at_least_one_id_required');
  return { id: { in: cleanIds } };
}

export const buildBulkDeleteWhereForTest = buildBulkDeleteWhere;

cargoRouter.post('/vessel-manifest/preview', upload.single('manifest'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'manifest_file_required' });
  const parsed = parseManifestBuffer(req.file.buffer, req.file.originalname);
  res.json(parsed);
});

cargoRouter.get('/vessel-unidentified', async (req, res) => {
  const vesselName = (req.query.vesselName as string | undefined)?.trim();
  const arrivalDate = (req.query.arrivalDate as string | undefined)?.trim();
  if (!vesselName || !arrivalDate) return res.status(400).json({ error: 'vessel_and_arrival_required' });
  const items = await prisma.cargo.findMany({
    where: {
      vesselName,
      dateOfArrival: arrivalDateRange(arrivalDate),
      containerNo: 'VESSEL',
      blNo: UNIDENTIFIED_BL_NO,
      reasonOfShifting: 'Manual vessel intake',
      status: { not: 'CLEARED' },
    },
    orderBy: [{ createdAt: 'asc' }],
    include: { currentSlot: true },
  });
  res.json({ items });
});

cargoRouter.get('/vessel-lookup', async (req, res) => {
  const vesselName = (req.query.vesselName as string | undefined)?.trim();
  const arrivalDate = (req.query.arrivalDate as string | undefined)?.trim();
  const q = (req.query.q as string | undefined)?.trim();
  if (!vesselName || !arrivalDate || !q || q.length < 2) return res.json({ items: [] });
  const items = await prisma.cargo.findMany({
    where: {
      vesselName,
      dateOfArrival: arrivalDateRange(arrivalDate),
      containerNo: 'VESSEL',
      blNo: { not: UNIDENTIFIED_BL_NO },
      OR: [
        { blNo: { contains: q } },
        { consigneeName: { contains: q } },
      ],
    },
    select: {
      id: true,
      blNo: true,
      consigneeName: true,
      mark: true,
      cargoDescription: true,
      pkgsType: true,
      noOfPkgs: true,
      remarks: true,
    },
    take: 6,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ items });
});

cargoRouter.delete('/bulk', requireSuperAdmin, async (req, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const where = buildBulkDeleteWhere(parsed.data.ids);
  const existing = await prisma.cargo.findMany({ where, select: { id: true } });
  if (existing.length === 0) return res.json({ deleted: 0 });
  const result = await prisma.cargo.deleteMany({ where: { id: { in: existing.map((cargo) => cargo.id) } } });
  existing.forEach((cargo) => bus.emitEvent({ type: 'cargo:updated', cargoId: cargo.id }));
  res.json({ deleted: result.count });
});

async function findDuplicateBLs(
  vesselName: string,
  arrivalDate: Date,
  blNos: string[],
): Promise<{ blNo: string; cssCcdNo: string; consigneeName: string }[]> {
  if (blNos.length === 0) return [];
  const arrivalDateStr = arrivalDate.toISOString().slice(0, 10);
  const existing = await prisma.cargo.findMany({
    where: {
      vesselName: normalizeVesselName(vesselName),
      dateOfArrival: arrivalDateRange(arrivalDateStr),
      blNo: { in: blNos },
      status: { not: 'CLEARED' },
    },
    select: { blNo: true, cssCcdNo: true, consigneeName: true },
  });
  return existing;
}

function groupManifestRowsByBL(rows: z.infer<typeof vesselRowSchema>[]): z.infer<typeof vesselRowSchema>[] {
  const groups = new Map<string, z.infer<typeof vesselRowSchema>[]>();
  for (const row of rows) {
    const key = row.manifestRef.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    return {
      ...first,
      cargoDescription: group.map((r) => r.cargoDescription).filter(Boolean).join(' / '),
      noOfPkgs: group.reduce((sum, r) => sum + r.noOfPkgs, 0),
      remarks: group.map((r) => r.remarks).filter(Boolean).join('; '),
    };
  });
}

cargoRouter.post('/vessel-bulk', async (req, res) => {
  const parsed = vesselBulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const mergedRows = groupManifestRowsByBL(data.rows);
  const duplicates = await findDuplicateBLs(
    data.vesselName,
    data.arrivalDate,
    mergedRows.map((r) => r.manifestRef),
  );
  if (duplicates.length > 0) {
    return res.status(409).json({ error: 'duplicate_manifest_entries', duplicates });
  }
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const cargos = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const row of mergedRows) {
          created.push(await createCargoRecord(tx, vesselRowToCargo(data, row), req.session.user!));
        }
        return created;
      });
      cargos.forEach((cargo) => bus.emitEvent({ type: 'cargo:created', cargoId: cargo.id }));
      return res.status(201).json({ items: cargos, total: cargos.length });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (attempt < MAX_RETRIES - 1) continue;
        return res.status(409).json({ error: 'id_generation_collision' });
      }
      throw err;
    }
  }
  return res.status(500).json({ error: 'id_generation_failed' });
});

cargoRouter.post('/vessel-manual', async (req, res) => {
  const parsed = vesselManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const cargo = await prisma.$transaction(async (tx) => {
        return createCargoRecord(tx, manualVesselCargoToCargo(data), req.session.user!);
      });
      bus.emitEvent({ type: 'cargo:created', cargoId: cargo.id });
      return res.status(201).json(cargo);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (attempt < MAX_RETRIES - 1) continue;
        return res.status(409).json({ error: 'id_generation_collision' });
      }
      throw err;
    }
  }
  return res.status(500).json({ error: 'id_generation_failed' });
});

cargoRouter.post('/vessel-manual-detail', async (req, res) => {
  const parsed = vesselManualDetailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const duplicates = await findDuplicateBLs(data.vesselName, data.arrivalDate, [data.row.manifestRef]);
  if (duplicates.length > 0) {
    return res.status(409).json({ error: 'duplicate_manifest_entries', duplicates });
  }
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const cargo = await prisma.$transaction(async (tx) => {
        return createCargoRecord(tx, vesselRowToCargo(data, data.row), req.session.user!);
      });
      bus.emitEvent({ type: 'cargo:created', cargoId: cargo.id });
      return res.status(201).json(cargo);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (attempt < MAX_RETRIES - 1) continue;
        return res.status(409).json({ error: 'id_generation_collision' });
      }
      throw err;
    }
  }
  return res.status(500).json({ error: 'id_generation_failed' });
});

cargoRouter.get('/:id', async (req, res) => {
  const cargo = await prisma.cargo.findUnique({
    where: { id: req.params.id },
    include: {
      currentSlot: true,
      portions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { currentSlot: true } },
      photos: { orderBy: { uploadedAt: 'desc' } },
      moveLogs: { orderBy: { movedAt: 'desc' }, include: { portion: true, fromSlot: true, toSlot: true, user: { select: { id: true, username: true, name: true } } } },
      reports: { orderBy: { reportedAt: 'desc' }, include: { photo: true } },
    },
  });
  if (!cargo) return res.status(404).json({ error: 'not_found' });
  res.json(cargo);
});

cargoRouter.post('/:id/merge-vessel-row', async (req, res) => {
  const parsed = vesselMergeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const cargo = await prisma.cargo.findUnique({ where: { id: req.params.id } });
  if (!cargo) return res.status(404).json({ error: 'not_found' });
  if (!isUnidentifiedManualVesselCargo(cargo)) {
    return res.status(409).json({ error: 'cargo_not_unidentified_manual_vessel_intake' });
  }
  if (normalizeVesselName(cargo.vesselName) !== normalizeVesselName(data.vesselName) || !isSameArrivalDay(cargo.dateOfArrival, data.arrivalDate)) {
    return res.status(409).json({ error: 'vessel_or_arrival_mismatch' });
  }
  const arrivalDateStr = cargo.dateOfArrival.toISOString().slice(0, 10);
  const existingInRack = await prisma.cargo.findFirst({
    where: {
      vesselName: cargo.vesselName,
      dateOfArrival: arrivalDateRange(arrivalDateStr),
      blNo: data.row.manifestRef,
      id: { not: cargo.id },
      status: { not: 'CLEARED' },
      currentSlotId: { not: null },
    },
    select: { cssCcdNo: true, currentSlotId: true, noOfPkgs: true, pkgsType: true },
  });
  if (existingInRack) {
    return res.status(409).json({
      error: 'bl_already_in_rack',
      cssCcdNo: existingInRack.cssCcdNo,
      currentSlotId: existingInRack.currentSlotId,
      noOfPkgs: existingInRack.noOfPkgs,
      pkgsType: existingInRack.pkgsType,
    });
  }
  const updated = await prisma.cargo.update({
    where: { id: cargo.id },
    data: vesselRowMergeData(data.row),
  });
  bus.emitEvent({ type: 'cargo:updated', cargoId: updated.id });
  res.json(updated);
});

const splitSchema = z.object({
  splitQty: z.coerce.number().int().positive(),
});

const moveSchema = z.object({
  toSlotId: z.string().nullable(),
  movedBy: z.string().default('office'),
});

cargoRouter.post('/:id/split', async (req, res) => {
  const parsed = splitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { splitQty } = parsed.data;

  const cargo = await prisma.cargo.findUnique({ where: { id: req.params.id } });
  if (!cargo) return res.status(404).json({ error: 'not_found' });
  if (cargo.status === 'CLEARED') return res.status(409).json({ error: 'cannot_split_cleared_cargo' });
  if (cargo.noOfPkgs <= 1) return res.status(409).json({ error: 'cargo_has_insufficient_packages' });
  if (splitQty >= cargo.noOfPkgs) return res.status(409).json({ error: 'split_qty_must_be_less_than_total' });

  const result = await prisma.$transaction(async (tx) => {
    const portions = await ensureCargoPortions(tx, cargo);
    const source = [...portions].sort((a, b) => b.quantity - a.quantity)[0];
    if (!source || source.quantity <= splitQty) throw new Error('split_qty_must_be_less_than_source_portion');
    const updatedSource = await tx.cargoPortion.update({
      where: { id: source.id },
      data: { quantity: source.quantity - splitQty },
    });
    const split = await tx.cargoPortion.create({
      data: {
        cargoId: cargo.id,
        label: nextPortionLabel(portions.length),
        quantity: splitQty,
        pkgsType: cargo.pkgsType,
        currentSlotId: null,
        status: 'IN_RACK',
      },
    });
    const original = await tx.cargo.update({
      where: { id: cargo.id },
      data: { currentSlotId: null },
      include: { portions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { currentSlot: true } } },
    });
    return { original, source: updatedSource, split };
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'split_qty_must_be_less_than_source_portion') return null;
    throw err;
  });
  if (!result) return res.status(409).json({ error: 'split_qty_must_be_less_than_source_portion' });
  bus.emitEvent({ type: 'cargo:updated', cargoId: result.original.id });
  return res.status(201).json(result);
});

cargoRouter.delete('/:id/portions/:portionId', async (req, res) => {
  const movedBy = req.session.user!.username;
  const cargo = await prisma.cargo.findUnique({
    where: { id: req.params.id },
    include: { portions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!cargo) return res.status(404).json({ error: 'not_found' });
  const portion = cargo.portions.find((p) => p.id === req.params.portionId);
  if (!portion) return res.status(404).json({ error: 'not_found' });
  if (cargo.portions.length <= 1) return res.status(409).json({ error: 'cannot_delete_last_portion' });

  const remaining = cargo.portions.filter((p) => p.id !== portion.id);
  const recipient = [...remaining].sort((a, b) => b.quantity - a.quantity)[0];

  await prisma.$transaction(async (tx) => {
    if (portion.currentSlotId) {
      await tx.moveLog.create({
        data: { cargoId: cargo.id, portionId: portion.id, fromSlotId: portion.currentSlotId, toSlotId: null, movedBy, userId: req.session.user!.id, source: 'OFFICE' },
      });
    }
    if (remaining.length === 1) {
      await tx.cargo.update({ where: { id: cargo.id }, data: { currentSlotId: recipient.currentSlotId, status: recipient.status } });
      await tx.cargoPortion.deleteMany({ where: { cargoId: cargo.id } });
    } else {
      await tx.cargoPortion.update({ where: { id: recipient.id }, data: { quantity: recipient.quantity + portion.quantity } });
      await tx.cargoPortion.delete({ where: { id: portion.id } });
    }
  });

  bus.emitEvent({ type: 'cargo:updated', cargoId: cargo.id });
  if (portion.currentSlotId) {
    bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: portion.currentSlotId, toSlot: null });
  }
  res.json({ ok: true });
});

cargoRouter.post('/:id/portions/:portionId/move', async (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { toSlotId } = parsed.data;
  const movedBy = req.session.user!.username;
  const portion = await prisma.cargoPortion.findFirst({
    where: { id: req.params.portionId, cargoId: req.params.id },
    include: { cargo: true },
  });
  if (!portion) return res.status(404).json({ error: 'not_found' });
  if (portion.cargo.status === 'CLEARED') return res.status(409).json({ error: 'cannot_move_cleared_cargo' });
  if (toSlotId) {
    const slot = await prisma.rackSlot.findUnique({ where: { id: toSlotId } });
    if (!slot || !slot.isActive) return res.status(400).json({ error: 'invalid_slot' });
  }
  const fromSlotId = portion.currentSlotId;
  await prisma.$transaction([
    prisma.cargoPortion.update({
      where: { id: portion.id },
      data: {
        currentSlotId: toSlotId,
        ...(toSlotId ? { status: 'IN_RACK' } : {}),
      },
    }),
    prisma.moveLog.create({
      data: {
        cargoId: portion.cargoId,
        portionId: portion.id,
        fromSlotId,
        toSlotId,
        movedBy,
        userId: req.session.user!.id,
        source: 'OFFICE',
      },
    }),
  ]);
  bus.emitEvent({ type: 'cargo:moved', cargoId: portion.cargoId, fromSlot: fromSlotId, toSlot: toSlotId });
  res.json({ ok: true });
});

cargoRouter.post('/', async (req, res) => {
  const parsed = cargoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const cargo = await prisma.$transaction(async (tx) => {
        return createCargoRecord(tx, data, req.session.user!);
      });
      bus.emitEvent({ type: 'cargo:created', cargoId: cargo.id });
      return res.status(201).json(cargo);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (attempt < MAX_RETRIES - 1) continue;
        return res.status(409).json({ error: 'id_generation_collision' });
      }
      throw err;
    }
  }
  return res.status(500).json({ error: 'id_generation_failed' });
});

cargoRouter.post('/:id/move', async (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { toSlotId } = parsed.data;
  const movedBy = req.session.user!.username;
  const cargo = await prisma.cargo.findUnique({ where: { id: req.params.id } });
  if (!cargo) return res.status(404).json({ error: 'not_found' });
  if (toSlotId) {
    const slot = await prisma.rackSlot.findUnique({ where: { id: toSlotId } });
    if (!slot || !slot.isActive) return res.status(400).json({ error: 'invalid_slot' });
  }
  const fromSlotId = cargo.currentSlotId;
  const keepStatus = cargo.status === 'IN_RACK' || cargo.status === 'CHECKED_FOR_AUCTION';
  await prisma.$transaction([
    prisma.cargo.update({
      where: { id: cargo.id },
      data: {
        currentSlotId: toSlotId,
        ...(toSlotId && !keepStatus ? { status: 'IN_RACK' } : {}),
      },
    }),
    prisma.moveLog.create({
      data: { cargoId: cargo.id, fromSlotId, toSlotId, movedBy, userId: req.session.user!.id, source: 'OFFICE' },
    }),
  ]);
  bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: fromSlotId, toSlot: toSlotId });
  res.json({ ok: true });
});

const CARGO_STATUSES = [
  'IN_RACK',
  'CHECKED_FOR_AUCTION',
  'IN_CHECKING_AREA',
  'CLEARED',
  'MARKED_FOR_DISPOSAL',
  'DAMAGED',
] as const;

const SLOT_FREEING_STATUSES = new Set(['IN_CHECKING_AREA', 'CLEARED']);

const patchSchema = cargoSchema.omit({ currentSlotId: true }).partial();

cargoRouter.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const cargo = await prisma.cargo.update({
    where: { id: req.params.id },
    data: {
      ...data,
      detainedCargoRefNo:
        'detainedCargoRefNo' in data ? data.detainedCargoRefNo ?? null : undefined,
    },
  });
  bus.emitEvent({ type: 'cargo:updated', cargoId: cargo.id });
  res.json(cargo);
});

const statusSchema = z.object({
  status: z.enum(CARGO_STATUSES),
  movedBy: z.string().default('office'),
});

cargoRouter.post('/:id/status', async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { status } = parsed.data;
  const movedBy = req.session.user!.username;
  const cargo = await prisma.cargo.findUnique({
    where: { id: req.params.id },
    include: { portions: { select: { id: true, currentSlotId: true } } },
  });
  if (!cargo) return res.status(404).json({ error: 'not_found' });

  const fromSlotId = cargo.currentSlotId;
  const freeSlot = SLOT_FREEING_STATUSES.has(status);
  const wantsRack = status === 'IN_RACK' || status === 'CHECKED_FOR_AUCTION';
  const portionSlotMoves = cargo.portions
    .filter((portion) => portion.currentSlotId)
    .map((portion) => ({
      cargoId: cargo.id,
      portionId: portion.id,
      fromSlotId: portion.currentSlotId,
      toSlotId: null,
      movedBy,
      userId: req.session.user!.id,
      source: 'OFFICE',
    }));

  if (freeSlot) {
    const writes = [
      prisma.cargo.update({
        where: { id: cargo.id },
        data: { status, currentSlotId: null },
      }),
      prisma.cargoPortion.updateMany({
        where: { cargoId: cargo.id },
        data: { status, currentSlotId: null },
      }),
      ...(fromSlotId
        ? [
            prisma.moveLog.create({
              data: { cargoId: cargo.id, fromSlotId, toSlotId: null, movedBy, userId: req.session.user!.id, source: 'OFFICE' },
            }),
          ]
        : []),
      ...portionSlotMoves.map((data) => prisma.moveLog.create({ data })),
    ];
    await prisma.$transaction(writes);
    if (fromSlotId || portionSlotMoves.length > 0) {
      bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: fromSlotId, toSlot: null });
    }
  } else if (wantsRack && cargo.portions.length > 0) {
    const portionsNeedSlots = !fromSlotId && cargo.portions.some((p) => !p.currentSlotId);
    if (portionsNeedSlots) {
      const portionRestores = await Promise.all(
        cargo.portions
          .filter((p) => !p.currentSlotId)
          .map(async (portion) => {
            const lastMove = await prisma.moveLog.findFirst({
              where: { portionId: portion.id, fromSlotId: { not: null } },
              orderBy: { movedAt: 'desc' },
            });
            return { portion, lastSlotId: lastMove?.fromSlotId ?? null };
          }),
      );
      for (const { portion, lastSlotId } of portionRestores) {
        if (!lastSlotId) return res.status(409).json({ error: 'no_previous_slot' });
        const slot = await prisma.rackSlot.findUnique({ where: { id: lastSlotId } });
        if (!slot || !slot.isActive)
          return res.status(409).json({ error: 'previous_slot_unavailable', slotId: lastSlotId });
        const cargoOccupant = await prisma.cargo.findFirst({
          where: { currentSlotId: lastSlotId, status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION', 'MARKED_FOR_DISPOSAL'] } },
          select: { containerNo: true },
        });
        if (cargoOccupant)
          return res.status(409).json({ error: 'previous_slot_occupied', slotId: lastSlotId, containerNo: cargoOccupant.containerNo });
        const portionOccupant = await prisma.cargoPortion.findFirst({
          where: {
            currentSlotId: lastSlotId,
            status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION', 'MARKED_FOR_DISPOSAL'] },
            id: { not: portion.id },
          },
        });
        if (portionOccupant)
          return res.status(409).json({ error: 'previous_slot_occupied', slotId: lastSlotId });
      }
      await prisma.$transaction([
        prisma.cargo.update({ where: { id: cargo.id }, data: { status } }),
        ...portionRestores.map(({ portion, lastSlotId }) =>
          prisma.cargoPortion.update({ where: { id: portion.id }, data: { status, currentSlotId: lastSlotId } }),
        ),
        ...portionRestores.map(({ portion, lastSlotId }) =>
          prisma.moveLog.create({
            data: { cargoId: cargo.id, portionId: portion.id, fromSlotId: null, toSlotId: lastSlotId, movedBy, userId: req.session.user!.id, source: 'OFFICE' },
          }),
        ),
      ]);
      bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: null, toSlot: null });
    } else {
      await prisma.$transaction([
        prisma.cargo.update({ where: { id: cargo.id }, data: { status } }),
        prisma.cargoPortion.updateMany({ where: { cargoId: cargo.id }, data: { status } }),
      ]);
    }
  } else if (wantsRack && !fromSlotId) {
    const lastMove = await prisma.moveLog.findFirst({
      where: { cargoId: cargo.id, fromSlotId: { not: null } },
      orderBy: { movedAt: 'desc' },
    });
    const lastSlotId = lastMove?.fromSlotId ?? null;
    if (!lastSlotId) {
      return res.status(409).json({ error: 'no_previous_slot' });
    }
    const slot = await prisma.rackSlot.findUnique({ where: { id: lastSlotId } });
    if (!slot || !slot.isActive) {
      return res.status(409).json({ error: 'previous_slot_unavailable', slotId: lastSlotId });
    }
    const occupant = await prisma.cargo.findFirst({
      where: {
        currentSlotId: lastSlotId,
        status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION', 'MARKED_FOR_DISPOSAL'] },
        id: { not: cargo.id },
      },
      select: { containerNo: true },
    });
    if (occupant) {
      return res
        .status(409)
        .json({ error: 'previous_slot_occupied', slotId: lastSlotId, containerNo: occupant.containerNo });
    }
    await prisma.$transaction([
      prisma.cargo.update({
        where: { id: cargo.id },
        data: { status, currentSlotId: lastSlotId },
      }),
      prisma.moveLog.create({
        data: { cargoId: cargo.id, fromSlotId: null, toSlotId: lastSlotId, movedBy, userId: req.session.user!.id, source: 'OFFICE' },
      }),
    ]);
    bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: null, toSlot: lastSlotId });
  } else {
    await prisma.$transaction([
      prisma.cargo.update({ where: { id: cargo.id }, data: { status } }),
      prisma.cargoPortion.updateMany({ where: { cargoId: cargo.id }, data: { status } }),
    ]);
  }
  bus.emitEvent({ type: 'cargo:updated', cargoId: cargo.id });
  res.json({ ok: true });
});
