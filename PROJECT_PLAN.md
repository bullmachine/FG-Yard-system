# Yard Management System — Project Plan

**Version:** 1.2 | **Status:** In Development | **Duration:** ~9 weeks (compressed)

---

## 1. Project Description

- A full-stack **Yard Management System (YMS)** that digitizes the complete lifecycle of backhoe loaders — from assembly line (Stage 1–18) to verified parking in the Finished Goods (FG) yard, through to dispatch.
- A digital "Google Maps for the yard" with a formal handoff chain and three **capacity guard rails**:
  - **Assignment check** — no free slot → "YARD IS FULL" alert, machine stays on the line
  - **Gate entry check** — biometric (fingerprint/face) + barcode + assigned-slot-still-free verification before the barrier opens
  - **Dispatch check** — slot must be physically empty before it is cleared/recorded
- **Core lifecycle:** `Assembly → Auto slot assignment → Driver handoff → Gate entry (biometric + barcode + slot check) → Parking (YELLOW) → Security verification (GREEN) → Sale → Dispatch (slot checked, then freed; machine exits)`
- **Tech stack:** Next.js 16 + React 19 + TypeScript + TailwindCSS | Express 5 + Prisma ORM | MySQL (XAMPP) | JWT + bcrypt | Adapter pattern (mock drivers now, real hardware later)
- **The three worlds connected:** Assembly/Production (machine identity) → Logistics (drivers) → FG Yard Security (gate + verification)

---

## 2. Project Scope

### In Scope

- **Yards** — multiple yards with configurable row/col grid layouts and zone-based slots
- **Machine Lifecycle** — serial number + barcode identity, assembly stages 1–18, FERT category priority → auto slot assignment (RESERVED), park status tracking
- **FERT Categories** — admin-defined priority → preferred yard/zone mapping for automatic location assignment
- **Driver Management** — driver CRUD, biometric enrollment, handoff at Stage 18 (custodian during transport)
- **Gate Control** — biometric auth (fingerprint/face) + barcode scan + slot availability check; barrier open/close; full gate audit log
- **Security Verification** — YELLOW (PARKED_PENDING) → GREEN (PARKED_VERIFIED) / RED (PARKED_REJECTED, re-park required)
- **Dispatch** — slot-empty check before clearing; slot freed to AVAILABLE; machine → DISPATCHED
- **Audit Trail** — immutable movement, gate, and verification history with timestamp, reason, responsible user
- **RBAC** — Admin, Yard Manager, Operator, Service Technician, Security, View-Only
- **Dashboard & Analytics** — occupancy, status distribution, in-transit, at-gate, pending verification
- **Search & QR** — instant search by serial/barcode; QR code generation
- **Seed Data + E2E Test Path** — full demonstrable flow without hardware

### Out of Scope (Future Versions)

- Real hardware APIs/device wiring: physical biometric kiosk, physical boom barrier (mocked via adapters; installation planned in M10, device integration in M11)
- Real Digital Factory API credentials (mocked)
- Mobile native apps (iOS/Android)
- FIFO queue auto-allocation
- Simplified slot status

---

## 3. Guard Rails (Critical Acceptance Criteria)

- Every transition re-verifies physical space first; if reality does not match, it alerts instead of acting.
- **Guard rail 1 — Assignment (end of assembly, Stage 13):**
  - Check: is there any free slot?
  - If failed: **Alert "YARD IS FULL"** — no assignment; machine stays on the line
- **Guard rail 2 — Gate entry:**
  - Check: is the assigned slot still free right now?
  - If failed: **Alert "ASSIGNED SLOT UNAVAILABLE"** — barrier stays closed; slot re-assigned first
- **Guard rail 3 — Dispatch:**
  - Check: is the slot physically empty before clearing it?
  - If failed: **Alert "YARD IS FULL" / mismatch** — record never claims empty space that is occupied

---

## 4. Milestones, Tasks & Timeline (~9 weeks, compressed)

### M1 — Foundation & Data Model (Week 1)

- Set up project structure (Next.js + Express + Prisma)
- Define DB schema: User, Yard, Slot, Machine, FertCategory, Driver, Movement, GateLog, SecurityVerification + enums
- Implement JWT auth + RBAC
- Create seed script

### M2 — Core Yards & Machines CRUD (Week 2–3)

- Yard create/delete with auto slot generation
- Machine CRUD + search
- Slot allocation/removal
- Movement history recording
- Dashboard stats

### M3 — Assembly Integration (Week 4) ✅ DONE

