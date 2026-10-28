'use client';

import { useState } from 'react';
import { CircleCheck, CircleX, Download, OctagonAlert, Printer, Square } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatDateTime } from '@/lib/format';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';
import { asset } from '@/lib/basePath';

/**
 * SOP – FG Yard Gate System, as issued by the Quality Department (Oct 23, 2026). The
 * source PDF is public/fg-yard-gate-sop.pdf; keep this page in step with it when Quality
 * issues a revision.
 */

interface SopStep {
  title: string;
  text: string;
  rule?: boolean;
}

interface SopRole {
  role: string;
  responsibility: string;
  steps: string;
}

const steps: SopStep[] = [
  { title: 'Stage 13 completion', text: 'After Stage 13 is complete, the machine moves to Testing and Validation.' },
  { title: 'Return to shop floor', text: 'After Testing and Validation, the machine returns to the shop floor for the UV test and rectification of all quality issues.' },
  { title: 'Stage 18 clearance', text: 'Quality inspects the machine and clears Stage 18.' },
  { title: 'Barcode label', text: 'On Stage 18 clearance, the system automatically generates a barcode label from the Quality Department. The label is pasted on the machine.' },
  { title: 'Shortage items', text: 'If any shortage item exists, Quality will NOT clear Stage 18, and the machine CANNOT be moved to the FG yard.', rule: true },
  { title: 'Move to FG yard gate', text: 'Only an authorised Quality operator (wearing the red or green T-shirt) drives the machine from Stage 18 to the FG yard gate.' },
  { title: 'Security check at gate', text: "The security guard at the gate scans the barcode and verifies the operator's T-shirt. If either check fails, the machine is not allowed in." },
  { title: 'Location allocation', text: 'When both checks pass, the system allocates an FG yard parking location.' },
  { title: 'Parking', text: 'The operator parks the machine at the allocated location and returns to the assembly line.' },
  { title: 'SO-based selection', text: 'Using the FG Yard Stock Status dashboard (developed by IT), the planner selects the part number and quantity against the Sales Order (SO).' },
  { title: 'FIFO release to PDI', text: 'The system automatically releases machines from the FG yard to PDI on a First-In, First-Out (FIFO) basis.' },
  { title: 'PDI final check', text: 'The machine undergoes the Pre-Delivery Inspection (PDI) final check.' },
  { title: 'Dispatch', text: 'After PDI clearance, the machine is dispatched to the customer.' },
];

// Step numbers refer to the process steps above. The issued PDF's table is one step
// behind from step 5 on; these are the corrected numbers.
const roles: SopRole[] = [
  { role: 'Quality Department', responsibility: 'UV test sign-off, Stage 18 clearance, barcode label generation', steps: '2–5' },
  { role: 'Quality operator (red / green T-shirt)', responsibility: 'Move machine from Stage 18 to FG yard and park at allocated location', steps: '6, 9' },
  { role: 'Security (FG yard gate)', responsibility: 'Scan barcode, verify operator T-shirt, refuse entry if either fails', steps: '7' },
  { role: 'FG stockyard head (Mr. Magesh Kumar)', responsibility: 'Overall control of FG yard and gate system', steps: 'All' },
  { role: 'Planner', responsibility: 'Select part number and quantity against SO in FG Yard Stock Status dashboard', steps: '10' },
  { role: 'IT', responsibility: 'Maintain barcode system, location allocation and FG Yard Stock Status dashboard', steps: '4, 8, 10–11' },
  { role: 'PDI team', responsibility: 'Final check before dispatch', steps: '12' },
  { role: 'Dispatch', responsibility: 'Dispatch PDI-cleared machines to customer', steps: '13' },
];

type GuideKey = 'security' | 'operator' | 'planner' | 'pdi';

interface RoleGuide {
  key: GuideKey;
  role: string;
  steps: string;
  checklist: { heading?: string; items: string[] }[];
  dos: string[];
  donts: string[];
}

