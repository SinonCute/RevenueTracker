/// <reference types="vite/client" />

import type { RevenueTrackerApi } from '../electron/preload';

declare global {
  interface Window {
    revenueTracker: RevenueTrackerApi;
  }
}
