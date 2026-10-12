# Yard Management System — Full Project Documentation

**Version:** 0.2.0 (Assembly-to-Yard Integration) | **Status:** In Development

---

## 1. Executive Summary

The **Yard Management System (YMS)** is a full-stack web application that digitizes the complete lifecycle of backhoe loader machines — from **assembly line stage 1 to final parking in the Finished Goods (FG) yard** — for a manufacturing facility. It replaces manual paper-based tracking with a real-time digital system that tracks every machine's assembly stage, yard location point, driver assignment, gate entry (with biometric authorization and boom barrier control), and security-verified final parking.

The system integrates three worlds:
1. **Assembly/Production** — machine identity (serial number, barcode) via a pluggable Digital Factory API
2. **Logistics** — driver assignment and handoff at the final assembly stage
3. **FG Yard Security** — biometric gate authorization, boom barrier control, and security verification with a color-coded status system (YELLOW/RED → GREEN)

---

## 2. Project Objectives (Detailed)

### O1. Digitize Assembly-to-Yard Machine Flow
Provide a single digital system that tracks each machine from serial-number assignment (Stage 1) through barcode pasting (Stage 13), final quality check (Stage 18), and physical parking in the FG yard. No manual registers, no paper handoffs.

### O2. Automatic Yard Location Assignment (Stage 13)
When a machine reaches assembly stage 13 and its barcode is pasted, the system automatically assigns a yard parking point — driven by **FERT category priority rules** (admin-defined mapping: *which FERT parks in which yard/zone*). This ensures predictable, priority-based yard utilization.

### O3. Driver Assignment & Handoff (Stage 18)
At the final assembly stage (18), after quality checks pass, the system assigns driver details to the machine. The driver becomes the custodian for transporting the machine to the FG yard.

### O4. Secure Gate Authorization (Biometric + Barcode)
At the FG yard gate, the system verifies the driver using **fingerprint or face authentication** via a biometric kiosk device, and validates the machine by **barcode scan**, before authorizing entry. Only authorized vehicles trigger the boom barrier to open. Every gate event is fully audited.

### O5. Security-Verified Final Parking (Color Status)
After the driver parks, the machine status is **YELLOW (pending)** — a security guard physically verifies the machine's position and parking correctness. On approval the status becomes **GREEN**; on failure it becomes **RED** (re-park required). This closes the loop between digital records and physical reality.

### O6. Complete Audit Trail
Every movement, stage transition, gate authorization, and security decision is logged with timestamp, reason, and responsible user — supporting traceability and dispute resolution.

### O7. Role-Based Access Control
Six roles control what each user sees and does: **Admin, Yard Manager, Operator, Service Technician, Security, View-Only**.

---

## 3. Business Process Flow

### 3.1 Assembly Line (Stages 1–18)

```
Stage 1          Stage 13                       Stage 18 (FINAL)
┌──────────┐     ┌──────────────────────┐      ┌────────────────────────┐
│ Serial no│ ──▶ │ Barcode pasted        │ ───▶ │ Quality check complete │
│ assigned │     │ DF API: serial+code   │      │ Assign driver details  │
└──────────┘     │ Auto-assign yard point│      │ Machine → READY_TO_MOVE│
                 │ (FERT priority)       │      └────────────────────────┘
                 └──────────────────────┘
```

### 3.2 FG Yard Gate & Parking

```
Driver + Machine arrive at gate
        │
        ▼
Biometric auth (FINGERPRINT / FACE) ──✗──▶ REJECTED (logged, barrier stays closed)
        │ ✓
        ▼
Barcode scan on machine ──✗──▶ REJECTED (not matching assignment)
        │ ✓
        ▼
AUTHORIZED → Boom barrier OPENS → machine enters → barrier CLOSES
        │
        ▼
Driver parks at assigned slot → exits yard
        │
        ▼
Machine status = YELLOW (PARKED_PENDING — awaiting security check)
        │
        ▼
Security verifies position & parking
        ├── ✓ Correct   → GREEN (PARKED_VERIFIED)
        └── ✗ Incorrect → RED (PARKED_REJECTED → driver re-parks)
```

---

## 4. System Architecture

