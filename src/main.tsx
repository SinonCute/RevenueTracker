import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  CalendarClock,
  Check,
  Pencil,
  DollarSign,
  LayoutDashboard,
  Plus,
  Settings,
  Trash2,
  Wrench
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import './styles.css';

type IntervalUnit = 'days' | 'weeks' | 'months';
type Currency = 'USD' | 'VND';
type LedgerType = 'revenue' | 'expense';

type Machine = {
  id: number;
  name: string;
  priceVnd: number;
  startDate: string;
  endDate: string | null;
  intervalCount: number;
  intervalUnit: IntervalUnit;
  paymentCount: number;
  totalPaidVnd: number;
  nextDueDate: string | null;
};

type Payment = {
  id: number;
  machineId: number;
  machineName: string;
  dueDate: string;
  paidDate: string;
  amountVnd: number;
  note: string | null;
  kind?: 'actual' | 'seed';
};

type LedgerEntry = {
  id: number;
  type: LedgerType;
  label: string;
  entryDate: string;
  currency: Currency;
  amount: number;
  exchangeRate: number;
  amountVnd: number;
  note: string | null;
};

const today = new Date().toISOString().slice(0, 10);
const moneyVnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const moneyUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function normalizeDateInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) {
    const [, month, day, year] = mdy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  throw new Error(`Invalid date: ${value}`);
}

function formatVnd(value: number): string {
  return moneyVnd.format(value || 0);
}

function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const start = new Date(`${today}T00:00:00`).getTime();
  const end = new Date(`${dateIso}T00:00:00`).getTime();
  return Math.ceil((end - start) / 86_400_000);
}

