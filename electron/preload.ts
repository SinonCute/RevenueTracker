import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload: { exchangeRate: number }) => ipcRenderer.invoke('settings:update', payload),
  listMachines: () => ipcRenderer.invoke('machines:list'),
  createMachine: (payload: unknown) => ipcRenderer.invoke('machines:create', payload),
  bulkCreateMachines: (payload: unknown) => ipcRenderer.invoke('machines:bulkCreate', payload),
  updateMachine: (payload: unknown) => ipcRenderer.invoke('machines:update', payload),
  deleteMachine: (id: number) => ipcRenderer.invoke('machines:delete', id),
  markMachinePaid: (payload: { machineId: number; paidDate?: string; note?: string }) => ipcRenderer.invoke('payments:pay', payload),
  listPayments: () => ipcRenderer.invoke('payments:list'),
  listLedger: () => ipcRenderer.invoke('ledger:list'),
  createLedgerEntry: (payload: unknown) => ipcRenderer.invoke('ledger:create', payload),
  deleteLedgerEntry: (id: number) => ipcRenderer.invoke('ledger:delete', id)
};

contextBridge.exposeInMainWorld('revenueTracker', api);

export type RevenueTrackerApi = typeof api;
