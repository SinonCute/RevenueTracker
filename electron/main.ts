import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { Database, SqlValue } from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.VITE_DEV_SERVER_URL;

type IntervalUnit = 'days' | 'weeks' | 'months';

let db: Database;
let dbPath = '';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidIsoDate(dateIso: string | null | undefined): dateIso is string {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const date = new Date(`${dateIso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateIso;
}

function normalizeIsoDate(dateIso: string | null | undefined): string {
  if (!dateIso) throw new Error('Missing date');
  const trimmed: string = String(dateIso).trim();
  if (isValidIsoDate(trimmed)) return trimmed;
  const numeric = (trimmed as string).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    const [, m, d, y] = numeric;
    const normalized = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isValidIsoDate(normalized)) return normalized;
  }
  throw new Error(`Invalid date: ${dateIso}`);
}

function addInterval(dateIso: string, count: number, unit: IntervalUnit): string {
  if (!isValidIsoDate(dateIso)) throw new Error(`Invalid date: ${dateIso}`);
  const date = new Date(`${dateIso}T12:00:00Z`);
  if (unit === 'days') date.setDate(date.getDate() + count);
  if (unit === 'weeks') date.setDate(date.getDate() + count * 7);
  if (unit === 'months') date.setMonth(date.getMonth() + count);
  return date.toISOString().slice(0, 10);
}

function firstDueDate(machine: { startDate: string; endDate?: string | null }): string {
  return machine.endDate || machine.startDate;
}

function nextDueDate(machine: {
  startDate: string;
  endDate?: string | null;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  paymentCount: number;
}): string | null {
  if (!isValidIsoDate(machine.startDate)) return null;
  if (machine.endDate && !isValidIsoDate(machine.endDate)) return null;
  let dueDate = firstDueDate(machine);
  if (!isValidIsoDate(dueDate)) return null;
  for (let i = 0; i < machine.paymentCount; i += 1) {
    dueDate = addInterval(dueDate, machine.intervalCount, machine.intervalUnit);
  }
  return dueDate;
}

function insertPastPayments(machine: {
  id: number;
  priceVnd: number;
  startDate: string;
  endDate?: string | null;
  intervalCount: number;
  intervalUnit: IntervalUnit;
}): void {
  if (!isValidIsoDate(machine.startDate)) throw new Error(`Invalid start date for machine ${machine.id}`);
  if (machine.endDate && !isValidIsoDate(machine.endDate)) throw new Error(`Invalid end date for machine ${machine.id}`);
  let dueDate = machine.startDate;
  const currentDate = todayIso();
  while (dueDate < currentDate) {
    db.run(
      `INSERT INTO machine_payments (machineId, dueDate, paidDate, amountVnd, note, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [machine.id, dueDate, dueDate, machine.priceVnd, 'Auto-added historical row', 'seed']
    );
    dueDate = addInterval(dueDate, machine.intervalCount, machine.intervalUnit);
  }
}

function persistDb(): void {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function selectAll<T>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql, params);
  const rows: T[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
  } finally {
    stmt.free();
  }
  return rows;
}

function selectOne<T>(sql: string, params: SqlValue[] = []): T | undefined {
  return selectAll<T>(sql, params)[0];
}

function run(sql: string, params: SqlValue[] = []): void {
  db.run(sql, params);
  persistDb();
}

function lastInsertId(): number {
  return Number(selectOne<{ id: number }>('SELECT last_insert_rowid() AS id')?.id || 0);
}

async function initDb(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'revenue-tracker.sqlite');
  const wasmPath = isDev
    ? path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
    : path.join(process.resourcesPath, 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      priceVnd INTEGER NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT,
      intervalCount INTEGER NOT NULL DEFAULT 1,
      intervalUnit TEXT NOT NULL DEFAULT 'months',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS machine_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machineId INTEGER NOT NULL,
      dueDate TEXT NOT NULL,
      paidDate TEXT NOT NULL,
      amountVnd INTEGER NOT NULL,
      note TEXT,
      kind TEXT NOT NULL DEFAULT 'actual',
      FOREIGN KEY (machineId) REFERENCES machines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      entryDate TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      exchangeRate INTEGER NOT NULL,
      amountVnd INTEGER NOT NULL,
      note TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['exchangeRate', '26000']);
  const paymentColumns = selectAll<{ name: string }>("PRAGMA table_info(machine_payments)");
  if (!paymentColumns.some((column) => column.name === 'kind')) {
    db.run("ALTER TABLE machine_payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'actual'");
  }
  persistDb();
}

