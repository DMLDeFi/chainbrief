export interface Alert { id: string; asset: string; dir: "above" | "below"; target: number; fired?: boolean }
interface State { alerts: Alert[]; toast: string | null }

const KEY = "oilhood.alerts.v1";
const EMPTY: State = { alerts: [], toast: null };
let state: State | null = null;
const listeners = new Set<() => void>();

function read(): State {
  if (state) return state;
  try {
    state = { alerts: JSON.parse(localStorage.getItem(KEY) || "[]"), toast: null };
  } catch {
    state = { alerts: [], toast: null };
  }
  return state;
}

/** Browser-local store for price alerts, consumed with useSyncExternalStore. */
export const alertsStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: read,
  getServer: () => EMPTY,
  set(update: (s: State) => State) {
    state = update(read());
    try { localStorage.setItem(KEY, JSON.stringify(state.alerts)); } catch { /* storage unavailable */ }
    listeners.forEach((l) => l());
  },
};
