# FG Yard

Web system for the Finished Goods (FG) yard: machines from Stage 18 through the FG yard gate, parking
and security verification, FIFO yard stock, dispatch planning, the PDI check and main gate-out.
Served at `/fg-yard` (for example `https://projects.bullmachine.in/fg-yard/`). Formerly called
"Yard Management System".

> **What changed recently:** see [`CHANGELOG.md`](./CHANGELOG.md).
>
> **Updating a running server:** see [`INSTALL.md` › Updating an existing server](./INSTALL.md#13-updating-an-existing-server).

> **Full project documentation (objectives, architecture, API reference, developer guide): see [`PROJECT_DOCUMENTATION.md`](./PROJECT_DOCUMENTATION.md)**
>
> **Fresh-server installation walk-through (Windows + XAMPP or Linux): see [`INSTALL.md`](./INSTALL.md)**

## Project Description

**FG Yard** is a full-stack web application designed to digitize and streamline the management of backhoe loader inventory across manufacturing yard locations. It provides real-time visibility into machine positioning using a grid-based slot system, enabling yard operators and managers to track every machine's exact location, status, and movement history. The system replaces manual tracking methods with an intuitive dashboard, role-based access control, and automated slot allocation workflows — reducing errors, improving yard utilization, and accelerating machine dispatch operations.

## Project Scope

### In Scope

- **Yard Management** — Create and manage multiple yard locations with configurable row/col grid layouts and zone-based slot organization
- **Machine Tracking** — Track backhoe loaders by unique serial number, model, production date, and operational status (Available, Sold, Reserved, Under Inspection, In Repair, Dispatched)
- **Slot Allocation** — Auto-suggest available slots, prevent double allocation, support slot statuses (Available, Occupied, Reserved, Maintenance, Dispatch Ready, Blocked, Inspection)
- **Movement History** — Complete audit trail of all machine movements with reason tracking (Production, Inspection, Repair, Dispatch, Relocation, Maintenance) tied to user accounts
- **User Authentication & Roles** — JWT-based auth; access per role is set by an Admin on the Role Access page (roles: Admin, Yard Manager, Operator, Service Technician, Security, View Only, Driver, Planner, PDI, Main Gate)
- **Dashboard & Analytics** — Real-time statistics on yard occupancy, machine status distribution, and recent movement alerts
- **Search & Filtering** — Instant search by machine ID, serial number, or model across all yards
- **QR Code Integration** — Generate and scan QR codes for rapid machine identification and slot updates

### Out of Scope (Future Versions)

- **Boom Barrier Control** — Physical yard entry/exit gate automation
- **Queue Management** — FIFO-based vehicle entry queue with automatic allocation
- **Automatic Slot Allocation** — Fully automated machine-to-slot assignment without manual intervention
- **Simplified Slot Status** — Reducing slot status to only "Available" and "Occupied"
- **Mobile Native App** — Dedicated mobile applications for iOS/Android

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + TailwindCSS + shadcn/ui
- **Backend**: Express.js + TypeScript + Prisma ORM
- **Database**: MySQL

## Prerequisites

- Node.js 20.13+ (your current version: v20.13.1)
- MySQL installed and running (XAMPP includes MySQL)
- npm or yarn package manager

## Setup Instructions

### 1. Database Setup (MySQL)

Since you're using MySQL with XAMPP, create the database using one of these methods:

**Option A: Using phpMyAdmin**
1. Open phpMyAdmin at http://localhost/phpmyadmin
2. Click "New" to create a new database
3. Enter database name: `yard_management`
4. Click "Create"

**Option B: Using MySQL Command Line**
```bash
# Open MySQL command line (in XAMPP shell or cmd)
mysql -u root -p
# Enter your MySQL password (default in XAMPP is empty, just press Enter)

# Then run:
CREATE DATABASE yard_management;
EXIT;
```

### 2. Backend Setup

Navigate to the backend directory and install dependencies:

```bash
cd backend
npm install
```

Create a `.env` file in the backend directory with the following:

```env
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/yard_management"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=5000
NODE_ENV=development
SEED_ADMIN_EMAIL="admin@company.com"
SEED_ADMIN_PASSWORD="replace-with-a-strong-password"
SEED_ADMIN_NAME="Administrator"
SEED_USERS_PASSWORD="replace-with-a-strong-shared-password"
SEED_USERS_DOMAIN="bullmachine.com"

# Bootstrap values only. These are read once, when the SystemSetting row is first
# created. After that the Admin > Settings page is the source of truth, so these
# can be left out entirely if you prefer to configure everything in the UI.
PRODUCTION_API_URL="http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST"
MATERIAL_MASTER_API_URL="http://172.16.1.4:8006/sap/bc/zsap_data_api"
MATERIAL_MASTER_USERNAME="RFCDF"
MATERIAL_MASTER_PASSWORD="replace-with-the-upstream-password"
MATERIAL_MASTER_PLANT="1500"
```

**Note for XAMPP users:** If your MySQL password is empty (default XAMPP setting), use:
```env
DATABASE_URL="mysql://root:@localhost:3306/yard_management"
```

Generate Prisma client and run migrations:

```bash
npx prisma generate
npx prisma db push
```

For a new development database, set the `SEED_ADMIN_*` values in `.env` and run `npm run seed`. The seed clears existing operational sample data, so do not run it against data you need to retain.

To create one login for each role without touching yards, slots, machines, movements, or drivers, set `SEED_USERS_PASSWORD` (minimum 8 characters) and optionally `SEED_USERS_DOMAIN` (defaults to `example.com`), then run:

```bash
npm run seed:users
```

This creates `admin`, `yard.manager`, `operator`, `service.tech`, `security`, and `viewer` at your configured domain, all sharing `SEED_USERS_PASSWORD`. Unlike `npm run seed`, it only upserts users, so it is safe to re-run and will not clear operational data. Re-running updates the name, role, and active flag but leaves existing passwords unchanged, so change the shared password before using these accounts anywhere real.

To exercise the assembly-line stage history without plant data, run the demo seeder:

```bash
npm run demo:seed
```

This creates 18 machines flagged `isDemo` with serials like `DEMO-S001`, one per stage, each carrying a full 18-stage history so you can open the stage timeline on any row. It only ever touches rows where `isDemo = true`, and it is idempotent, so re-running refreshes the same rows instead of duplicating them. Real synced machines are never modified.

Remove the demo data with:

```bash
npm run demo:clear
```

Demo rows are hidden from the API unless `includeDemo=true` is passed, so production-facing calls keep returning only real machines. The Assembly Line screen shows demo data by default and offers a toggle to hide it, plus a `Demo` badge in the table and history modal. Do not confuse `npm run demo:clear` with `npm run seed`: the latter is destructive and clears all machines.

Start the backend server:

```bash
npm run dev
```

The backend will run on `http://localhost:5000`

#### Production order sync

The plant API only exposes one production date per call, and it repeats an order on every day it
is still moving through assembly. A sync therefore reads the last `productionSyncDays` days
(7 by default, ending today) and de-duplicates orders across the window before writing them, so a
machine is not counted or rewritten several times per run.

A day with no published orders returns `Production Order Not Available` and is recorded as an empty
day rather than a failure, so a quiet day does not raise a false alert. Network errors, timeouts,
and unexpected responses are treated as real failures and reported. Run a sync manually with:

```bash
curl -X POST http://localhost:5000/api/assembly/sync -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'
```

##### Stuck pre-stage-18 orders

A rolling window can only see orders the plant published *inside* that window. An order that
entered assembly weeks ago and has still not reached stage 18 drops out of the feed and would
otherwise stay frozen at its old stage forever.

After the window pass, the sync therefore looks for real machines that are still below stage 18
and whose `productionDate` is older than the window, then re-queries each one individually via
`GET-PRODUCTION-ORDER-TRX&hxTrxDt=<productionDate>&hsOrderNo=<orderNo>`. The order's own
`productionDate` is used as the search date because that is the day the plant first published it;
asking for today returns nothing for an order that started weeks ago.

Both the **Sync Now** button and the cron job call the same window function, so this pass runs
automatically on either path. The result reports the outcome, e.g.
`6/6 pre-stage-18 order(s) refreshed`, and lists any order the plant no longer returns under
`notFound`. The Assembly page shows the queried date range so a short result set can be
distinguished from a wrong window.

**The plant retains roughly five weeks of history.** Orders older than that cannot be recovered
by any date, so they are reported as not found rather than recreated as empty rows - a stub
machine would be indistinguishable from real data in the yard.

##### Plant response quirks

The plant serialises some fields inconsistently, and both shapes are handled at the boundary by
`toNullableString` and `getOrderTrxs` in `backend/src/services/productionApiService.ts`:

| Field | Shape when absent / single-row | Shape normally |
| --- | --- | --- |
| `barcode_val` | `[]` (empty array) | `"28052438"` |
| `production_order_trx` | bare object (one operation) | array of operations |
| `group_dsc` | `[]` | `"SKID"` |

Passing these through unchanged is what previously failed orders with
`Argument 'barcode': Invalid value provided. Expected String or Null, provided ()` and
`trxs is not iterable`. Every text column written to Prisma now passes through
`toNullableString` first.

##### Resetting the assembly data

Three maintenance scripts manage a destructive reset. Demo rows (`isDemo = true`) are never
touched, so the Assembly page keeps rendering while real data repopulates.

```bash
# 1. Record the stuck pre-stage-18 orders FIRST. Without this they are lost, because
#    the cleanup deletes the very rows the re-fetch looks for.
npm run sync:snapshot

# 2. Delete every real machine and its dependents. Dry run by default.
npm run sync:clear
npm run sync:clear -- --execute

# 3. Rebuild the snapshotted orders from the plant.
npm run sync:reinsert -- --dry-run
npm run sync:reinsert
# If the plant has rolled its history forward, retry with an explicit date:
npm run sync:reinsert -- --date 2026-09-29
```

`sync:clear` deletes in foreign-key-safe order inside one transaction. Only
`MachineStageHistory` declares `onDelete: Cascade`, so `SecurityVerification`, `GateLog` and
`Movement` are removed explicitly first; occupied slots are released to `AVAILABLE` before the
machines are removed, otherwise the yard would show occupied slots with nothing in them.

`backend/prisma/seed.ts` is a different and far more destructive script that wipes every table.
It is not part of this flow.

##### KMAT registration and model master backfill

Machines are matched to a KMAT by string, with no foreign key in between:

```
Machine.itemCode -> MaterialMaster.material -> MaterialMaster.confMaterial -> VehicleModelMaster.kmat
```

The last step used to fail silently. SAP sends only `MATERIAL`, `PLANT` and `CONF_MATERIAL`, so
`VehicleModelMaster` rows were never created automatically and every machine fell back to a crude
parser over the item description (`"BULL SKID AV 490 NAC STD BKT SAUDI"` becoming the model),
landing with `modelMasterId = null` and therefore no preferred-yard routing.

The material sync now registers the KMAT side of that join automatically.

```bash
# Sync registers every new CONF_MATERIAL as a VehicleModelMaster row.
# Runs automatically; this is only the manual trigger.
npm run material:sync
```

A `CONF_MATERIAL` value is skipped when it is blank, or when it is entirely digits — those are
material codes, not KMATs (`8000000`, `8000036`). Every real KMAT contains a letter, so the test
needs no hardcoded list.

Auto-created rows are **placeholders**: `model` is copied from the KMAT, `type` is set to
`UNCLASSIFIED` because no model or type exists upstream to copy, and `status` is set to `PENDING`
because the sync has no basis for approving a model. They are counted in the **Vehicle Model
Master** banner and can be isolated with the Pending filter until an administrator sets a real
`type` and a `preferredYardId` for each.

##### Model master review status

`VehicleModelMaster.status` is a review label with three values:

| Status | Meaning |
| --- | --- |
| `PENDING` | Added by the material sync, or hand-created and not yet confirmed. The column default, so a row is never presented as reviewed without somebody saying so. |
| `ACTIVE` | Checked by an administrator and in use. |
| `INACTIVE` | Retired, kept for history. |

Changing it happens only in the **Vehicle Model Master** screen, which is restricted to
`ADMIN` and `YARD_MANAGER`, the same roles that may edit the model and type. The field is a
**label only** — no routing or assignment decision reads it, so marking a row `INACTIVE` cannot
strand a machine or move it to a different yard. An unknown value is rejected with a 400.

A missing `preferredYardId` is tracked separately and is not cleared by setting a status. It is
the thing that actually routes: until a yard is set, machines on that model are placed in an
arbitrary yard.

The registration pass is **create-only**. It never reads an existing row for update, so re-running
the sync cannot revert a `model`, `type`, `modelType` or `status` edited in the UI. The trade-off
is that a deleted auto-created row comes back on the next sync.

A KMAT appearing for the first time does not retroactively update machines that were already
synced, since the plant will not necessarily republish a finished order. Re-link them from the
database, without needing the plant to be reachable:

```bash
npm run kmat:backfill                  # dry run, grouped by KMAT, lists unresolved items
npm run kmat:backfill -- --execute
npm run kmat:backfill -- --execute --all   # re-resolve every machine, not just unlinked ones
npm run kmat:backfill -- --include-demo    # also process demo machines
```

Unresolved machines are reported with a reason rather than being assigned a fabricated KMAT. In the
current data a single machine stays unlinked because its SAP `CONF_MATERIAL` is empty; that is a
master-data gap to fix in SAP, not a code problem.

#### Integration settings

The upstream endpoints, sync windows, and schedules live in a single `SystemSetting` database row
rather than in code or `.env`. An administrator edits them under **Admin > Settings**, which is
readable and writable by `ADMIN` only.

| Setting | Purpose | Default |
| --- | --- | --- |
| `productionApiUrl` | Plant production order upstream | `http://192.168.1.103/...PRODUCTION_API/REST` |
| `productionSyncDays` | Rolling sync window, 1–31 days ending today | 7 |
| `productionCron` | Production sync schedule | `30 6 * * *` (daily 06:30) |
| `productionTimeoutMs` | Production request timeout | 30000 |
| `materialApiUrl` | SAP material master upstream | `http://172.16.1.4:8006/sap/bc/zsap_data_api` |
| `materialUsername` / `materialPassword` | SAP credentials | from `.env` on first run |
| `materialPlant` | SAP plant code | `1500` |
| `materialSyncDays` | Material sync window | 7 |
| `materialCron` | Material sync schedule | `0 6 * * *` (daily 06:00) |
| `materialTimeoutMs` | Material request timeout | 30000 |

Behaviour worth knowing:

- The row self-creates from the `.env` bootstrap values on first boot, so a fresh database needs no
  manual migration step. After that, the database wins and the UI is the only thing to change.
- Saving **re-registers both cron jobs immediately**, so a new schedule takes effect without
  restarting the backend.
- The SAP password is write-only. It is never returned by the API, the UI shows only whether one is
  stored, and leaving the field blank on save keeps the existing value.
- A save is all-or-nothing: if any field fails validation, nothing is written.
- **Test Connection** on each card performs a read-only reachability probe against the saved
  configuration and never writes to the database. The plant hosts are only reachable from the office
  LAN, so a probe will fail from guest Wi-Fi even when the configuration is correct.

#### Notifications

Seven operational events raise an alert, stored per recipient and pushed live over a WebSocket at
`/ws`. The mapping lives in `NOTIFICATION_RECIPIENTS` in
`backend/src/services/notificationService.ts`.

| Event | Severity | Raised when | Notified roles | Opens |
| --- | --- | --- | --- | --- |
| `YARD_FULL` | CRITICAL | Stage 13 auto-assignment finds no free slot in the preferred yard **and** none in any yard | Yard Manager, Administrator | Yards |
| `SYNC_FAILED` | CRITICAL | A production or material master sync returns an error, or throws, whether it ran on the schedule or was triggered manually | Administrator | Assembly / Materials |
| `GATE_REJECTED` | CRITICAL | A gate check fails: driver not found, machine not found, barcode does not match the selected machine, machine is below stage 18, machine has no barcode, no assigned slot, or the assigned slot is no longer reserved | Security, Yard Manager | Gate |
| `BARCODE_MISSING` | CRITICAL | A machine reaches stage 18 or later with an empty barcode, so it cannot be released to the yard | Yard Manager, Administrator | Assembly |
| `NEW_REGISTRATION` | INFO | Someone self-registers; the account is created active with View Only access | Administrator | Users |
| `READY_TO_MOVE` | INFO | A sync sees a machine at stage 18 or later that is still `PLANNED` **and** has a barcode, and flags it `READY_TO_MOVE`. Fires once per transition, not on every later sync | Yard Manager | Assembly |
| `SECURITY_REVIEW` | WARNING | A machine is parked into a slot, which flags it `PARKED_PENDING` and adds it to the Security queue | Security | Security |

##### How delivery works

- Recipients are matched **by role, not by named person**. Every active user holding a recipient
  role gets their own stored alert, so a newly created Yard Manager starts receiving yard alerts
  with no further configuration.
- The same event repeats at most once per 15 minutes per user per event type, so a frequent schedule
  cannot flood the bell with identical alerts.
- Read alerts are deleted after 30 days. Unread alerts are never pruned.
- `CRITICAL` alerts also appear as an on-screen toast. Every severity appears in the top-bar bell
  and on the Notifications page.
- Alerts arrive by WebSocket push rather than polling, but the full history is re-fetched each time
  the socket connects, so anything missed while offline shows up on reconnect.
- A `SYNC_FAILED` message carries only the first error from the run, not the whole list. The
  Assembly Line and Material Master screens report the number of errors and the first one, so the
  remaining detail has to come from the backend logs or the full `errors` array in the sync result
  returned by `/api/assembly/sync/status`.
- The WebSocket authenticates with the same JWT as the REST API and is rejected during the
  handshake if the token is missing, invalid, or belongs to a deactivated account.

##### Note on the gate

An **authorized** gate entry sets the machine to `IN_TRANSIT` and raises no alert. Security is
alerted only when a gate check is rejected, and separately when the machine is actually parked into
a slot. The two are different moments in the flow, so a Security user sees the rejection alert at
the gate and the review alert at the yard, but nothing in between.

### 3. Frontend Setup

Navigate to the project root and install frontend dependencies:

```bash
cd ..
npm install
```

Start the frontend development server:

```bash
npm run dev
```

The frontend will run on `http://localhost:3000/fg-yard`

## Running the Project

To run both frontend and backend simultaneously:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

Then open [http://localhost:3000/fg-yard](http://localhost:3000/fg-yard) in your browser.

## Maintenance Scripts

Operational scripts for the backend. They live in `backend` and are safe to re-run unless noted.
The setup section above covers the seed, demo, snapshot and KMAT scripts.

| Script | What it does |
| --- | --- |
| `npm run verify:slots` | Offline regression test for slot reservation, release and FIFO reallocation. Creates its own yard and machines, exercises the real service functions against the real database, then deletes everything it created. It parks and restores the `slotWaitingSince` stamp of machines genuinely waiting for a slot, so queue order stays deterministic, and never touches their slots, park status, or drivers |
| `npm run reconcile:ready-move` | Demotes `READY_TO_MOVE` machines with an empty barcode back to `PLANNED`, so the barcode gate rule holds for rows that predate it. Applies immediately and is a no-op when there is nothing to fix |
| `npm run slots:backfill` | Backfills `Slot.reservedAt` and `Machine.slotWaitingSince` for rows that predate those columns. Dry run unless you pass `--execute`. Reserved slots are backfilled exactly; waiting machines use `createdAt`, which is a lower bound but better than `NULL`, which would make the queue order arbitrary |
| `npm run users:system` | Ensures the inactive **System** service account exists. Automatic movements (stage-13 assignment, reservation release) write `userId: 'system'`, and because `Movement.user` is a required foreign key, every one of those writes threw and lost its audit trail until this account existed. The account can never be signed into and collects no notifications |

## Tests

Run in `backend`. GitHub Actions runs both on every push and pull request
(`.github/workflows/ci.yml`), together with the frontend type check and build.

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | Unit tests: role access defaults and the driver lock, the two-person rule, Excel stock-load parsing (slot labels, dates, duplicates), backup file names and retention | Nothing |
| `npm run test:api` | The real API against a test database: access (401 / 403), yard creation, gate in (refusals and admit), parking confirm and the two-person verify, dispatch plan and FIFO stock, gate out, PDI hold / pass and main gate-out, bulk stock load, feedback | `TEST_DATABASE_URL` in `backend/.env`, a database whose name ends in `_test`; it is recreated on every run |

Add a test with every change to the flows above. Tests are in `backend/tests` and compile to
`backend/dist-test` (not committed).

## Project Structure

```
yard-management-system/
├── backend/                 # Express.js backend
│   ├── src/
│   │   ├── controllers/    # Request handlers
│   │   ├── routes/         # API routes
│   │   ├── middleware/     # Auth & validation
│   │   └── index.ts        # Server entry point
│   ├── prisma/
│   │   └── schema.prisma   # Database schema
│   └── package.json
├── src/                    # Next.js frontend
│   ├── app/               # App router pages
│   ├── components/        # React components
│   └── lib/               # Utilities
└── package.json
```

## Features

- **Yard Management**: Create and manage multiple yard locations with slot grids
- **Machine Tracking**: Track backhoe loaders by serial number, model, and status
- **Slot Allocation**: Auto-suggest available slots, prevent double allocation
- **Waiting Queue**: A stage-13 machine with no free slot joins a queue, and a released reservation is handed straight to the longest-waiting machine
- **Barcode-gated Release**: A machine is only released to the yard once it is at stage 18 **and** has a barcode; a missing barcode raises a critical alert instead of a silent failure
- **Scan-first Gate Control**: Scan a barcode and the machine, stage, status and slot are detected and selected automatically, with a manual fallback
- **Movement History**: Complete audit trail of all machine movements
- **Audit History**: Movements, parking and security decisions in one place, with server-side paging and the recorder attributed to a driver or the yard office
- **Dashboard**: Real-time statistics and alerts
- **Search**: Instant search by machine ID, serial number, or model
- **User Roles**: Admin, Yard Manager, Operator, Service Technician, Security, View Only, Driver, Planner, PDI, Main Gate
- **Role Access**: an Admin ticks which role may open each page and use each action; the server enforces it and every change is logged. Users / Settings / Role Access stay Admin-only
- **Yard Stock (FIFO)**: free stock per model-type, oldest first, with real inward dates and return hold
- **Dispatch Planning**: plans by model-type and quantity with an optional SO number; the oldest free machines are picked
- **PDI and main gate**: FG gate-out, PDI Pass / Hold, main gate-out only after a PDI pass; overdue e-mail alert
- **Initial stock load**: an Admin switch for placing machines that were parked before go-live; otherwise machines enter only through Gate Control
- **Block / Unblock slots** with a reason
- **SOP page**: the Quality SOP, its PDF and printable role checklists
- **Feedback**: any user sends a suggestion or issue from the top bar; Admins review, set a status and reply
- **Login History**: sign-ins, failures and sign-outs with IP and device (Admin-only, kept 90 days); 5 failed sign-ins in 15 minutes alert the Admins
- **Stage History**: Per-machine timeline of all 18 assembly stages, sourced from the plant system or recorded manually
- **Driver Parking Confirmation**: The driver confirms a machine is physically in its slot, which creates the security queue entry
- **Security Verification**: Guards approve or reject a parked machine, and the driver is notified of the outcome

## Parking Lifecycle

A machine moves through six parking states. Each transition is a separate, audited step.

| State | Meaning | Who sets it |
| --- | --- | --- |
| `PLANNED` | Not yet released for movement | Assembly |
| `READY_TO_MOVE` | Released and assigned a driver and slot | `POST /api/machines/:id/assign-driver` |
| `IN_TRANSIT` | Checked in at the gate; driver has taken custody | `POST /api/gate/authenticate` |
| `PARKED_PENDING` | Driver says it is in the slot; security must check | `POST /api/machines/:id/parked` |
| `PARKED_REJECTED` | Security rejected it; driver must re-park the same slot and confirm again | `POST /api/machines/:id/verify-parking` |
| `PARKED_VERIFIED` | Security confirmed the parking | `POST /api/machines/:id/verify-parking` |

Notes on the rules:

- Only the **assigned driver** may confirm a machine parked. An `ADMIN`, `YARD_MANAGER`, or `OPERATOR` may do it on the driver's behalf, and that override is recorded in the movement notes.
- A rejected machine is re-parked in the **same slot**, so `currentSlotId` never changes across a rejection.
- Security can only verify a machine that is `PARKED_PENDING` or `PARKED_REJECTED`; an in-transit machine has nothing to verify.
- Verifying parking only changes `parkStatus`. The commercial `status` (`SOLD`, `RESERVED`, ...) is never touched, so approving a parked machine cannot un-sell it.
- `verify-parking` records the guard from their authenticated token, so the audit trail names a real user.

## Editing Yards and Slots

Yards are edited from the pencil button on a yard card in Yard Management. The same form
creates and edits; the title and subtitle say which one is open.

### Growing a yard

`PUT /api/yards/:id` accepts the same fields as create, plus new `rows`/`cols`. Two rules:

- **Grow only.** Increasing `rows` and/or `cols` inserts the missing slots in the same
  transaction that writes the new dimensions, and the response reports how many were
  created. Because the insert and the metadata write are atomic, a yard can never end up
  with `rows × cols` promising slots that do not exist.
- **Never smaller.** A request with `rows` or `cols` below the current value is rejected
  with a `400`. Deleting slots to shrink the grid is not supported, because slots are not
  free-standing rows: `Machine.currentSlotId`, `Machine.plannedSlotId`,
  `Movement.fromSlotId` and `Movement.toSlotId` are all nullable with no `onDelete`, so a
  deleting shrink would silently un-park a machine, orphan a live reservation, or strip
  the slot reference out of movement history. Only `SecurityVerification.slotId` is
  mandatory, so MySQL itself would refuse that one case and quietly accept the rest.

Bounds: each dimension must be a whole number of at least 1 and at most 100, and
`rows × cols` may not exceed 2000 slots.

`latitude`, `longitude` and `address` are now actually persisted. A coordinate of exactly
`0` is stored as `null`, because the form previously started at `0` and saving untouched
would have written `0,0` (Null Island) into every yard. Out-of-range values are rejected
rather than clamped.

### Blocking a slot

Slots are never deleted. `POST /api/yards/slots/:id/block` takes a free slot out of use with a
`reason` (Ground damage, Waterlogging, Maintenance work, Used for other purpose, or Other with a
`note`); who, when and why are stored on the slot and the yard managers are notified.
`POST /api/yards/slots/:id/unblock` puts it back. An occupied or reserved slot cannot be blocked.
Allocation only ever selects `AVAILABLE`, so a blocked slot is never assigned.

Slots deleted by the old Remove slot option show as a dashed placeholder; editing that yard
re-creates them as free slots, which should then be blocked if they are not to be used.

### How the grid stays aligned

The grid is rendered as a fixed `rows × cols` matrix built from a position lookup, not by
mapping over the slots that exist. A missing slot renders an explicit dashed cell. Card
totals use the real `totalSlots` count returned by the API rather than `rows × cols`, for
the same reason: after removals the two numbers legitimately differ.

`getAllYards` returns `totalSlots` and a per-status `slotCounts`; `getYardById` adds a
`_count` per slot (`movementsFrom`, `movementsTo`, `securityVerifications`) so the removal
dialog can tell the user which of the outcomes above will happen before they commit.

## Barcode Gate Rule

Reaching stage 18 is not on its own enough to release a machine to the yard. A machine needs
**both** `assemblyStage >= 18` **and** a non-empty `barcode` before it can become `READY_TO_MOVE`.

| Situation | What happens |
| --- | --- |
| Stage 18+ with a barcode | Sync flags it `READY_TO_MOVE` and notifies Yard Managers |
| Stage 18+ with an empty barcode | Stays `PLANNED`, raises a CRITICAL `BARCODE_MISSING` to Yard Managers and Administrators |
| Already `READY_TO_MOVE`, barcode later cleared by a sync | Demoted back to `PLANNED`, so it is no longer offered at the gate |
| `IN_TRANSIT` or parked, barcode cleared | **Never** demoted, because that would strand a machine that has already left the assembly line |
| Barcode supplied by a later sync | The machine becomes `READY_TO_MOVE` on that run. The rule self-heals, so a fixed barcode needs no manual step |

Why the extra rule exists: the gate authenticates against the barcode, so a barcode-less machine
cannot be checked in at all. Releasing it to `READY_TO_MOVE` would put it in the yard with no way
out. The gate refuses a barcode-less machine independently, with
`Machine has no barcode. Cannot be checked in at the gate.`

The production sync enforces this on every run, so the state cannot drift. To repair rows that
predate the rule, run the standalone reconciler. It reports what it found and demotes it
immediately, so read the output first:

```bash
cd backend
npm run reconcile:ready-move
```

It only touches the ready phase, and it is a no-op when every ready machine has a barcode.

## Gate Control Screen

The gate is a scan-first screen. Two fields take focus in order: the driver badge, then the
machine barcode. A scan is all the operator normally needs:

1. **Scan or type the driver's employee-code badge.** After 400ms of no typing, the badge is
   matched against the driver roster (exact, case-insensitive) and the detection strip shows the
   driver's photo, name, and code.
2. **Scan or type the machine barcode.** After 400ms of no typing, the machine is matched on an
   exact, case-insensitive barcode comparison and selected automatically. The detection strip
   shows the serial, assembly stage, park status, and slot.
3. **Read the slot before you accept.** The slot shown is the machine's `plannedSlot` when it has
   one, otherwise its `currentSlot`, with the yard name. A machine with no slot shows
   `No slot assigned` in amber, and the gate will reject it.
4. **Authenticate.** Authentication is only offered once both the driver and the machine are
   resolved. A rejected check explains itself: driver badge unknown, badge does not match, or
   barcode/machine mismatch, below stage 18, no barcode, no assigned slot, or the reserved slot
   is gone.
5. **Fallback.** If the machine barcode is unreadable, expand **or select machine manually** and
   pick from the list of ready machines. The driver must still be identified by badge.

After a successful check the machine is `IN_TRANSIT` and a result card offers **Close barrier**.
`GET /api/gate/logs` returns the recent attempts. If the same machine is authenticated again while
its earlier barrier is still open, the dangling barrier is closed first, so a wrong-driver scan
cannot leave the barrier up.

## Driver Accounts

A `Driver` record carries a name, a phone, a license number, an **employee code** (the badge the
gate scans; unique, so a badge always names one driver) and an optional **photo** that the gate
screen and the drivers list display. Photos are converted in the browser to a 400×400 JPEG before
upload, capped at 1 MB on the server, and stored under `backend/uploads/drivers/`. To let a
driver confirm parking and receive notifications, link it to a login:

1. Sign in as `ADMIN`.
2. Open **Drivers**, find the driver, and press the key icon.
3. Create a login. The account is always created with the `DRIVER` role and can only see
   **Confirm Parking** and the dashboard.

Removing the login deactivates the user rather than deleting it, so past verifications and
notifications keep their author.

## History and Audit Views

The History screen has three tabs, each backed by a filtered, server-paginated endpoint rather
than a client-side slice, so the result stays correct as the movement table grows.

| Tab | Shows | Backed by |
| --- | --- | --- |
| **Movements** | Every recorded movement: allocations, removals, gate entries, parking confirmations, and security decisions | `GET /api/movements` |
| **Parking** | The same records narrowed to yard entries (`YARD_ENTRY`), badged as such, so it reads as a parking log rather than a movement log | `GET /api/movements?reason=YARD_ENTRY` |
| **Verifications** | Every security decision, approved or rejected, with the guard, the slot, and their comments | `GET /api/security/verifications` |

Rows show 15 at a time with server-side paging, and can be narrowed by machine and by date range.

**Recorder attribution.** Every movement names who recorded it, taken from the authenticated
session rather than from the form. Rows are tagged **Driver** when the author is the machine's
linked driver account, and **Yard office** when a member of staff recorded it, so a parking log
shows who was actually at the slot.

Two inline panels surface the same data where it is needed:

- **Recent Verifications** (last 8) sits under the Security queue, and refreshes when a new
  machine enters the queue.
- **Recent Parking Activity** (last 8) sits on **Confirm Parking** for staff, so you can see the
  latest slot activity without leaving the screen. It is hidden from the `DRIVER` role, because a
  driver has no reason to see other drivers' activity.

**Per machine.** The history modal in Machine Tracking has four tabs: **Stages**, **Movements**,
**Parking**, and **Security**. Stages come from the plant or the manual stage edits, Movements and
Parking come from the movements already loaded for that machine, and Security is fetched for that
one machine.

| View | Roles that can see it |
| --- | --- |
| Movements, Parking | Admin, Yard Manager, Operator, Security |
| Verifications, and the machine Security tab | Admin, Yard Manager, Security |
| Recent Parking Activity | Everyone with Confirm Parking except Driver |

Both new endpoints require a valid token and are role-gated server-side, so hiding a tab in the
UI is a convenience and not the enforcement point.

## API Endpoints

- `GET /api/auth/options` - Public: whether Create account is on
- `POST /api/auth/register` - Register new user (refused unless Settings › Accounts allows it)
- `POST /api/auth/forgot-password` - E-mail a 6-digit reset code (`email`); same answer whether or not the account exists
- `POST /api/auth/reset-password` - Set a new password with the code (`email`, `code`, `password`); ends the account's other sign-ins
- `POST /api/auth/login` - User login
- `GET /api/yards` - List all yards, each with `totalSlots` and per-status `slotCounts`
- `POST /api/yards` - Create new yard and its slots
- `GET /api/yards/availability` - Allocation summary across all yards
- `GET /api/yards/:id` - One yard with every slot, its machine, its reservation, and per-slot history counts
- `PUT /api/yards/:id` - Edit a yard; grows `rows`/`cols` and creates the missing slots, never shrinks
- `POST /api/yards/slots/:id/block` / `unblock` - Take a free slot out of use with a reason, or put it back
- `POST /api/yards/slots/:id/release` - Release a reservation and re-allocate if a machine is waiting (Admin, Yard Manager)
- `POST /api/machines` - Add new machine
- `GET /api/machines` - List all machines
- `POST /api/machines/:id/allocate` - Allocate machine to slot
- `POST /api/machines/bulk-allocate` - Initial stock load from a file the page has read: `rows` of `{ serial, yard, slot, inwardDate?, remark? }`; checks only, or places the rows that pass with `commit: true` (Admin, Yard Manager; Initial stock load must be on)
- `POST /api/machines/:id/parked` - Driver confirms the machine is physically parked (assigned driver or admin)
- `POST /api/machines/:id/verify-parking` - Security approves or rejects a parked machine; with the two-person rule on, the person who parked it cannot approve it
- `GET /api/drivers` - List drivers
- `POST /api/drivers` - Create a driver (Admin, Yard Manager)
- `PUT /api/drivers/:id` - Edit a driver (Admin, Yard Manager)
- `DELETE /api/drivers/:id` - Delete a driver; removes its photo (Admin)
- `POST /api/drivers/:id/photo` - Upload or replace a driver photo (multipart `photo` field, 1 MB cap; Admin, Yard Manager)
- `DELETE /api/drivers/:id/photo` - Remove a driver photo (Admin, Yard Manager)
- `POST /api/drivers/:id/account` - Create a DRIVER login for a driver (admin only)
- `DELETE /api/drivers/:id/account` - Deactivate and unlink a driver's login (admin only)
- `GET /api/machines?parkStatus=PARKED_PENDING,PARKED_REJECTED` - Security verification queue
- `GET /api/machines?mine=true` - Machines assigned to the signed-in driver
- `GET /api/assembly/stage-stats` - Per-stage counts for the assembly page
- `GET /api/machines/:id/history` - Get stage history for one machine (requires a token; this is the 18-stage timeline, not the movement log)
- `GET /api/movements` - Filtered, paginated movement log (Admin, Yard Manager, Operator, Security). Accepts `reason`, `machineId`, `from`, `to`, `page`, `pageSize`
- `GET /api/security/verifications` - Filtered, paginated security decision log (Admin, Yard Manager, Security). Accepts `status`, `machineId`, `from`, `to`, `page`, `pageSize`
- `POST /api/gate/authenticate` - Verify a driver (by their employee-code `driverBarcode`, or `driverId`) and a machine at the gate, and open the barrier
- `POST /api/gate/barrier/close` - Close the barrier after an entry (Admin, Yard Manager, Operator)
- `GET /api/gate/logs` - Recent gate attempts (Admin, Yard Manager, Security)
- `GET /api/dispatch-plans` - Paged plans (`view`, `q`, `from`, `to`, `page`, `pageSize`); `POST` creates a plan (`lines`, optional `soNumber`)
- `GET /api/dispatch-plans/items` - Dispatch machine list; `POST .../items/:id/pdi` records PDI Pass / Hold; `POST .../items/:id/main-gate-out` marks main gate-out (refused until PDI passed)
- `GET /api/settings/stock-load` - Whether Initial stock load and the parking two-person rule are on
- `GET /api/backups` - Backup folder, schedule, last result and files; `POST /api/backups/run` - back up now (Admin)
- `GET /api/role-access/me` - The signed-in user's permissions; `GET/PUT /api/role-access` and `POST /api/role-access/reset` manage the matrix (Admin)
- `POST /api/feedback` - Send feedback (`type`, `message`, `page`; JSON, or multipart with an optional `screenshot` image up to 2 MB); `GET /api/feedback/:id/screenshot` - the screenshot (sender or Admin); `GET /api/feedback/mine` - own feedback; `GET /api/feedback` and `PUT /api/feedback/:id` - review (Admin)
- `POST /api/auth/logout` - Record a sign-out; `GET /api/login-history` - Login history with `result`, `q`, `from`, `to`, paging (Admin)

Role names next to endpoints are the **default** access. Apart from Users, Settings and Role
Access (Admin only), an Admin can change who may call each endpoint on the Role Access page.

## Development Status

The system is in use for the full flow: production sync, gate control, parking confirmation,
security verification, FIFO yard stock, dispatch planning, the PDI check, main gate-out and the
audit history. Recent changes are listed in `CHANGELOG.md`. The open work is listed under Future Features below; the design documents in the
repository root (`PROJECT_PLAN.md`, `PROJECT_DOCUMENTATION.md`, `YARD_MANAGEMENT_CONCEPT.md`) are
a point-in-time package from the build phase and are not kept current.

## Future Features

Two items from the original roadmap are genuinely still open. The other entries that used to sit
here have since shipped.

- **Boom barrier hardware**: the gate already records barrier open and close, offers an operator
  close after an entry, and closes a dangling barrier when the same machine is re-authenticated,
  but no physical barrier is driven. There is also no separate entry and exit gate. Customer
  dispatch now has its own flow (Dispatch Planning, FG gate-out, PDI, main gate-out).
- **Simplified slot status**: slots still carry seven statuses (`AVAILABLE`, `OCCUPIED`,
  `RESERVED`, `MAINTENANCE`, `DISPATCH_READY`, `BLOCKED`, `INSPECTION`). Collapsing this to
  Available and Occupied would need the reservation and maintenance workflows to be reworked
  first.