function machineWithStats(row: any) {
  const stats = selectOne<{ paymentCount: number; totalPaidVnd: number }>(
    'SELECT COUNT(*) AS paymentCount, COALESCE(SUM(amountVnd), 0) AS totalPaidVnd FROM machine_payments WHERE machineId = ?',
    [row.id]
  ) || { paymentCount: 0, totalPaidVnd: 0 };
  const machine = {
    id: row.id,
    name: row.name,
    priceVnd: row.priceVnd,
    startDate: row.startDate,
    endDate: row.endDate,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit as IntervalUnit,
    paymentCount: stats.paymentCount,
    totalPaidVnd: stats.totalPaidVnd
  };
  return { ...machine, nextDueDate: nextDueDate(machine) };
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => {
    const row = selectOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['exchangeRate']);
    return { exchangeRate: Number(row?.value || 26000) };
  });

  ipcMain.handle('settings:update', (_event, payload: { exchangeRate: number }) => {
    run('UPDATE settings SET value = ? WHERE key = ?', [String(payload.exchangeRate), 'exchangeRate']);
    return { exchangeRate: payload.exchangeRate };
  });

  ipcMain.handle('machines:list', () => {
    const rows = selectAll<any>('SELECT * FROM machines ORDER BY name COLLATE NOCASE');
    return rows.map(machineWithStats).sort((a, b) => {
      if (!a.nextDueDate) return 1;
      if (!b.nextDueDate) return -1;
      return a.nextDueDate.localeCompare(b.nextDueDate);
    });
  });

  ipcMain.handle('machines:create', (_event, payload) => {
    run(
      `INSERT INTO machines (name, priceVnd, startDate, endDate, intervalCount, intervalUnit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.name,
        payload.priceVnd,
        normalizeIsoDate(payload.startDate),
        payload.endDate ? normalizeIsoDate(payload.endDate) : null,
        payload.intervalCount,
        payload.intervalUnit
      ]
    );
    const machine = selectOne<any>('SELECT * FROM machines WHERE id = ?', [lastInsertId()]);
    insertPastPayments(machine);
    persistDb();
    return machineWithStats(machine);
  });

  ipcMain.handle('machines:bulkCreate', (_event, payload: any[]) => {
    db.run('BEGIN TRANSACTION');
    try {
      for (const machine of payload) {
        db.run(
          `INSERT INTO machines (name, priceVnd, startDate, endDate, intervalCount, intervalUnit)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [
            machine.name,
            machine.priceVnd,
            normalizeIsoDate(machine.startDate),
            machine.endDate ? normalizeIsoDate(machine.endDate) : null,
            machine.intervalCount,
            machine.intervalUnit
          ]
        );
        insertPastPayments({ ...machine, id: lastInsertId(), endDate: machine.endDate || null });
      }
      db.run('COMMIT');
      persistDb();
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    return selectAll<any>('SELECT * FROM machines ORDER BY name COLLATE NOCASE').map(machineWithStats);
  });

  ipcMain.handle('machines:update', (_event, payload) => {
    run(
      `UPDATE machines
       SET name = ?, priceVnd = ?, startDate = ?, endDate = ?,
           intervalCount = ?, intervalUnit = ?
       WHERE id = ?`,
      [
        payload.name,
        payload.priceVnd,
        normalizeIsoDate(payload.startDate),
        payload.endDate ? normalizeIsoDate(payload.endDate) : null,
        payload.intervalCount,
        payload.intervalUnit,
        payload.id
      ]
    );
    return machineWithStats(selectOne('SELECT * FROM machines WHERE id = ?', [payload.id]));
  });

  ipcMain.handle('machines:delete', (_event, id: number) => {
    run('DELETE FROM machines WHERE id = ?', [id]);
    return { ok: true };
  });

  ipcMain.handle('payments:pay', (_event, payload: { machineId: number; paidDate?: string; note?: string }) => {
    const row = selectOne<any>('SELECT * FROM machines WHERE id = ?', [payload.machineId]);
    const machine = machineWithStats(row);
    if (!machine.nextDueDate) throw new Error('This machine has no remaining due dates.');
    run(
      `INSERT INTO machine_payments (machineId, dueDate, paidDate, amountVnd, note, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [machine.id, machine.nextDueDate, payload.paidDate || todayIso(), machine.priceVnd, payload.note || null, 'actual']
    );
    return machineWithStats(row);
  });

  ipcMain.handle('payments:list', () => {
    return selectAll(
      `SELECT p.*, m.name AS machineName
       FROM machine_payments p
       JOIN machines m ON m.id = p.machineId
       ORDER BY p.paidDate DESC, p.id DESC`
    );
  });

  ipcMain.handle('ledger:list', () => {
    return selectAll('SELECT * FROM ledger_entries ORDER BY entryDate DESC, id DESC');
  });

  ipcMain.handle('ledger:create', (_event, payload) => {
    const amountVnd =
      payload.currency === 'USD' ? Math.round(Number(payload.amount) * Number(payload.exchangeRate)) : Math.round(Number(payload.amount));
    run(
      `INSERT INTO ledger_entries (type, label, entryDate, currency, amount, exchangeRate, amountVnd, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.type, payload.label, payload.entryDate, payload.currency, payload.amount, payload.exchangeRate, amountVnd, payload.note || null]
    );
    return selectOne('SELECT * FROM ledger_entries WHERE id = ?', [lastInsertId()]);
  });

  ipcMain.handle('ledger:delete', (_event, id: number) => {
    run('DELETE FROM ledger_entries WHERE id = ?', [id]);
    return { ok: true };
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'Revenue Tracker',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await initDb();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
