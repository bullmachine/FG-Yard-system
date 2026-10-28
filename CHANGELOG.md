# FG Yard — Changelog

Changes that matter to users, IT and Quality. Newest first. For how to apply an update to a
running server, see [INSTALL.md › Updating an existing server](./INSTALL.md#13-updating-an-existing-server).

## 28 October 2026

**Update needs:** `npx prisma db push` (new columns and tables only, nothing removed), backend and
frontend rebuild, and the IIS folder change for the new address. Take a database backup first.

### Name and address
- The application is now called **FG Yard** (browser tab, login, sidebar, e-mails, printouts).
- The address is now **`/fg-yard`** instead of `/fg-yard-system`. The old address redirects to the
  new one through `deploy/old-address-redirect/web.config`.

### Dispatch
- **SO number** (optional) on a dispatch plan; searchable, shown on the plan, the dispatch list
  and the pick slip.
- **PDI final check** after FG gate-out: Pass, or Hold with a remark and check again. **Main gate-out
  is refused until PDI passes the machine**, from the screen and from the main gate API.
- Dispatch Machine List tabs: In FG yard · At PDI · Ready for main gate · Main gate out.
- A machine that comes back into the FG yard **before main gate-out** is taken off its plan
  ("Returned to FG yard") and goes on return hold.
- Dispatch Planning: plans load page by page with Open / Completed / Cancelled tabs, date and
  SO search, and a progress bar per plan.
- Dispatch is no longer a manual exit reason; customer dispatch goes only through Dispatch Planning.

### Yard and stock
- **Initial stock load** switch (Settings, Admin, off by default): only while it is on can a machine
  already parked before go-live be placed straight into a slot (Machine Tracking › Allocate),
  with stage 18, a barcode and a remark. When off, machines enter only through Gate Control.
- **Block / Unblock a slot** with a reason (who and when recorded). The Remove slot option is gone.
- Dragging a machine to another slot on the FG Yard grid now works (it silently failed before);
  the move is recorded and goes back to Security.
- Slot details show why a machine is not free stock (return hold, security rejection, plan, exit
  request). The slot "Dispatch" button is now **Release for exit** (testing, repair, relocation,
  maintenance).
- Yard Stock and Dispatch Planning summary cards open the list of machines behind them.

### Access
- **Role Access** page (Administration, Admin only): tick which role may open each page and use
  each action; the server enforces it; every change is logged; Reset to Default available. The
  default access is the same as before.
- **Security** role: Gate Control, Confirm Parking (on the driver's behalf) and FG Yard (view only).

### SOP and gate
- **SOP page** (Documentation › SOP) with the issued PDF, role checklists and Do's & Don'ts that can
  be printed or saved as PDF per role. The checklists are app guidance pending Quality review.
- Gate Control shows the **red / green T-shirt** dress code reminder next to the driver badge.

### Screens
- Compact two-line summary cards, tighter table rows and spacing on every page.

### Data
- Database backups (`backend/prisma/backups/`) are no longer kept in git; they hold personal data.
