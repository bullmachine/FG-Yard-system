# Yard Management System — Concept Overview (Manager Briefing)

A plain-language explanation of what the system does, how a machine flows through it, and where the system guards against errors.

---

## 1. The Problem It Solves

A factory builds backhoe loaders. Machines leave the assembly line and must be parked in a big outdoor finished-goods yard. Today this is tracked on paper — registers, phone calls, memory. Nobody can instantly answer:

- "Where is machine serial XYZ right now?"
- "Who moved it, and why?"
- "Is it actually where the records say it is?"
- "How much free space do we have?"

## 2. The Concept in One Sentence

A digital "Google Maps" for the finished-goods yard, plus a formal handoff chain — from the assembly line to the final parking spot — so every machine is tracked, verified, and accountable at every step.

---

## 3. The Lifecycle of One Machine (The Complete Flow)

### Step 1 — Birth (Assembly Line, Stages 1–18)

Each machine gets an identity: a **serial number** and a **barcode**. As it moves through roughly 18 assembly stages, the system watches its progress. At the final production stage, the machine is ready to leave the factory floor.

### Step 2 — Destination (Automatic Slot Assignment) — WITH FULL-YARD CHECK

The moment a machine finishes assembly, the system automatically picks which yard zone it belongs in (based on product-category priority rules) and reserves a specific parking slot. No human decides — the rulebook does.

**Safety check before assignment:**

- Free slot found → machine is assigned to it (slot becomes RESERVED).
- No free slot (yard full, or preferred zone full) → **the system does NOT assign anything. It raises an alert: "YARD IS FULL."** Production and yard management see the alert immediately and can act (prioritize dispatch, open another zone) before the machine ever leaves the assembly line.

**Why:** This is a preventive guard rail. Without it, a machine would leave the line and arrive at the gate with nowhere to park — a deadlock where the yard physically cannot accept it.

### Step 3 — Handoff (Driver Assignment)

A driver is assigned to physically move the machine from the factory to the yard. The driver becomes the custodian responsible for the machine during transport.

### Step 4 — The Gate (Security Checkpoint) — WITH SLOT-AVAILABILITY CHECK

This is the "security door" of the system. Physically it is a **fingerprint/face punching machine** (biometric kiosk) plus a **boom barrier** installed at the yard gate. Before the barrier opens, three things are verified:

1. **Driver identity** — fingerprint/face authentication. Failure → REJECTED, event logged, barrier stays closed.
2. **Machine identity** — barcode scan must match the assigned machine. Failure → REJECTED, event logged, barrier stays closed.
3. **Slot availability** — is the machine's assigned parking slot still free at this moment?
   - Slot still free → barrier opens, machine enters, event recorded.
   - Slot got taken meanwhile (another machine parked there, or slot blocked) → **alert: "ASSIGNED SLOT UNAVAILABLE — re-assign before entry."** The barrier stays closed; the system reassigns a new slot first. A machine never enters the yard without a guaranteed destination.

The same flow works with simulated devices in software until the physical kiosk and barrier are installed on-site (project milestone M10), after which the real hardware is swapped in without changing the logic.

### Step 5 — Parking + Human Verification (The Crucial Part)

The driver parks the machine in the assigned slot and exits the yard. The machine is marked **YELLOW (PARKED_PENDING)** = "the digital record says it's here, but it is not yet confirmed."

A security guard physically walks over and checks the machine:

- Correct spot, correct position → **GREEN (PARKED_VERIFIED)** = verified.
- Wrong spot or wrong position → **RED (PARKED_REJECTED)** = driver must re-park, and the process starts again.

**Why this design is smart:** Digital records alone can lie. The YELLOW → GREEN step connects the computer to physical reality. Nothing counts as "done" until a person physically confirms it. This is what makes it a verification system, not just a tracking system.

### Step 6 — Audit Trail

Every step — who moved it, when, from where to where, why, and who authorized it — is permanently recorded. If there is ever a dispute ("the machine is missing"), the entire history can be replayed.

### Step 7 — Dispatch (The Vehicle Leaves the Yard) — WITH SLOT-EMPTY CHECK

The machine is GREEN = confirmed, parked, and ready for business. Now the outgoing flow begins:

1. **A sale/order comes in.** The machine's status changes (RESERVED/SOLD), and its slot is marked **DISPATCH READY** — the yard team knows this slot will empty soon.
2. **Dispatch preparation — with a safety check.** Before the machine is loaded, the system checks the slot:
   - Slot is empty → dispatch proceeds normally; the machine leaves through the gate (logged like entry), the slot is freed back to **AVAILABLE**, and the grid instantly shows the empty space.
   - Slot is NOT empty (a machine is still physically sitting there) → **the system raises an alert: "YARD IS FULL" / slot mismatch detected.** Nothing is recorded as dispatched until the slot is actually free. The inventory record can never claim a space is empty when it is not.
3. **Final state.** Machine status becomes **DISPATCHED** — it is out of the yard system and its lifecycle ends here. The full history remains: assembly → parking (GREEN) → dispatch (out).

---

## 4. The Complete Lifecycle in One Line

> Assembly → Auto slot assignment → Driver handoff → Gate entry (biometric + barcode + slot check) → Parking (YELLOW) → Security verification (GREEN) → Sale → Dispatch (slot checked, then freed; machine exits).

## 5. The Three Checkpoints (Capacity Guard Rails)

The system checks yard capacity at every point where a machine transitions:

| # | Where | Check | If failed |
|---|---|---|---|
| 1 | Step 2 — Assignment (end of assembly) | Is there any free slot? | **Alert: "YARD IS FULL"** — no assignment; machine stays on the line |
| 2 | Step 4 — Gate entry | Is the assigned slot still free right now? | **Alert: "ASSIGNED SLOT UNAVAILABLE"** — barrier stays closed; slot re-assigned first |
| 3 | Step 7 — Dispatch | Is the slot physically empty before clearing it? | **Alert: "YARD IS FULL" / mismatch** — record never claims empty space that is occupied |

**The pattern:** Every transition — assignment, entry, and dispatch — re-verifies the physical space first, and if reality does not match, it alerts instead of acting. No machine enters a full yard, no barrier opens without a guaranteed spot, and no space is recorded as free until it actually is.

---

## 6. What the System Answers for the Business

- "What do I have parked right now?" → the yard grid (GREEN machines).
- "How much space is free?" → available slots, updated in real time after dispatch.
- "Where is a specific machine?" → instant search by serial number or barcode.
- "Who moved what, when, and why?" → full audit trail.

## 7. The Three "Worlds" the System Connects

| World | Role |
|---|---|
| Assembly / Production | Gives the machine its identity (serial number, barcode) |
| Logistics | Drivers transport machines from factory to yard |
| Yard Security | Gate control (biometric + barcode) and final parking verification |

The system is one shared source of truth between three departments that used to work on separate papers.

---

## 8. One-Line Takeaways

- **Concept:** "One digital record per machine, from production to parking — with automatic slot assignment, secure gate entry, and human verification at the end, so the system always reflects physical reality."
- **Dispatch:** "The machine isn't just tracked until it parks — it's tracked through the whole round trip: received by the yard, verified, sold, and dispatched out, so yard inventory is always accurate in real time."
- **The guard rails:** "If the yard is full, the system says so at the very moment of assignment — alerting immediately instead of sending a machine to a gate with nowhere to park. Every transition re-verifies the physical space first, and if reality doesn't match, it alerts instead of acting."
