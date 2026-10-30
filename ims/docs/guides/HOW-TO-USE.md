# How to use IMS

IMS tracks two kinds of things:

- **Stock**: things you count and give out, like gloves, pants or cable ties. IMS keeps the number on hand.
- **Assets**: equipment you lend out and get back, like drills or laptops. Each one has its own tag (TOOL-0001) and history.

Works on a phone, tablet or computer. Words in **bold** are exactly what you see on screen. Pictures use sample data.

---

## 1. Sign in

1. Open the IMS link.
2. Type your **Email** and **Password**.
3. Press **Sign in**.

Forgot your password? Ask your administrator for a reset link.

![Sign-in page](img/office-login.jpg)

---

## 2. Who can do what

| You are         | You can                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**       | Everything, plus users and the audit log                                                                                        |
| **Supervisor**  | At your locations: add items and assets, receive / issue / transfer stock, lend and take back equipment, run and approve counts |
| **Field staff** | Count with your phone (works without internet) and send borrow requests                                                         |

---

## 3. Stock or Asset? Decide before you add an item

Ask: **"Do I need to know _which one_?"**

| Stock                                  | Asset                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| No. Any pair of pants is the same      | Yes. _This_ laptop went to Juan, due back Friday        |
| Kept as a number: "3 pair at MAIN-WH"  | Each unit has its own tag: LAP-0001, LAP-0002…          |
| Comes in with **Receive**              | Comes in with **Add assets**                            |
| Goes out with **Issue** (not returned) | Goes out with **Borrow** and comes back with **Return** |

**You can't change this later.** If you pick the wrong one, make a new item with a new SKU.

---

## 4. Office: the dashboard

The **Dashboard** opens when you sign in.

- **Needs your action** at the top is your to-do list. Clear it and your day is done.
- **Receive**, **Issue** and **Transfer** buttons are at the top right.

![Dashboard](img/office-dashboard.jpg)

Receive, Issue, Transfer and Borrow all have the same 4 steps: **Where → What → Who → Review**. The **Next** button names the next step (e.g. **Next: What**). Nothing changes until you press the confirm button on the last step.

---

## 5. Office: stock

### Add a new item

1. Open **Stock**.
2. Press **Add item** (below the search box).
3. **How is it tracked?**: choose **Stock** or **Asset** (see section 3).
4. Fill in **SKU** (a unique code, like `PPE-0001`), **Name** and **Unit**.
5. Optional: **Category**, **Low-stock level** (stock only), **Manufacturer barcode**, **Description**.
6. Optional: **Photo**: choose a picture (on a phone you can take one), so everyone knows exactly which item it is.
7. Press **Add item**.

Add or change a photo later: open the item → **Add photo** / **Change photo**, or **Remove**. The photo also shows as a small picture in the **Stock** list.

Many items at once: **Stock** → **Import CSV** → choose the file → fix any red rows → **Import … valid rows**.

### Receive stock (a delivery came in)

1. **Dashboard** → **Receive**.
2. **Receive at**: pick the location → **Next**.
3. **Add item**: scan or type the name or SKU, press Enter, then type how many. Repeat for each item → **Next**.
4. Optional: **Received from** (supplier) and **Delivery note / PO number** → **Next**.
5. Check the numbers → **Confirm receipt**.

### Give out stock (Issue)

1. **Dashboard** → **Issue**.
2. **Issue from**: pick the location → **Next**.
3. Add the items and how many → **Next**.

   ![Issue, step 2: add items and quantities](img/office-issue-what.jpg)

4. **Given to** and **Purpose** (work order or reason) → **Next**.
5. Check the before → after numbers → **Confirm issue**.

   ![Issue, step 4: review and confirm](img/office-issue-review.jpg)

6. Press **Print** or **Download PDF** to get the **Stock Issuance form** for signing.

### Move stock to another location (Transfer)

1. **Dashboard** → **Transfer**.
2. **From** and **To** → **Next**.
3. Add the items and how many → **Next**.
4. Optional: **Reason** → **Next**.
5. **Confirm transfer**, then print the **Transmittal form**.

### Find anything

Type or scan in the search box at the top: a name, SKU, asset tag, serial or barcode.
Or open **Stock** and tap **Low** or **Out** to see what needs reordering.

![Stock list](img/office-stock.jpg)

---