- `advance-stage` endpoint (stages 1–18)
- Stage 13: barcode + auto slot assignment with "YARD IS FULL" guard rail
- Stage 18: machine → READY_TO_MOVE
- Production API integration (http://192.168.1.102/bdf/apps/bafrestapi.php/PRODUCTION_API/REST)
- Auto-sync every 2 hours via node-cron
- Auto-create machines when they appear in API
- Auto-detect stage progression from API

### M4 — FERT Priorities & Drivers (Week 4, parallel)

- FertCategory CRUD (priority → preferred yard)
- Driver CRUD + biometricId enrollment
- Driver assignment/handoff endpoint

### M5 — Gate Control (Week 5–6)

- Biometric driver (mock) + barrier driver (mock) interfaces
- `/api/gate/authenticate` — biometric → barcode → slot-availability check → authorize/open barrier
- Gate logs
- Manual barrier open/close (`/api/gate/barrier/open` / `/close`)

### M6 — Security Verification (Week 6)

- `verify-parking` (YELLOW → GREEN/RED)
- Park status transitions (PLANNED → … → PARKED_VERIFIED)
- SECURITY role permissions

### M7 — Dispatch Flow (Week 7)

- Sale/SOLD/RESERVED + DISPATCH_READY
- Dispatch endpoint with slot-empty check
- Slot freed to AVAILABLE; machine → DISPATCHED

### M8 — Frontend (all screens) (Week 5–8, parallel with backend)

- Dashboard
- Yard grid map (color-coded YELLOW/RED/GREEN)
- Machine tracking
- Assembly Line stepper
- Drivers
- Gate Control kiosk
- Security Verification
- History
- Role-gated tabs

### M9 — Integration, E2E & UAT (Week 8–9)

- Seed-based E2E test (assembly → gate → park → verify → dispatch)
- Guard-rail failure scenarios
- Bug fixes
- User acceptance & deployment

### M10 — Hardware Installation: Boom Barrier & Fingerprint/Face Machine (Week 8, parallel with M8–M9)

- Procurement & specs — confirm boom barrier model (arm length, RS485/relay/TCP interface, safety loop, manual release), biometric machine model (FINGERPRINT/FACE, device IP, RS232/RS485/TCP, SDK/API), barcode scanner
- Site preparation — gate-side power, LAN cable run to server, barrier concrete base/mounting post, kiosk mounting + weather protection, UPS
- Physical installation — mount boom barrier at FG yard entry gate, install biometric kiosk at gate, connect power + network
- Commissioning — power-on test, device reachability from backend, barrier open/close loop via manual endpoints, enroll test drivers on biometric machine, recognition tuning, barcode scan positioning
- Handoff package — document device IPs, protocols, and credentials for M11 adapter wiring
- Safety & training — emergency manual open, safety sensor check, kiosk training for security staff

### M11 — Real Adapter Integration: DF API, Biometric & Boom Barrier (on hold)

- Wire real DF API + biometric device + boom barrier adapters using the M10 handoff package
- Needs: device model/protocol details + API credentials (external inputs)

---

## 5. Milestone Dependencies

- M1 → M2 → M3 → M5 → M6 → M7 (sequential backbone)
- M4 runs in parallel with M3 (needed before M5 gate flow)
- M8 (frontend) runs in parallel from Week 5
- M9 after M7
- M10 runs in parallel with M8–M9 (Week 8); hardware ready before/with Go-Live testing
- M11 depends on the M10 handoff package (device details/credentials) + external API inputs

---

## 6. Risks & Mitigations

- **Risk:** Real hardware unavailable (biometric kiosk, boom barrier)
  - **Impact:** blocks real-world gate flow
  - **Mitigation:** adapter pattern with mock drivers; hardware swapped in later without touching business logic
- **Risk:** Hardware delivery / site delays (civil work, power, network cabling)
  - **Impact:** misses Go-Live window; M10 commissioning slips
  - **Mitigation:** start procurement + site prep at Week 8; buffer in M9; installation parallel with software testing
- **Risk:** Chosen device model/protocol mismatches the adapter contract
  - **Impact:** M11 integration rework
  - **Mitigation:** procurement spec checklist (interface, SDK, credentials) before purchase; M10 handoff package documents exact protocol
- **Risk:** Digital Factory API credentials not provided
  - **Impact:** no real serial/barcode sync
  - **Mitigation:** mock provider generates IDs; swap to real HTTP provider later
- **Risk:** Guard-rail edge cases (full yard, slot taken at gate)
  - **Impact:** inventory record desync
  - **Mitigation:** mandatory E2E failure-scenario tests before Go-Live
- **Risk:** XAMPP MySQL concurrency on allocation
  - **Impact:** double allocation
  - **Mitigation:** unique constraints + transactional slot reservation in Prisma

---

## 7. Definition of Done (Go-Live Checklist)

- [ ] All 3 guard rails verified working (YARD IS FULL, ASSIGNED SLOT UNAVAILABLE, slot-empty dispatch check)
- [ ] Full lifecycle E2E passes: assembly → gate → park → verify → dispatch
- [ ] All 6 roles working with correct tab visibility and permissions
- [ ] Audit trail complete for movement, gate events, and security decisions
- [ ] Seed data provides demo-ready environment
- [ ] Deployed and accepted by yard manager + security team