```
┌──────────────────────────── Next.js 16 Frontend (localhost:3000) ────────────────────────────┐
│  Dashboard │ Yards │ Machines │ Assembly Line │ Drivers │ Gate Control │ Security │ History  │
└──────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                               │ REST / JSON (JWT Bearer)
┌──────────────────────────────────────────────▼───────────────────────────────────────────────┐
│                           Express.js + TypeScript Backend (localhost:5000)                    │
│  routes → controllers → services (business logic) → prisma ORM                                │
│                                                                                               │
│  Integration Layers (adapter pattern):                                                        │
│   • IDigitalFactoryProvider  → MockProvider (dev) / RealProvider (TODO: credentials)          │
│   • IBiometricDriver         → MockDriver (dev) / RealDriver (TODO: device SDK/protocol)      │
│   • IBoomBarrierDriver       → MockDriver (dev) / RealDriver (TODO: hardware protocol)        │
└──────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                               │ Prisma
                               ┌───────────────▼───────────────┐
                               │        MySQL (XAMPP)          │
                               │      yard_management DB       │
                               └───────────────────────────────┘
```

**Tech Stack:** Next.js 16 + React 19 + TypeScript + TailwindCSS 4 | Express 5 + Prisma ORM | MySQL | JWT auth + bcrypt

---

## 5. Data Model

### 5.1 Enums
| Enum | Values |
|---|---|
| `UserRole` | `ADMIN, YARD_MANAGER, OPERATOR, SERVICE_TECHNICIAN, SECURITY, VIEW_ONLY` |
| `MachineStatus` | `AVAILABLE, SOLD, RESERVED, UNDER_INSPECTION, IN_REPAIR, DISPATCHED` |
| `SlotStatus` | `AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE, DISPATCH_READY, BLOCKED, INSPECTION` |
| `MovementReason` | `PRODUCTION, INSPECTION, REPAIR, DISPATCH, RELOCATION, MAINTENANCE, YARD_ENTRY` |
| `ParkStatus` | `PLANNED → READY_TO_MOVE → IN_TRANSIT → AT_GATE → PARKED_PENDING (YELLOW) → PARKED_REJECTED (RED) → PARKED_VERIFIED (GREEN)` |
| `AuthMethod` | `FINGERPRINT, FACE` |
| `GateResult` | `AUTHORIZED, REJECTED` |

### 5.2 Entities
| Model | Key Fields | Purpose |
|---|---|---|
| `User` | name, email, password (hashed), role | Authentication & RBAC |
| `Yard` | name, description, rows, cols, latitude, longitude, address | Physical yards with grid layout |
| `Slot` | yardId, row, col, zone, status | Grid cell (row,col); unique per yard |
| `Machine` | serialNumber (unique), **barcode (unique)**, model, productionDate, status, **assemblyStage (1–18)**, **fertCategoryId**, **driverId**, **plannedSlotId**, **parkStatus**, currentSlotId, qrCode | Backhoe loader lifecycle tracking |
| `FertCategory` | code, name, priority, preferredYardId | FERT → yard priority mapping |
| `Driver` | name, phone, licenseNo, **biometricId**, status (AVAILABLE/ON_TRIP) | Yard transport drivers |
| `Movement` | machineId, yardId, fromSlotId, toSlotId, userId, reason, notes, timestamp | Immutable audit trail |
| `GateLog` | machineId, driverId, authMethod, barcode, result, barrierOpenedAt, barrierClosedAt, userId | Gate authorization audit |
| `SecurityVerification` | machineId, slotId, securityUserId, status (APPROVED/REJECTED), comments, verifiedAt | Parking verification record |

### 5.3 Key Relationships
```
User 1─∞ Movement
Yard 1─∞ Slot 1─0..1 Machine (currentSlot)
FertCategory 1─∞ Machine; Yard 1─∞ Machine (preferredYard)
Driver 1─∞ Machine (assigned driver)
Machine 1─0..1 Slot (plannedSlot — reserved at stage 13)
Machine 1─∞ Movement | GateLog | SecurityVerification
```

---

## 6. Backend API Reference

