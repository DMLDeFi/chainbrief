'use client';
import { useRef, useState } from 'react';

const R = 52;

/** A thumbstick for touch screens: drag inside the ring to walk; push to the edge to run. */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const centre = useRef({ x: 0, y: 0 });

  const move = (cx: number, cy: number) => {
    let dx = cx - centre.current.x, dy = cy - centre.current.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    setKnob({ x: dx, y: dy });
    onMove(dx / R, dy / R);
  };
  const end = () => { id.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0); };

  return (
    <div
      className="pointer-events-auto relative touch-none select-none rounded-full border-2 border-brass/50 bg-black/35 backdrop-blur-sm"
      style={{ width: R * 2 + 20, height: R * 2 + 20 }}
      onPointerDown={(e) => {
        if (id.current !== null) return;
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        centre.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => e.pointerId === id.current && move(e.clientX, e.clientY)}
      onPointerUp={(e) => e.pointerId === id.current && end()}
      onPointerCancel={(e) => e.pointerId === id.current && end()}
      aria-label="Walk joystick"
      role="application"
    >
      <div className="absolute inset-3 rounded-full border border-brass/25" />
      <div className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full border-2 border-[#8a5f1c] shadow-lg"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`, background: 'radial-gradient(circle at 35% 30%, #ffe29a, #c9a227 60%, #8a5f1c)' }} />
    </div>
  );
}