## 6. Office: assets (equipment)

### Add equipment

1. First make the item with **How is it tracked?** = **Asset** (section 5, "Add a new item").
2. Open **Assets** → **Add assets**.
3. **Asset item**: type the item's SKU and pick it.
4. **Location**: where it's kept.
5. **How many?**: one tag is made for each.
6. **Tag prefix**: a short code like `LAP`. Tags become LAP-0001, LAP-0002…
7. **Condition**: Good, Fair or Damaged.
8. Optional: **Serial numbers** (one per line, same order as the tags), **Custodian**, **Notes**.
9. Press **Add … assets**.
10. Press **Print … labels**. Print on A4 label paper (3 × 8, 70 × 37 mm) at **100% scale**, then stick one label on each unit.

![Label sheet ready to print](img/office-labels.jpg)

### See or change one asset

Open **Assets** → tap the asset. You see its details and full history.

- **Borrow**: lend it (only when **Available**).
- **Return**: take it back (only when **Borrowed**).
- **Change status**: for example **Under maintenance**, **Lost** or **Retired**. You must give a reason.
- **Print label**: reprint a lost or damaged label.

![Asset page with history](img/office-asset.jpg)

### Lend equipment (Borrow)

1. **Borrowing** → **Borrow equipment**.
2. **Release from**: where the equipment is now → **Next**.
3. **Add asset**: scan or type each tag and press Enter. Set **Condition** and **Accessories** (e.g. charger) → **Next**.
4. **Borrower** and **Purpose**. Optional: **Department or site**, **Due back**, **Physically received by**, **Notes** → **Next**.
5. Check everything. Optional: **Prepared by** (who got the equipment ready; leave it empty to use your name). **Preview form (DRAFT)** shows the form before anything is saved.
6. **Confirm release**.
7. Print the **Equipment Borrowing form** and have the borrower sign it.

Tabs on **Borrowing**: **Requests** (from the field), **Out now**, **Overdue** (red), **Closed**.

![Borrowing list](img/office-borrowing.jpg)

### Take equipment back (Return)

1. **Borrowing** → open the loan → **Return equipment**.
2. Tick each asset that came back.
3. **Condition now** for each. If it's **Damaged**, pick **Send to**: **Needs review** or **Under maintenance**.
4. Optional: **Missing accessories**, **Notes**.
5. **Brought back by** and **Received at**.
6. **Confirm return**, then print the **Return Acknowledgment** form.

You can return some items now and the rest later.

![Loan page: tick what came back](img/office-return.jpg)

### Release a borrow request from the field

1. **Borrowing** → **Requests** tab.
2. Open the request → **Check and release**.
3. Check the assets and details, then **Confirm release** as in "Lend equipment".

---

## 7. Office: stock counts

### Start a count

1. **Counts** → **New count**.
2. **Location to count** and a **Name** → **Next**.
3. **Count**: **Stock quantities** and/or **Tagged assets**. **Which items**: everything, or only some categories → **Next**.
4. **Who counts**: tick the people → **Next**.
5. Optional: **Finish counting by** and **Instructions for counters** → **Next**.
6. **Create count**.

Don't move stock at that location while it's being counted.

### Review a count