### Auth
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register (role fixed server-side for security) |
| POST | `/api/auth/login` | Public | Login → JWT |
| GET | `/api/auth/me` | Auth | Current user profile |

### Yards
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/yards` | List / create yard (auto-generates row×col slots) |
| GET/PUT/DELETE | `/api/yards/:id` | Detail (slots+machines) / update / delete |

### Machines
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/machines?search=&status=&stage=&parkStatus=` | List with filters |
| GET/POST/PUT/DELETE | `/api/machines/:id` | Detail (slot, movements) / create / update / delete |
| POST | `/api/machines/:id/advance-stage` | Advance assembly stage; **13:** DF sync + auto location; **18:** READY_TO_MOVE |
| POST | `/api/machines/:id/assign-location` | Manual yard point assignment (FERT-based auto-suggest) |
| POST | `/api/machines/:id/assign-driver` | Stage-18 driver handoff |
| POST | `/api/machines/:id/allocate` | Allocate machine to slot (existing) |
| POST | `/api/machines/:id/remove-from-slot` | Remove/dispatch from slot (existing) |
| GET | `/api/machines/:id/history` | Movement history |
| POST | `/api/machines/:id/verify-parking` | **SECURITY** — approve (GREEN) / reject (RED) |

### FERT Categories & Drivers
| Method | Endpoint | Description |
|---|---|---|
| CRUD | `/api/fert-categories` | Priority → yard mapping management (ADMIN) |
| CRUD | `/api/drivers` | Driver management + biometric enrollment |

### Gate Control
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/gate/authenticate` | Biometric verify → barcode scan → authorize + open barrier |
| POST | `/api/gate/barrier/open` / `/close` | Manual barrier control |
| GET | `/api/gate/logs` | Gate audit log |

### Misc
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/dashboard/stats` | Live counts (occupancy, in-transit, at-gate, pending verification) |

---

## 7. Frontend Structure

```
src/
├── app/
│   ├── page.tsx            # Main shell: role-gated tab navigation
│   ├── login/  register/   # Auth pages
│   └── layout.tsx
├── components/
│   ├── Dashboard.tsx            # Live stats & alerts
│   ├── YardManagement.tsx       # Yard grid map (RESERVED/OCCUPIED + color-coded machines)
│   ├── MachineTracking.tsx      # Machine list, search, stage, park status
│   ├── AssemblyLine.tsx         # NEW: stage stepper 1–18, auto location at 13, driver at 18
│   ├── Drivers.tsx              # NEW: driver CRUD + biometric enroll
│   ├── GateControl.tsx          # NEW: kiosk screen — auth + scan + barrier + logs
│   ├── SecurityVerification.tsx # NEW: YELLOW/RED list → approve/reject
│   └── MovementHistory.tsx      # Audit trail viewer
├── contexts/AuthContext.tsx     # JWT session, user role
└── lib/                         # API client, utilities
```

**Status color coding:** YELLOW `PARKED_PENDING`, RED `PARKED_REJECTED`, GREEN `PARKED_VERIFIED` — applied to machine pills on the yard map and lists.

**Role-based navigation:**
| Role | Tabs visible |
|---|---|
| ADMIN | All |
| YARD_MANAGER | All (except security actions) |
| OPERATOR | Assembly, Machines, Yards, History |
| SERVICE_TECHNICIAN | Machines, Yards, History |
| SECURITY | Gate Control, Security Verification, History |
| VIEW_ONLY | Dashboard, Yards, Machines |

---

## 8. Integration Layers (Hardware & External Systems)

All external systems are accessed through **interfaces (adapter pattern)** so development can proceed with mock drivers:

