import { LOOKS, type Look } from '@/game/art/characters';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const shade = (c: number, f: number) => hex((Math.min(255, Math.round(((c >> 16) & 255) * f)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((c & 255) * f)));

/**
 * Painted bust portrait of a merchant, drawn from the same look data as the
 * in-world sprite so a merchant's face matches what walks around town.
 */
export function Portrait({ id, role, size = 40, mood }: { id: string; role: string; size?: number; mood?: 'active' | 'struggling' | 'bankrupt' }) {
  const look: Look = LOOKS[id] ?? LOOKS[role] ?? LOOKS.trader;
  const skin = hex(look.skin), hair = hex(look.hair), tunic = hex(look.tunic);
  const sad = mood === 'struggling' || mood === 'bankrupt';
  const gid = `pg-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={`${id} portrait`} style={{ filter: mood === 'bankrupt' ? 'grayscale(0.85)' : undefined }}>
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={shade(look.tunic, 1.5)} />
          <stop offset="1" stopColor={shade(look.tunic, 0.45)} />
        </radialGradient>
        <clipPath id={`${gid}-c`}><circle cx="24" cy="24" r="21" /></clipPath>
      </defs>
      <circle cx="24" cy="24" r="23" fill="#1a120b" />
      <circle cx="24" cy="24" r="21.5" fill={`url(#${gid})`} stroke="#d9a84a" strokeWidth="1.5" />
      <g clipPath={`url(#${gid}-c)`}>
        {look.cape && <path d="M6 48c1-11 7-16 18-16s17 5 18 16Z" fill={hex(look.cape)} />}
        <path d="M9 48c1-9 6-13 15-13s14 4 15 13Z" fill={tunic} />
        <path d="M24 35c4 0 8 1 10 3l-10 10-10-10c2-2 6-3 10-3Z" fill={shade(look.tunic, 0.75)} />
        {look.apron && <path d="M17 39h14v9H17Z" fill={hex(look.apron)} />}
        <rect x="20.5" y="29" width="7" height="7" rx="2" fill={shade(look.skin, 0.85)} />
        <ellipse cx="24" cy="22" rx="8.6" ry="9.6" fill={skin} />
        <ellipse cx="26.5" cy="24" rx="5" ry="6" fill={shade(look.skin, 0.9)} opacity="0.5" />
        <path d="M15.4 20c0-6 4-9.5 8.6-9.5s8.6 3.5 8.6 9.5c-2-3-5-4.6-8.6-4.6S17.4 17 15.4 20Z" fill={hair} />
        {look.beard && <path d="M16.4 24c.6 7 3.6 10 7.6 10s7-3 7.6-10c-1.6 2.6-4.4 3.4-7.6 3.4s-6-.8-7.6-3.4Z" fill={hair} />}
        <ellipse cx="20.6" cy="22.4" rx="1.2" ry={sad ? 0.8 : 1.3} fill="#1a120c" />
        <ellipse cx="27.4" cy="22.4" rx="1.2" ry={sad ? 0.8 : 1.3} fill="#1a120c" />
        {sad && <path d="M18.6 19.6l3.4 1M29.4 19.6l-3.4 1" stroke="#2a1a10" strokeWidth="0.9" strokeLinecap="round" />}
        <circle cx="18.6" cy="26" r="1.6" fill="#d27a6a" opacity="0.35" />
        <circle cx="29.4" cy="26" r="1.6" fill="#d27a6a" opacity="0.35" />
        {!look.beard && <path d={sad ? 'M21.6 28.6q2.4-1.6 4.8 0' : 'M21.4 27.4q2.6 2 5.2 0'} stroke="#7a3a2a" strokeWidth="1" fill="none" strokeLinecap="round" />}
        <Hat look={look} />
      </g>
    </svg>
  );
}

function Hat({ look }: { look: Look }) {
  const accent = hex(look.accent);
  switch (look.hat) {
    case 'straw': return (<g><ellipse cx="24" cy="15" rx="15" ry="3.6" fill="#e3c46a" /><path d="M17 15c0-4 3-6.5 7-6.5s7 2.5 7 6.5Z" fill="#d4b25a" /><rect x="17" y="13" width="14" height="1.8" fill="#b5452e" /></g>);
    case 'toque': return (<g><rect x="16.5" y="9" width="15" height="6" fill="#f6f2ea" /><circle cx="19" cy="7" r="4" fill="#fff" /><circle cx="29" cy="7" r="4" fill="#fff" /><circle cx="24" cy="5" r="4.6" fill="#fff" /><rect x="16.5" y="13.4" width="15" height="2" fill="#dcd6cc" /></g>);
    case 'cap': return (<g><path d="M15.6 16c0-5 3.8-7.6 8.4-7.6s8.4 2.6 8.4 7.6Z" fill="#2f6f7f" /><path d="M24 15.4h12.4v2.2H24Z" fill="#23525e" /></g>);
    case 'hood': return (<path d="M12 30c-1-13 4-21 12-21s13 8 12 21c-1-6-3-10-4-11-2 3-5 4-8 4s-6-1-8-4c-1 1-3 5-4 11Z" fill={hex(look.cape ?? look.tunic)} />);
    case 'tophat': return (<g><rect x="17" y="1" width="14" height="13" fill="#1d1d24" /><rect x="13" y="13" width="22" height="3" rx="1.4" fill="#1d1d24" /><rect x="17" y="10.6" width="14" height="2" fill="#d9a84a" /></g>);
    case 'helmet': return (<g><path d="M14.6 17c0-6 4.2-9.6 9.4-9.6s9.4 3.6 9.4 9.6Z" fill="#8a7a52" /><circle cx="24" cy="12" r="2.6" fill="#ffe08a" /></g>);
    case 'scarf': return (<path d="M14.6 21c-.4-7 3.6-11.6 9.4-11.6s9.8 4.6 9.4 11.6c-1.6-4-5-6.4-9.4-6.4s-7.8 2.4-9.4 6.4Z" fill="#8b4f87" />);
    case 'kerchief': return (<path d="M15.4 17c0-5 3.8-7.8 8.6-7.8s8.6 2.8 8.6 7.8Z" fill="#7a2a1a" />);
    case 'beret': return (<ellipse cx="22.6" cy="12.6" rx="9" ry="3.6" fill={accent} />);
    default: return null;
  }
}