function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function App() {
  if (!window.revenueTracker) {
    return (
      <div className="fatal-screen">
        <div className="panel fatal-panel">
          <h1>Revenue Tracker could not start</h1>
          <p>The secure Electron bridge did not load. Close the app and reopen it from the packaged executable or installer.</p>
        </div>
      </div>
    );
  }

  const [machines, setMachines] = useState<Machine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [exchangeRate, setExchangeRate] = useState(26000);
  const [activeView, setActiveView] = useState<'dashboard' | 'machines' | 'ledger' | 'settings'>('dashboard');
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [machineForm, setMachineForm] = useState({
    name: '',
    priceVnd: '',
    startDate: today,
    endDate: '',
    intervalCount: '1',
    intervalUnit: 'months' as IntervalUnit
  });
  const [bulkMachineText, setBulkMachineText] = useState('');
  const [ledgerForm, setLedgerForm] = useState({
    type: 'revenue' as LedgerType,
    label: '',
    entryDate: today,
    currency: 'USD' as Currency,
    amount: '',
    note: ''
  });
  const [status, setStatus] = useState('');

  async function refresh() {
    const [settings, machineRows, paymentRows, ledgerRows] = await Promise.all([
      window.revenueTracker.getSettings(),
      window.revenueTracker.listMachines(),
      window.revenueTracker.listPayments(),
      window.revenueTracker.listLedger()
    ]);
    setExchangeRate(settings.exchangeRate);
    setMachines(machineRows);
    setPayments(paymentRows);
    setLedger(ledgerRows);
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, []);

  const summary = useMemo(() => {
    const revenue = ledger.filter((entry) => entry.type === 'revenue').reduce((sum, entry) => sum + entry.amountVnd, 0);
    const expenses = ledger.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + entry.amountVnd, 0);
    const machinePaid = machines.reduce((sum, machine) => sum + machine.totalPaidVnd, 0);
    const upcoming = machines.filter((machine) => {
      const due = daysUntil(machine.nextDueDate);
      return due !== null && due <= 7;
    }).length;
    return { revenue, expenses, machinePaid, profit: revenue - expenses - machinePaid, upcoming };
  }, [ledger, machines]);

  const chartData = useMemo(() => {
    const buckets = new Map<string, { month: string; revenue: number; expenses: number; machineCost: number; profit: number }>();
    for (const entry of ledger) {
      const key = monthKey(entry.entryDate);
      const bucket = buckets.get(key) || { month: key, revenue: 0, expenses: 0, machineCost: 0, profit: 0 };
      if (entry.type === 'revenue') bucket.revenue += entry.amountVnd;
      else bucket.expenses += entry.amountVnd;
      buckets.set(key, bucket);
    }
    for (const payment of payments) {
      const key = monthKey(payment.paidDate);
      const bucket = buckets.get(key) || { month: key, revenue: 0, expenses: 0, machineCost: 0, profit: 0 };
      bucket.machineCost += payment.amountVnd;
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((bucket) => ({ ...bucket, profit: bucket.revenue - bucket.expenses - bucket.machineCost }));
  }, [ledger, payments]);

  function resetMachineForm() {
    setEditingMachine(null);
    setMachineForm({ name: '', priceVnd: '', startDate: today, endDate: '', intervalCount: '1', intervalUnit: 'months' });
  }

  async function saveMachine(event: React.FormEvent) {
    event.preventDefault();
    setStatus('');
    const payload = {
      id: editingMachine?.id,
      name: machineForm.name.trim(),
      priceVnd: Number(machineForm.priceVnd),
      startDate: normalizeDateInput(machineForm.startDate),
      endDate: machineForm.endDate ? normalizeDateInput(machineForm.endDate) : null,
      intervalCount: Number(machineForm.intervalCount),
      intervalUnit: machineForm.intervalUnit
    };
    if (!payload.name || payload.priceVnd <= 0 || payload.intervalCount <= 0) return;
    try {
      const saved = editingMachine
        ? await window.revenueTracker.updateMachine(payload)
        : await window.revenueTracker.createMachine(payload);
      setMachines((current) => {
        const withoutSaved = current.filter((machine) => machine.id !== saved.id);
        return [...withoutSaved, saved].sort((a, b) => {
          if (!a.nextDueDate) return 1;
          if (!b.nextDueDate) return -1;
          return a.nextDueDate.localeCompare(b.nextDueDate);
        });
      });
      resetMachineForm();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save machine');
    }
  }

  function parseBulkMachines() {
    return bulkMachineText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, priceVnd, startDate, endDate, intervalCount = '1', intervalUnit = 'months', forceCreatePayment = 'false'] = line
          .split(',')
          .map((part) => part.trim());
        return {
          name,
          priceVnd: Number(priceVnd),
          startDate: normalizeDateInput(startDate),
          endDate: endDate ? normalizeDateInput(endDate) : null,
          intervalCount: Number(intervalCount),
          intervalUnit: intervalUnit as IntervalUnit,
          forceCreatePayment: /^(true|1|yes|y)$/i.test(forceCreatePayment)
        };
      });
  }

  async function saveBulkMachines(event: React.FormEvent) {
    event.preventDefault();
    setStatus('');
    const machinesToCreate = parseBulkMachines();
    const validUnits = new Set(['days', 'weeks', 'months']);
    const invalidRow = machinesToCreate.find(
      (machine) =>
        !machine.name ||
        machine.priceVnd <= 0 ||
        !machine.startDate ||
        machine.intervalCount <= 0 ||
        !validUnits.has(machine.intervalUnit)
    );
    if (invalidRow || machinesToCreate.length === 0) {
      setStatus('Bulk format: Name, Price VND, Start date, First due date, Every, Unit, Force create payment');
      return;
    }
    try {
      await window.revenueTracker.bulkCreateMachines(machinesToCreate);
      setBulkMachineText('');
      await refresh();
      setStatus(`Added ${machinesToCreate.length} machines`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not bulk add machines');
    }
  }

  async function completeMachinePayment(machine: Machine) {
    setStatus('');
    try {
      const updatedMachine = await window.revenueTracker.markMachinePaid({ machineId: machine.id });
      setMachines((current) =>
        current
          .map((item) => (item.id === updatedMachine.id ? updatedMachine : item))
          .sort((a, b) => {
            if (!a.nextDueDate) return 1;
            if (!b.nextDueDate) return -1;
            return a.nextDueDate.localeCompare(b.nextDueDate);
          })
      );
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not complete payment');
    }
  }

  function editMachine(machine: Machine) {
    setEditingMachine(machine);
    setMachineForm({
      name: machine.name,
      priceVnd: String(machine.priceVnd),
      startDate: machine.startDate,
      endDate: machine.endDate || '',
      intervalCount: String(machine.intervalCount),
      intervalUnit: machine.intervalUnit
    });
  }

  async function saveLedger(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(ledgerForm.amount);
    if (!ledgerForm.label.trim() || amount <= 0) return;
    await window.revenueTracker.createLedgerEntry({
      type: ledgerForm.type,
      label: ledgerForm.label.trim(),
      entryDate: ledgerForm.entryDate,
      currency: ledgerForm.currency,
      amount,
      exchangeRate,
      note: ledgerForm.note.trim() || null
    });
    setLedgerForm({ type: 'revenue', label: '', entryDate: today, currency: 'USD', amount: '', note: '' });
    await refresh();
  }

  async function updateRate(event: React.FormEvent) {
    event.preventDefault();
    await window.revenueTracker.updateSettings({ exchangeRate });
    setStatus('Exchange rate updated');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={22} /></div>
          <div>
            <strong>Revenue Tracker</strong>
            <span>Local desktop ledger</span>
          </div>
        </div>
        <nav>
          <button className={activeView === 'dashboard' ? 'active' : ''} onClick={() => setActiveView('dashboard')}>
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button className={activeView === 'machines' ? 'active' : ''} onClick={() => setActiveView('machines')}>
            <CalendarClock size={18} /> Machines
          </button>
          <button className={activeView === 'ledger' ? 'active' : ''} onClick={() => setActiveView('ledger')}>
            <DollarSign size={18} /> Revenue
          </button>
          <button className={activeView === 'settings' ? 'active' : ''} onClick={() => setActiveView('settings')}>
            <Settings size={18} /> Settings
          </button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{activeView === 'dashboard' ? 'Dashboard' : activeView === 'machines' ? 'Machine Payments' : activeView === 'ledger' ? 'Revenue & Expenses' : 'Settings'}</h1>
            <p>All values report in Vietnamese dong. USD revenue uses the current fixed exchange rate.</p>
          </div>
          <div className="rate-pill">1 USD = {exchangeRate.toLocaleString('vi-VN')} VND</div>
        </header>

        {status && <div className="notice">{status}</div>}

        {activeView === 'dashboard' && (
          <>
            <section className="metric-grid">
              <Metric title="Revenue" value={formatVnd(summary.revenue)} />
              <Metric title="Expenses" value={formatVnd(summary.expenses)} />
              <Metric title="Machine paid" value={formatVnd(summary.machinePaid)} />
              <Metric title="Net profit" value={formatVnd(summary.profit)} tone={summary.profit >= 0 ? 'good' : 'bad'} />
              <Metric title="Due within 7 days" value={String(summary.upcoming)} />
            </section>
            <section className="dashboard-grid">
              <div className="panel wide">
                <PanelTitle icon={<Activity size={18} />} title="Monthly performance" />
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c7" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}m`} />
                      <Tooltip formatter={(value) => formatVnd(Number(value))} />
                      <Line type="monotone" dataKey="revenue" stroke="#287271" strokeWidth={3} />
                      <Line type="monotone" dataKey="profit" stroke="#b3432f" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="panel">
                <PanelTitle icon={<CalendarClock size={18} />} title="Nearest due machines" />
                <div className="compact-list">
                  {machines.slice(0, 6).map((machine) => (
                    <div key={machine.id} className="compact-row">
                      <span>{machine.name}</span>
                      <strong>{machine.nextDueDate || 'Finished'}</strong>
                    </div>
                  ))}
                  {machines.length === 0 && <Empty text="No machines added yet." />}
                </div>
              </div>
            </section>
          </>
        )}

        {activeView === 'machines' && (
          <section className="work-grid">
            <form className="panel form-panel" onSubmit={saveMachine}>
              <PanelTitle icon={<Wrench size={18} />} title={editingMachine ? 'Edit machine' : 'Add machine'} />
              <label>Name<input value={machineForm.name} onChange={(event) => setMachineForm({ ...machineForm, name: event.target.value })} required /></label>
              <label>Price VND<input type="number" min="1" value={machineForm.priceVnd} onChange={(event) => setMachineForm({ ...machineForm, priceVnd: event.target.value })} required /></label>
              <div className="split">
                <label>Start date<input type="date" value={machineForm.startDate} onChange={(event) => setMachineForm({ ...machineForm, startDate: event.target.value })} required /></label>
                <label>First due date<input type="date" value={machineForm.endDate} onChange={(event) => setMachineForm({ ...machineForm, endDate: event.target.value })} /></label>
              </div>
              <div className="split">
                <label>Every<input type="number" min="1" value={machineForm.intervalCount} onChange={(event) => setMachineForm({ ...machineForm, intervalCount: event.target.value })} required /></label>
                <label>Unit<select value={machineForm.intervalUnit} onChange={(event) => setMachineForm({ ...machineForm, intervalUnit: event.target.value as IntervalUnit })}>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select></label>
              </div>
              <div className="button-row">
                <button className="primary" type="submit"><Plus size={16} /> {editingMachine ? 'Save' : 'Add'}</button>
                {editingMachine && <button type="button" onClick={resetMachineForm}>Cancel</button>}
              </div>
            </form>

            <div className="panel table-panel">
              <PanelTitle icon={<CalendarClock size={18} />} title="Due table" />
              <div className="table-scroll due-table-scroll">
                <table>
                  <thead>
                    <tr><th>Machine</th><th>Next due</th><th>Price</th><th>Paid</th><th>Total paid</th><th></th></tr>
                  </thead>
                  <tbody>
                    {machines.map((machine) => {
                      const due = daysUntil(machine.nextDueDate);
                      return (
                        <tr key={machine.id}>
                          <td>{machine.name}</td>
                          <td><span className={due !== null && due <= 7 ? 'tag urgent' : 'tag'}>{machine.nextDueDate || 'Finished'}</span></td>
                          <td>{formatVnd(machine.priceVnd)}</td>
                          <td>{machine.paymentCount}</td>
                          <td>{formatVnd(machine.totalPaidVnd)}</td>
                          <td>
                            <div className="row-actions">
                              <button type="button" title="Complete payment" onClick={() => completeMachinePayment(machine)} disabled={!machine.nextDueDate}><Check size={16} /></button>
                              <button type="button" title="Rename or edit" onClick={() => editMachine(machine)}><Pencil size={16} /></button>
                              <button type="button" title="Delete" onClick={async () => { await window.revenueTracker.deleteMachine(machine.id); await refresh(); }}><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {machines.length === 0 && <Empty text="Add the first machine to start tracking due dates." />}
            </div>

            <form className="panel form-panel" onSubmit={saveBulkMachines}>
              <PanelTitle icon={<Plus size={18} />} title="Bulk add machines" />
              <label>
                One machine per line
                <textarea
                  value={bulkMachineText}
                  onChange={(event) => setBulkMachineText(event.target.value)}
                  placeholder="Machine A, 500000, 2026-06-01, 2026-06-08, 1, weeks"
                />
              </label>
              <button className="primary" type="submit"><Plus size={16} /> Bulk add</button>
            </form>

            <div className="panel table-panel span-all">
              <PanelTitle icon={<Check size={18} />} title="Payment history" />
              <table>
                <thead><tr><th>Paid date</th><th>Due date</th><th>Machine</th><th>Status</th><th>Amount</th><th>Note</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{payment.paidDate}</td>
                      <td>{payment.dueDate}</td>
                      <td>{payment.machineName}</td>
                      <td><span className={`tag ${payment.kind === 'seed' ? 'urgent' : 'revenue'}`}>{payment.kind === 'seed' ? 'Historical' : 'Paid'}</span></td>
                      <td>{formatVnd(payment.amountVnd)}</td>
                      <td>{payment.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payments.length === 0 && <Empty text="No machine payments recorded yet." />}
            </div>
          </section>
        )}

        {activeView === 'ledger' && (
          <section className="work-grid">
            <form className="panel form-panel" onSubmit={saveLedger}>
              <PanelTitle icon={<DollarSign size={18} />} title="Add entry" />
              <div className="segmented">
                <button type="button" className={ledgerForm.type === 'revenue' ? 'selected' : ''} onClick={() => setLedgerForm({ ...ledgerForm, type: 'revenue' })}>Revenue</button>
                <button type="button" className={ledgerForm.type === 'expense' ? 'selected' : ''} onClick={() => setLedgerForm({ ...ledgerForm, type: 'expense' })}>Expense</button>
              </div>
              <label>Label<input value={ledgerForm.label} onChange={(event) => setLedgerForm({ ...ledgerForm, label: event.target.value })} required /></label>
              <div className="split">
                <label>Date<input type="date" value={ledgerForm.entryDate} onChange={(event) => setLedgerForm({ ...ledgerForm, entryDate: event.target.value })} required /></label>
                <label>Currency<select value={ledgerForm.currency} onChange={(event) => setLedgerForm({ ...ledgerForm, currency: event.target.value as Currency })}>
                  <option value="USD">USD</option>
                  <option value="VND">VND</option>
                </select></label>
              </div>
              <label>Amount<input type="number" min="0" step="0.01" value={ledgerForm.amount} onChange={(event) => setLedgerForm({ ...ledgerForm, amount: event.target.value })} required /></label>
              <label>Note<input value={ledgerForm.note} onChange={(event) => setLedgerForm({ ...ledgerForm, note: event.target.value })} /></label>
              <button className="primary" type="submit"><Plus size={16} /> Add entry</button>
            </form>
            <div className="panel table-panel">
              <PanelTitle icon={<Activity size={18} />} title="Revenue chart" />
              <div className="chart small">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ddd6c7" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}m`} />
                    <Tooltip formatter={(value) => formatVnd(Number(value))} />
                    <Bar dataKey="revenue" fill="#287271" />
                    <Bar dataKey="expenses" fill="#c06a4b" />
                    <Bar dataKey="machineCost" fill="#725a7a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel table-panel span-all">
              <PanelTitle icon={<DollarSign size={18} />} title="Ledger" />
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Label</th><th>Original</th><th>VND</th><th>Note</th><th></th></tr></thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.entryDate}</td>
                      <td><span className={`tag ${entry.type}`}>{entry.type}</span></td>
                      <td>{entry.label}</td>
                      <td>{entry.currency === 'USD' ? moneyUsd.format(entry.amount) : formatVnd(entry.amount)}</td>
                      <td>{formatVnd(entry.amountVnd)}</td>
                      <td>{entry.note || ''}</td>
                      <td className="row-actions"><button title="Delete" onClick={async () => { await window.revenueTracker.deleteLedgerEntry(entry.id); await refresh(); }}><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.length === 0 && <Empty text="No revenue or expense entries yet." />}
            </div>
          </section>
        )}

        {activeView === 'settings' && (
          <section className="settings-layout">
            <form className="panel form-panel" onSubmit={updateRate}>
              <PanelTitle icon={<Settings size={18} />} title="Exchange rate" />
              <label>VND per USD<input type="number" min="1" value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value))} /></label>
              <button className="primary" type="submit"><Check size={16} /> Save rate</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="panel-title">{icon}<h2>{title}</h2></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
