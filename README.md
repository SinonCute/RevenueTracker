# Revenue Tracker

Revenue Tracker is a local Windows desktop app for tracking machine payment schedules, revenue, expenses, and profit in Vietnamese dong.

## What It Does

- Tracks machines with custom billing intervals in days, weeks, or months.
- Shows which machines are due soon.
- Records machine payments, payment count, and total paid.
- Tracks revenue and expenses.
- Converts USD revenue to VND with an editable fixed exchange rate.
- Shows dashboard totals and charts for revenue, expenses, machine cost, and profit.
- Stores data locally on your computer in a SQLite database file.

## Run The App

Use the installer:

```powershell
.\release\"Revenue Tracker Setup 0.1.5.exe"
```

Or run the unpacked executable directly:

```powershell
.\release\win-unpacked\"Revenue Tracker.exe"
```

After installing, the app creates a desktop shortcut and Start Menu shortcut.

## How To Use

### Machines

1. Open `Machines`.
2. Add a machine name, price in VND, start date, optional first due date, and billing interval.
3. The due table shows the next payment date. If you enter a first due date, that date is used first; after each payment, the app advances by the interval.
4. If the first due date is already in the past, the app automatically adds those past due payments to payment history and shows the next unpaid due date.
5. Click the check button to complete the next payment.
6. Click the pencil button to rename or edit a machine later.
7. Payment history updates automatically.
8. The history table also shows `Historical` rows that were seeded from the machine start date when you add a machine after it has already begun.

### Bulk Add Machines

Open `Machines`, then use `Bulk add machines`.

Enter one machine per line:

```text
Name, Price VND, Start date, First due date, Every, Unit
```

Example:

```text
Machine A, 500000, 2026-06-01, 2026-06-08, 1, weeks
Machine B, 1200000, 2026-06-01, 2026-07-01, 1, months
```

Valid units are:

```text
days
weeks
months
```

Dates in bulk add can be entered as `YYYY-MM-DD` or `M/D/YYYY`.

### Revenue And Expenses

1. Open `Revenue`.
2. Add a `Revenue` or `Expense` entry.
3. Choose `USD` or `VND`.
4. USD entries are converted using the exchange rate in Settings.
5. The ledger and charts update automatically.

### Exchange Rate

1. Open `Settings`.
2. Change `VND per USD`.
3. Click `Save rate`.

New USD entries use the saved rate. Existing entries keep the rate used when they were created.

## Development

Install dependencies:

```powershell
npm install
```

Run in development mode:

```powershell
npm run dev
```

Type-check the project:

```powershell
npm run typecheck
```

Build the app:

```powershell
npm run build
```

Build the Windows installer:

```powershell
npm run dist
```

## Data Location

The app stores its local database in Electron's user data folder as:

```text
revenue-tracker.sqlite
```

On Windows, this is normally under:

```text
%APPDATA%\Revenue Tracker\
```

## Notes

- This is a single-user local desktop app.
- There is no cloud sync or login.
- VND is the reporting currency.
- USD is supported as an input currency for revenue or expenses.
