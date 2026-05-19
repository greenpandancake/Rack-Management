# Manual Vessel Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore full manual vessel cargo entry and allow unidentified vessel placeholders to be matched from the cargo detail screen.

**Architecture:** Reuse the existing vessel row schema and merge endpoint shape so manual entries and manifest entries produce the same `Cargo` data. Keep quick unidentified intake available, add a detailed manual row create path, and put a merge form on cargo detail only for unidentified manual vessel intake items.

**Tech Stack:** Express, Prisma, Zod, TypeScript, React, React Query, Vite.

---

### Task 1: Server Detailed Manual Vessel Mapping

**Files:**
- Modify: `server/src/api/cargo.ts`
- Test: `server/src/api/vesselCargoMapping.test.ts`

- [ ] Add a failing assertion that `vesselRowToCargoForTest` maps a detailed manual row to `blNo`, `consigneeName`, `mark`, `cargoDescription`, `pkgsType`, and `noOfPkgs`.
- [ ] Add a detailed vessel manual schema extending vessel name/date with one `row`.
- [ ] Add `POST /api/cargo/vessel-manual-detail` that creates one cargo record via `vesselRowToCargo`.
- [ ] Run `cd server && npx tsx src/api/vesselCargoMapping.test.ts`.

### Task 2: Client API and Shared Form

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/pages/VesselIntake.tsx`

- [ ] Add `createDetailedManualVesselCargo({ vesselName, arrivalDate, row })`.
- [ ] Add a reusable vessel row form component with BL/ref, consignee, mark, cargo description, package type, quantity, and remarks fields.
- [ ] In `Manual Entry`, keep the unidentified save flow and add a detailed cargo section that submits through the new API.

### Task 3: Cargo Detail Merge Panel

**Files:**
- Modify: `client/src/pages/CargoDetail.tsx`

- [ ] Detect unidentified manual vessel records.
- [ ] Render a `Match / Merge cargo details` panel with the same vessel row fields.
- [ ] Submit to `api.mergeVesselRow(cargo.id, { vesselName, arrivalDate, row })` and refresh cargo/list/slots queries.

### Task 4: Verify

**Files:**
- Build outputs under `client/dist` and `server/dist`.

- [ ] Run all server `.test.ts` scripts.
- [ ] Run `cd server && npm run build`.
- [ ] Run `npm run build:client`.
