# Pilot test sheet

Fill in one row per test (spec §17). A test passes only when someone checks the real result (the database record, the stock number, the printed form), never from a demo alone.

- **Automated** = already covered by `npm run check` (file under `ims/tests/`). Still run it on the pilot system.
- **Manual** = needs people, phones, a printer, or the server.

## Devices used

| #   | Phone / computer | OS + version | Browser + version | Installed as app? |
| --- | ---------------- | ------------ | ----------------- | ----------------- |
| 1   |                  |              |                   |                   |
| 2   |                  |              |                   |                   |
| 3   |                  |              |                   |                   |

## Tests

| ID  | Test                                                   | Expected                                            | Automated                        | Manual                                 | Device # | Tester | Date | Pass / Fail | Evidence | Defect # |
| --- | ------------------------------------------------------ | --------------------------------------------------- | -------------------------------- | -------------------------------------- | -------- | ------ | ---- | ----------- | -------- | -------- |
| A01 | Create an SKU and assign it to a location              | Item searchable; duplicate SKU rejected             | stock.test                       |                                        |          |        |      |             |          |          |
| A02 | Create five identical model assets                     | Five separate tags and histories                    | assets.test                      |                                        |          |        |      |             |          |          |
| A03 | Receive 10 units at Warehouse A                        | Balance +10; ledger and audit match                 | stock.test                       |                                        |          |        |      |             |          |          |
| A04 | Two users issue the last 3 units at once               | Only what's there is issued; never negative         | stock.test                       |                                        |          |        |      |             |          |          |
| A05 | Transfer 7 units A → B                                 | A −7, B +7, one reference                           | stock.test                       |                                        |          |        |      |             |          |          |
| A06 | Transfer fails mid-way                                 | Neither balance changes                             | stock.test                       |                                        |          |        |      |             |          |          |
| A07 | Borrow an available drill                              | Borrowed, borrower recorded, PDF made               | borrowing.test                   | Print the PDF                          |          |        |      |             |          |          |
| A08 | Two supervisors release the same drill                 | Only one succeeds                                   | borrowing.test                   |                                        |          |        |      |             |          |          |
| A09 | Return 2 of 3 borrowed assets                          | Two lines closed, third still out                   | borrowing.test                   |                                        |          |        |      |             |          |          |
| A10 | Return a damaged asset                                 | Needs review / maintenance, not available           | borrowing.test                   |                                        |          |        |      |             |          |          |
| A11 | Scan QR, Code 128, EAN-13, UPC-A                       | Right record, or a clear "unsupported" message      | scan-formats.test                | **Yes, real labels + phones**          |          |        |      |             |          |          |
| A12 | Scan the same item twice                               | Saved count opens; not doubled                      | field-store.test                 | **Yes, phone**                         |          |        |      |             |          |          |
| A13 | Download a count, go offline, record 100+ lines        | All saved and editable offline                      | field-store.test                 | **Yes, airplane mode**                 |          |        |      |             |          |          |
| A14 | Force-close and reopen offline                         | All counts still there                              | field-store.test                 | **Yes, phone**                         |          |        |      |             |          |          |
| A15 | Back online → Sync now                                 | Each count acknowledged; only those leave the queue | field-outbox.test                | **Yes, phone**                         |          |        |      |             |          |          |
| A16 | Network drops after the server saved, before the reply | Retry doesn't duplicate                             | sync.test, field-outbox.test     | **Yes, pull network mid-send**         |          |        |      |             |          |          |
| A17 | Same operation id, changed content                     | Rejected; original kept                             | sync.test                        |                                        |          |        |      |             |          |          |
| A18 | Two phones count the same line differently             | "Counts disagree" for review; no silent overwrite   | sync.test, reconcile.test        | **Yes, two phones**                    |          |        |      |             |          |          |
| A19 | Count closed before an offline upload arrives          | Kept as a conflict; no adjustment                   | sync.test                        |                                        |          |        |      |             |          |          |
| A20 | Approve one variance line                              | Exactly one adjustment                              | reconcile.test                   |                                        |          |        |      |             |          |          |
| A21 | Approve the same line twice                            | No duplicate adjustment                             | reconcile.test                   |                                        |          |        |      |             |          |          |
| A22 | Field user tries to finalize an issue via the API      | Refused; balance unchanged                          | api-stock.test, api-access.test  |                                        |          |        |      |             |          |          |
| A23 | Field user asks for another site's records             | Refused; nothing leaked                             | api-access.test, assets.test     |                                        |          |        |      |             |          |          |
| A24 | All four PDFs, including a 30-row one                  | Right details, page breaks, readable print          | borrowing.test, pdf.test         | **Yes, print on A4 at 100%**           |          |        |      |             |          |          |
| A25 | PDF fails after a confirmed issue                      | Issue stays; Retry PDF works; no second movement    | borrowing.test                   |                                        |          |        |      |             |          |          |
| A26 | Restore the latest backup to a clean server            | Data, links and PDFs match                          | — (rehearsed locally)            | **Yes, on the real server, witnessed** |          |        |      |             |          |          |
| A27 | Replace / restart the database container               | Data still there                                    | — (rehearsed locally)            | **Yes, on the real server**            |          |        |      |             |          |          |
| A28 | Role changed while the phone is offline                | Upload refused after reconnect                      | sync.test                        |                                        |          |        |      |             |          |          |
| A29 | Camera permission denied                               | Typing the code works; clear instructions           | — (checked in a desktop browser) | **Yes, phone**                         |          |        |      |             |          |          |
| A30 | Phone storage full or blocked                          | Clear error; never claims "saved"                   | field-store.test                 | **Yes, private mode**                  |          |        |      |             |          |          |

## Pilot sign-off (spec §17)

- [ ] A01–A30 pass, or have a written exception that doesn't risk stock accuracy or data
- [ ] Tested on at least one company Android phone (Chrome) and one iPhone (Safari + Home Screen)
- [ ] One count of 100+ mixed lines done fully offline, then synced: nothing missing, nothing doubled
- [ ] After approvals, the system matches the physical test stock
- [ ] Each PDF matches the company's approved form and prints clearly
- [ ] Deployed from the repository to an empty server with the runbook
- [ ] Off-server backup and restore watched and checked
- [ ] Supervisors and field staff did their main tasks using the guide

| Role            | Name | Signature | Date |
| --------------- | ---- | --------- | ---- |
| Inventory owner |      |           |      |
| Supervisor      |      |           |      |
| Developer       |      |           |      |
