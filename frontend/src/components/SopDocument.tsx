import { Download, OctagonAlert } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SectionCard } from '@/components/ui/Card';
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

export default function SopDocument() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="SOP – FG Yard Gate System"
        description="Issued by the Quality Department · Oct 23, 2026"
        actions={
          <a
            href={asset('/fg-yard-gate-sop.pdf')}
            download
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
          >
            <Download className="w-4 h-4" /> Download PDF
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
    </div>
  );
}