| Interface | Mock (now) | Real (needs input) |
|---|---|---|
| `ProductionApiService` | Fetches from production API (http://192.168.1.102/bdf/apps/bafrestapi.php/PRODUCTION_API/REST) | Already integrated |
| `IBiometricDriver` | Simulated fingerprint/face pass | Real device — need model + SDK/protocol (HTTP/TCP/USB/serial) |
| `IBoomBarrierDriver` | Simulated open/close state | Real controller — need protocol (relay/PLC/IoT/MQTT) |

This means the full flow is **demonstrable end-to-end today** without hardware, and the real drivers can be swapped in without touching business logic.

### 8.1 Production API Specification

**API Endpoint:**
```
http://192.168.1.102/bdf/apps/bafrestapi.php/PRODUCTION_API/REST
```

**Parameters:**
| Parameter | Description | Example |
|-----------|-------------|---------|
| `hsMode` | API mode | `GET-PRODUCTION-ORDER-TRX` |
| `hxTrxDt` | Transaction date | `2026-05-14` |

**Response Structure:**
```json
{
  "order_no": "000012739824",
  "item_serial_no": "HDSS7243",
  "item_cd": "8004645",
  "item_dsc": "SS76-BHL-4WD-FC-BS5-3SPL-IND-6IN1-0.33",
  "plan_operation_group_cd": "LINE ASSY",
  "barcode_val": "28002951",
  "production_order_id": "2762228",
  "group_dsc": "SKID",
  "production_order_trxs": {
    "production_order_trx": [
      {
        "operation_seq_no": "10",
        "start_dt_time": "2026-05-13 15:35:21",
        "end_dt_time": "2026-05-13 15:45:51",
        "work_center_cd": "STAGE-1",
        "operation_completed_qty": "1.00"
      }
    ]
  }
}
```

**Stage Mapping:**
| Stage | operation_seq_no | work_center_cd | Description |
|-------|------------------|----------------|-------------|
| 1 | 10 | STAGE-1 | Serial number assignment |
| 2 | 20 | STAGE-2 | Assembly step 2 |
| ... | ... | ... | ... |
| 13 | 130 | STAGE-13 | **Barcode pasting + Auto location assignment** |
| ... | ... | ... | ... |
| 18 | 180 | STAGE-18 | **Final quality check + Driver assignment** |

**Sync Schedule:** Every 2 hours via node-cron

---

## 9. Developer Guide

### Prerequisites
- Node.js 20.13+, XAMPP (MySQL on port 3306), npm

### Setup
```bash
# 1. Create database 'yard_management' (phpMyAdmin or MySQL CLI)

# 2. Backend
cd backend
npm install
# create .env:
#   DATABASE_URL="mysql://root:@localhost:3306/yard_management"
#   JWT_SECRET="your-secret-key"
#   PORT=5000
npx prisma generate
npx prisma db push
npm run dev              # → http://localhost:5000

# 3. Frontend (root)
npm install
npm run dev              # → http://localhost:3000
```

### Seed Data
`npm run seed` creates: admin user, sample yards with slots, FERT categories with priorities, drivers, and machines at various stages (1, 13, 18, parked) — enabling immediate end-to-end testing.

### Conventions
- **Backend:** controllers (HTTP handling) → services (business logic) → Prisma (data). New features follow this 3-layer pattern.
- **Frontend:** server components for static views; `'use client'` components for interactive forms; Tailwind for styling.
- **Enums:** always use the Prisma enum values (UPPER_SNAKE_CASE) in both backend and frontend.
- **Auth:** JWT in Authorization header; use `requireRole(...)` middleware on restricted routes.
- **No comments in code** unless asked; keep types strict (TypeScript).

### Verification Workflow (E2E test path)
1. Seed → login as admin
2. Machine at stage 13 → verify auto location assignment (FERT → preferred yard → RESERVED slot)
3. Advance to 18 → assign driver
4. Open Gate Control → biometric + barcode → AUTHORIZED → barrier opens
5. Machine appears on yard map as YELLOW (PARKED_PENDING)
6. Security login → verify → GREEN

---

## 10. Implementation Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Base system: auth, yards, machines, slots, movements | Done |
| 2 | FERT categories, drivers, assembly stage tracking (1–18), Production API sync + auto location | Done |
| 3 | Gate auth flow, biometric/barrier adapters, gate logs | Next |
| 4 | Security verification (YELLOW/RED/GREEN), SECURITY role | Planned |
| 5 | Frontend: Assembly Line, Drivers, Gate Control, Security tabs + colors | In Progress |
| 6 | Seed + E2E test | Planned |
| 7 | Real hardware + real DF API wiring (needs device/API details) | Waiting on inputs |