// App guidance, not part of the issued SOP: how each role carries out its SOP steps in
// this system. Keep it in line with the SOP and with what the screens actually enforce.
const roleGuides: RoleGuide[] = [
  {
    key: 'security',
    role: 'Security (FG yard gate)',
    steps: 'SOP step 7',
    checklist: [
      {
        heading: 'Inward (machine coming in)',
        items: [
          'Gate Control: select Inward.',
          'Scan the driver badge (employee code).',
          'Check by eye: the driver is an authorised Quality operator wearing the red or green T-shirt.',
          'Scan the barcode label on the machine. Check the serial number on screen matches the machine.',
          'Check the slot shown on screen and tell the driver the yard and slot.',
          'Press Authenticate & Open Barrier. Let the machine in only on green.',
          'Press Reset before the next machine.',
        ],
      },
      {
        heading: 'Outward (machine going out)',
        items: [
          'Gate Control: select Outward.',
          'Scan the driver badge and check the red or green T-shirt.',
          'Scan the machine barcode. The system lets out only machines on a dispatch plan or released for exit (approved exit request or yard manager release).',
          'Press Authorize Exit & Open Barrier. Let the machine out only on green.',
        ],
      },
      {
        heading: 'Parking check (Security page)',
        items: [
          'Walk to the slot shown on the card.',
          'Approve only when the right machine is in that slot; otherwise Reject with the reason.',
        ],
      },
    ],
    dos: [
      'Scan every machine, every time, even one you know.',
      'Stop the machine if the barcode label is missing or does not scan.',
      'Write a clear reason when you reject.',
    ],
    donts: [
      'Do not open the barrier by hand when the screen shows red.',
      'Do not let in a driver without the red or green T-shirt.',
      'Do not type a barcode from paper or memory in place of scanning the label.',
      'Do not approve parking without seeing the machine in the slot.',
    ],
  },
  {
    key: 'operator',
    role: 'Quality operator / driver',
    steps: 'SOP steps 6 and 9',
    checklist: [
      {
        items: [
          'Stage 18 is cleared by Quality and the barcode label is pasted on the machine.',
          'No shortage items on the machine (Quality does not clear Stage 18 otherwise).',
          'Wear the red or green T-shirt and carry your driver badge.',
          'Drive the machine from Stage 18 to the FG yard gate.',
          'Get the yard and slot from Security after the gate check.',
          'Park in that exact slot.',
          'Confirm Parking: press "I have parked it" on your machine card.',
          'Return to the assembly line.',
        ],
      },
    ],
    dos: [
      'Confirm parking straight after parking; the yard team is alerted if it is not confirmed in time (30 minutes by default).',
      'If Security rejects the parking, re-park in the same slot and confirm again.',
    ],
    donts: [
      'Do not bring a machine without a barcode label or with shortage items.',
      'Do not park in any slot other than the one given.',
      'Do not hand the machine to someone who is not an authorised operator.',
    ],
  },
  {
    key: 'planner',
    role: 'Planner',
    steps: 'SOP step 10',
    checklist: [
      {
        items: [
          'Yard Stock: check the free stock of the model-type you need.',
          'Dispatch Planning: click Plan Machines.',
          'Enter the SO number when the plan is for a Sales Order.',
          'Choose the model-type and quantity; add more model-types if needed.',
          'Check the preview: the oldest free machines (FIFO) that will be picked.',
          'Click Save Plan and share the plan number (and SO) with the PDI team.',
        ],
      },
    ],
    dos: [
      'Enter the SO number whenever you have it, so the plan can be traced to the order.',
      'Cancel a machine as soon as the order changes; it goes back to free stock.',
    ],
    donts: [
      'Do not try to pick machines by hand; the system picks the oldest first (FIFO).',
      'Do not plan more than the free stock; the plan is refused.',
      'A machine cannot be cancelled after it leaves the FG yard; correct the plan before that.',
    ],
  },
  {
    key: 'pdi',
    role: 'PDI team',
    steps: 'SOP steps 11 and 12',
    checklist: [
      {
        heading: 'In the FG yard',
        items: [
          'Dispatch Machine List → In FG yard: assign a driver (optional).',
          'Tick the machines and Print Slip; give the slip to the driver.',
          'The driver collects each machine from the slot on the slip and goes out through the FG gate (Outward).',
        ],
      },
      {
        heading: 'PDI final check',
        items: [
          'At PDI: do the final check on the machine.',
          'PDI Check → Pass when the machine is fit for dispatch.',
          'Otherwise PDI Check → Hold with the problem written in the remark.',
          'After rectification, check again and Pass. The machine moves to Ready for main gate.',
        ],
      },
    ],
    dos: [
      'Write what is wrong in the Hold remark, so rectification knows what to fix.',
      'Check a held machine again as soon as it is rectified.',
    ],
    donts: [
      'Do not Pass a machine with an open issue.',
      'Do not send a machine to the main gate before PDI passes it; the main gate cannot mark it out.',
    ],
  },
];

