import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** True only after hydration — for UI that depends on browser-only state. */
export function useMounted() {
  return useSyncExternalStore(noop, () => true, () => false);
}
