# Vessel Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Vessel Intake page with manual entry and `.xls` manifest import/review for non-perishable general cargo.

**Architecture:** Keep CFS intake unchanged. Add server-side vessel intake helpers that normalize manual/import rows into existing `Cargo` records using vessel-safe placeholders for container-only fields. Add a React page with two tabs that submits manual rows or uploads manifests for preview and selected bulk import.

**Tech Stack:** Express, Prisma, Zod, TypeScript, React, React Query, Vite.

---

### Task 1: Server Manifest Parser

**Files:**
- Create: `server/src/services/vesselManifest.ts`
- Test: `server/src/services/vesselManifest.test.ts`

- [ ] Write tests for excluding perishable rows and keeping general cargo rows from extracted manifest text.
- [ ] Implement keyword-based perishable detection and row extraction from BIFF `.xls` UTF-16 text.
- [ ] Run `cd server && npx tsx src/services/vesselManifest.test.ts`.

### Task 2: Server Vessel API

**Files:**
- Modify: `server/src/api/cargo.ts`

- [ ] Add a reusable `createCargoRecord` helper around existing cargo creation transaction.
- [ ] Add `POST /api/cargo/vessel-manifest/preview` accepting multipart file upload and returning eligible/excluded rows.
- [ ] Add `POST /api/cargo/vessel-bulk` accepting selected vessel rows and creating cargo records with `containerNo: "VESSEL"`, `fclLcl: "LCL"`, `containerSize: "NA"`, `cbm: 0`, and no initial slot.

### Task 3: Client API + Page

**Files:**
- Modify: `client/src/api.ts`
- Create: `client/src/pages/VesselIntake.tsx`
- Modify: `client/src/App.tsx`

- [ ] Add client types and API calls for preview and bulk vessel intake.
- [ ] Build the Vessel Intake page with `Manual Entry` and `Import Manifest` tabs.
- [ ] Add nav button labelled `Vessel Intake` and route `/vessel-intake`.

### Task 4: Verify

**Files:**
- Build outputs under `client/dist` and `server/dist`.

- [ ] Run `cd server && npx tsx src/services/vesselManifest.test.ts`.
- [ ] Run `npm run build:client`.
- [ ] Run `npm run build:server`.