1. **Counts** → open the count.
2. For each line:
   - **Approve**: set the stock to the counted number.
   - **Request recount** (in the line's menu): ask for it to be counted again.
   - **Keep expected** (in the line's menu): ignore the counted number.
3. **Approve … with no difference** approves every line that already matches in one go.
4. When every line is done → **Close count**.

Counting alone never changes stock. Only **Approve** does.

![Count review: expected vs counted](img/office-count-review.jpg)

---

## 8. Office: forms and reports

### Forms (PDFs)

1. Open **Documents**.
2. Search by number (e.g. `ISS-2026-000123`).
3. **View**, **Download PDF** or **Print**.

If it says "PDF failed", press **Retry PDF**. The stock is already saved; this only remakes the form.

![Documents list](img/office-documents.jpg)

### Reports

1. Open **Reports** and pick a report.
2. Set the filters.
3. **Download CSV** (opens in Excel).

![Reports](img/office-reports.jpg)

---

## 9. Field: counting with your phone

### First time (needs internet)

1. Open the IMS link on your phone and sign in.
2. **Me** → **Install IMS on this phone** → follow the steps for Android or iPhone.
3. From now on, open IMS from the new icon on your home screen.

<p>
  <img src="img/field-me.jpg" alt="Me: install, storage, appearance" width="240">
</p>

### Before you go out (needs internet)

1. **Home** → find your assignment.
2. Press **Download for offline use**.
3. Wait for **Ready for offline use**. Now it works without signal.

<p>
  <img src="img/field-home.jpg" alt="Home: download your assignment" width="240">
  <img src="img/field-assignment.jpg" alt="Assignment: scan to count" width="240">
</p>

### Count

1. Open the assignment → **Scan to count**.
2. Point the camera at the label. Camera not working? Press **Type a code**.
3. For a **stock item**: type how many → **Save count**.
4. For **equipment**: tap **Found** or **Not found**. If found, pick the condition → **Save check**.
5. Scan the next one.

Scanned the same thing twice? It opens your saved count. It does **not** add it again.
To fix a count: **My results** → tap the line → change it.

<p>
  <img src="img/field-scan.jpg" alt="Type a code" width="240">
  <img src="img/field-count.jpg" alt="Count screen: how many, then Save count" width="240">
</p>

### Send your counts (needs internet)

1. Open the assignment or **My results**.
2. Press **Send … counts** (e.g. **Send 3 counts**).

The pill at the top shows where they are: **3 not sent** = still on your phone. **All sent** = the office has them.
No signal? Your counts stay safe on the phone. Send them later from **Sync** → **Sync now**.

<p>
  <img src="img/field-results.jpg" alt="My results: Send counts" width="240">
  <img src="img/field-sync.jpg" alt="Sync screen" width="240">
</p>

### Ask to borrow equipment

1. **Home** → **Borrow request** → **New borrow request**.
2. **Equipment is at**: pick the location.
3. **Assets**: type a tag or name. Matching equipment appears; tap **Add** on one marked **Available**. Red text means it can't be borrowed (already out, under maintenance…) or doesn't exist at that location. You can also **Scan a label**.
4. **Borrower** and **Purpose**. Optional: **Department or site**, **Notes**.
5. **Save on this phone**.
6. **Send to supervisor** (needs internet).

It's only a request. A supervisor does the official release.

<p>
  <img src="img/field-borrow.jpg" alt="Borrow requests" width="240">
</p>

---

## 10. What the colors mean

| Color     | Means                                          |
| --------- | ---------------------------------------------- |
| 🟢 Green  | OK · Available · Done · All sent               |
| 🟠 Orange | Low stock · Borrowed · Not sent yet            |
| 🔴 Red    | Out of stock · Overdue · Problem, needs action |
| ⚪ Grey   | Inactive · Retired · Draft                     |

---

## 11. Dark mode

Tap the sun / moon button at the top. Or **Me** → **Appearance** → **Same as device**, **Light** or **Dark**.

![Dashboard in dark mode](img/office-dashboard-dark.jpg)

---

## 12. Problems

| Problem                                 | Do this                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| "… is counted stock, not an asset item" | That item is Stock. Make a new item with **How is it tracked?** = **Asset**       |
| No **Add assets** button on an item     | The item is Stock. Use **Receive** for it, or make a new Asset item               |
| Camera won't open                       | Allow the camera for IMS in the phone settings, or use **Type a code**            |
| "Not downloaded"                        | Get internet, then **Download for offline use**                                   |
| Counts stuck on "not sent"              | Get internet → **Sync** → **Sync now**                                            |
| "Only 3 left" when issuing              | Lower the quantity or pick another location                                       |
| Asset can't be borrowed                 | It's borrowed, under maintenance, lost or retired. Check its status on **Assets** |
| Forgot password                         | Ask the admin: **Users** → **Reset link**                                         |

## 13. Don't

- **Don't clear browser data or uninstall** while counts are not sent. Unsent counts would be lost.
- **Don't share your account.** Every action is recorded under your name.
- **Don't go out of signal without downloading** your assignment first.

---

## 14. Settings

Admin only:

- **Users** → **Add user** → set a **Temporary password** and give it to the person directly. Menu on a user: **Reset link**, **Deactivate**.
- **Audit log**: who did what, and when.

Admin and supervisors:

- **Locations** → **Add location** (warehouse, site, rack).
- **Units & categories**: the lists used when adding items.