// Each user opens on the checklist for their own role; other roles see all of them.
const GUIDE_FOR_ROLE: Record<string, GuideKey> = { SECURITY: 'security', DRIVER: 'operator', PLANNER: 'planner', PDI: 'pdi' };

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Printable checklist, one role per page, with tick boxes and a sign-off line. The
 * browser print dialog also saves it as a PDF ("Save as PDF" as the printer).
 */
function printChecklists(guides: RoleGuide[], printedBy: string) {
  const pages = guides.map((g) => `
    <section>
      <div class="head">
        <div>
          <h1>Checklist: ${esc(g.role)}</h1>
          <p class="meta">SOP – FG Yard Gate System (Quality Department, Oct 23, 2026) · ${esc(g.steps)}</p>
        </div>
        <p class="meta right">FG Yard</p>
      </div>
      ${g.checklist.map((c) => `
        ${c.heading ? `<h2>${esc(c.heading)}</h2>` : ''}
        <ul class="check">${c.items.map((i) => `<li><span class="box"></span>${esc(i)}</li>`).join('')}</ul>
      `).join('')}
      <div class="cols">
        <div class="do"><h3>Do</h3><ul>${g.dos.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
        <div class="dont"><h3>Don't</h3><ul>${g.donts.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
      </div>
      <div class="sign"><span>Name</span><span>Date</span><span>Signature</span></div>
      <p class="foot">App guidance: how this role carries out its SOP steps in FG Yard. Not part of the issued SOP.
        Printed ${esc(formatDateTime(new Date().toISOString()))}${printedBy ? ` by ${esc(printedBy)}` : ''}.</p>
    </section>`).join('');

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { window.alert('Allow pop-ups for this site to print the checklist.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>FG Yard Checklist${guides.length === 1 ? ` - ${esc(guides[0].role)}` : 's'}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, sans-serif; color: #111; margin: 0; font-size: 12px; }
      section { page-break-after: always; }
      section:last-child { page-break-after: auto; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 6px; margin-bottom: 10px; }
      h1 { font-size: 18px; margin: 0; }
      h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #444; margin: 12px 0 4px; }
      h3 { font-size: 12px; margin: 0 0 4px; }
      .meta { font-size: 11px; color: #555; margin: 2px 0 0; }
      .right { font-weight: bold; color: #1d4ed8; }
      ul { margin: 0; padding: 0; list-style: none; }
      .check li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #e5e7eb; }
      .box { flex: none; width: 13px; height: 13px; border: 1.5px solid #333; border-radius: 2px; margin-top: 1px; }
      .cols { display: flex; gap: 10px; margin-top: 14px; }
      .cols > div { flex: 1; border-radius: 6px; padding: 8px 10px; }
      .cols li { padding: 2px 0 2px 14px; position: relative; }
      .do { border: 1px solid #10b981; background: #ecfdf5; }
      .do li::before { content: '✓'; position: absolute; left: 0; color: #059669; font-weight: bold; }
      .dont { border: 1px solid #ef4444; background: #fef2f2; }
      .dont li::before { content: '✗'; position: absolute; left: 0; color: #dc2626; font-weight: bold; }
      .sign { display: flex; gap: 24px; margin-top: 36px; }
      .sign span { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 11px; }
      .foot { margin-top: 14px; font-size: 10px; color: #666; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style></head><body>${pages}
    <script>window.onload = function () { window.print(); };</script>
    </body></html>`);
  w.document.close();
}

export default function SopDocument() {
  const { user } = useAuth();
  // Until the user picks one, follow their role; the signed-in user can arrive after the first render.
  const [picked, setGuideFilter] = useState<GuideKey | 'all' | null>(null);
  const guideFilter = picked ?? GUIDE_FOR_ROLE[user?.role ?? ''] ?? 'all';
  const shownGuides = guideFilter === 'all' ? roleGuides : roleGuides.filter((g) => g.key === guideFilter);

  return (
    <div className="space-y-3">
      <PageHeader
        title="SOP – FG Yard Gate System"
        description="Issued by the Quality Department · Oct 23, 2026"
        actions={
          <a
            href={asset('/fg-yard-gate-sop.pdf')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
          >
            <Download className="w-4 h-4" /> Open SOP PDF
          </a>
        }
      />

      <SectionCard title="Purpose and scope">
        <p className="text-[13px] text-slate-700">
          From Oct 26, 2026 (Monday), control of the Finished Goods (FG) yard moves from Production to the Quality Department,
          with 100% gate-system implementation.
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
          {[
            ['Owner', 'Quality Department'],
            ['FG stockyard head', 'Mr. Magesh Kumar'],
            ['Applies to', 'Every machine from Stage 13 completion through FG yard entry, PDI and customer dispatch'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-900">
        <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <p className="text-[13px]">
          <span className="font-semibold">Mandatory:</span> If any shortage item exists, Quality will NOT clear Stage 18.
          The machine CANNOT enter the FG yard.
        </p>
      </div>

      <SectionCard title="Process steps" noPadding>
        <ol className="divide-y divide-slate-100">
          {steps.map((s, i) => (
            <li key={s.title} className={`flex gap-3 px-4 py-2.5 ${s.rule ? 'bg-red-50/60' : ''}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.rule ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                {i + 1}
              </span>
              <p className="text-[13px] text-slate-700">
                <span className="font-semibold text-slate-900">{s.title}:</span> {s.text}
              </p>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Roles and responsibilities" noPadding>
        <Table>
          <TableHeader>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Responsibility</TableHeaderCell>
            <TableHeaderCell>Steps</TableHeaderCell>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.role}>
                <TableCell className="font-medium text-slate-900 whitespace-normal">{r.role}</TableCell>
                <TableCell className="whitespace-normal">{r.responsibility}</TableCell>
                <TableCell className="tabular-nums">{r.steps}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Step numbers in this table are corrected to match the process steps above. The issued PDF lists them one step
          behind from step 5 onwards; Quality to correct it in the next revision.
        </p>
      </SectionCard>

      <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Checklists and Do&apos;s &amp; Don&apos;ts</h2>
          <p className="text-xs text-slate-500">
            App guidance: how each role carries out its SOP steps in FG Yard. This is not part of the issued SOP.
          </p>
        </div>
        <Button variant="secondary" onClick={() => printChecklists(shownGuides, user?.name ?? '')} icon={<Printer className="w-4 h-4" />}>
          Print / Save as PDF{guideFilter === 'all' ? ' (all roles)' : ''}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show checklist for">
        {[{ key: 'all' as const, role: 'All roles' }, ...roleGuides].map((g) => {
          const active = guideFilter === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setGuideFilter(g.key)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {g.role}
            </button>
          );
        })}
      </div>

      <div className={`grid grid-cols-1 gap-3 ${shownGuides.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {shownGuides.map((g) => (
          <SectionCard
            key={g.role}
            title={g.role}
            description={g.steps}
            action={
              <Button size="sm" variant="ghost" onClick={() => printChecklists([g], user?.name ?? '')} icon={<Printer className="w-3.5 h-3.5" />} aria-label={`Print the ${g.role} checklist`}>
                Print
              </Button>
            }
          >
            <div className="space-y-3">
              {g.checklist.map((c, n) => (
                <div key={c.heading ?? n}>
                  {c.heading && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.heading}</p>}
                  <ul className="space-y-1">
                    {c.items.map((item) => (
                      <li key={item} className="flex gap-2 text-[13px] text-slate-700">
                        <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Do</p>
                  <ul className="space-y-1">
                    {g.dos.map((d) => (
                      <li key={d} className="flex gap-1.5 text-xs text-emerald-900">
                        <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-700">Don&apos;t</p>
                  <ul className="space-y-1">
                    {g.donts.map((d) => (
                      <li key={d} className="flex gap-1.5 text-xs text-red-900">
                        <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
