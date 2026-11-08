/**
 * Tiny UI-effects bus: panels announce "goods moved" moments and the FlyLayer
 * animates icons from the button that caused them to the HUD element that
 * receives them (Inventory dock button for goods, the gold purse for coins).
 */
export interface FlyEvent { kind: 'goods' | 'coins'; resource?: string; from: { x: number; y: number }; count: number }
type Listener = (e: FlyEvent) => void;
const listeners = new Set<Listener>();

export function onFly(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function fly(e: FlyEvent) {
  for (const l of listeners) l(e);
}

/** Centre of an element (or of the focused element) for use as a fly origin. */
export function originOf(el?: Element | null) {
  const t = el ?? (typeof document !== 'undefined' ? document.activeElement : null);
  if (!t) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = t.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
