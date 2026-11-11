import type { SVGProps } from 'react';

/** Hand-drawn style resource and UI icons (original SVG, no external assets). */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20, rest: SVGProps<SVGSVGElement>) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', ...rest });

export function ResourceIcon({ r, size = 20, ...rest }: P & { r: string }) {
  const s = base(size, rest);
  switch (r) {
    case 'wheat':
      return (<svg {...s}><path d="M12 22V8" stroke="#c99a3c" strokeWidth="1.6" strokeLinecap="round" /><g fill="#f0c45a">{[0, 1, 2, 3].map((i) => (<g key={i}><ellipse cx="9.6" cy={6 + i * 3.2} rx="2.2" ry="1.2" transform={`rotate(-35 9.6 ${6 + i * 3.2})`} /><ellipse cx="14.4" cy={6 + i * 3.2} rx="2.2" ry="1.2" transform={`rotate(35 14.4 ${6 + i * 3.2})`} /></g>))}<ellipse cx="12" cy="4" rx="1.3" ry="2" /></g></svg>);
    case 'bread':
      return (<svg {...s}><path d="M3 14c0-4.5 4-8 9-8s9 3.5 9 8c0 2.2-1.6 3.5-3.5 3.5h-11C4.6 17.5 3 16.2 3 14Z" fill="#c9823f" /><path d="M3.6 12.5C5 9 8.2 7 12 7s7 2 8.4 5.5" stroke="#e8a85a" strokeWidth="1.4" /><path d="M8 9.5l1.2 2.5M12 8.5v2.8M16 9.5l-1.2 2.5" stroke="#f6d39a" strokeWidth="1.3" strokeLinecap="round" /></svg>);
    case 'wood':
      return (<svg {...s}><rect x="3" y="12" width="15" height="5" rx="2.5" fill="#8a5a33" /><rect x="6" y="7" width="15" height="5" rx="2.5" fill="#a06a3c" /><circle cx="18.5" cy="9.5" r="2.5" fill="#e2b989" /><circle cx="18.5" cy="9.5" r="1" stroke="#a06a3c" /><circle cx="15.5" cy="14.5" r="2.5" fill="#d8ac7a" /></svg>);
    case 'iron':
      return (<svg {...s}><path d="M4 16l3-6h10l3 6H4Z" fill="#8c95a0" /><path d="M7 10h10l-1.2-2.5H8.2L7 10Z" fill="#b8c0ca" /><path d="M5.5 14h13" stroke="#6b737d" strokeWidth="1" /></svg>);
    case 'coal':
      return (<svg {...s}><path d="M5 15l2.5-5 4 1.5 3-3 4.5 4L17 18H7l-2-3Z" fill="#2b2b30" /><path d="M8 11.5l2 3M14.5 9l1 4" stroke="#55555e" strokeWidth="1" /></svg>);
    case 'stone':
      return (<svg {...s}><path d="M3 17l2-6 5-2 6 1 4 4-1 4H3Z" fill="#9a958c" /><path d="M5 11l4 2 7-3M9 13l1 5" stroke="#7a756e" strokeWidth="1" /></svg>);
    case 'tools':
      return (<svg {...s}><path d="M5 19l9-9" stroke="#8a5a33" strokeWidth="2.4" strokeLinecap="round" /><path d="M13 5.5a3.5 3.5 0 0 0 5.5 4.3L20 11l-2 2-1.5-1.5A3.5 3.5 0 0 0 12.2 6l.8-.5Z" fill="#b8c0ca" /><path d="M16 17l3 3" stroke="#6b737d" strokeWidth="2" strokeLinecap="round" /></svg>);
    case 'livestock':
      return (<svg {...s}><ellipse cx="12" cy="13" rx="7" ry="5" fill="#efe6d6" /><circle cx="18.5" cy="10" r="3" fill="#d8cbb4" /><circle cx="19.4" cy="9.6" r=".7" fill="#2c2218" /><path d="M8 17.5v2.5M11 18v2M14 18v2M16.5 17.5V20" stroke="#5d4330" strokeWidth="1.4" strokeLinecap="round" /><circle cx="8.5" cy="11.5" r="1.5" fill="#fff" /><circle cx="12" cy="10.5" r="1.6" fill="#fff" /></svg>);
    case 'fish':
      return (<svg {...s}><path d="M3 12c3-4 9-5 13-2l4-3v10l-4-3c-4 3-10 2-13-2Z" fill="#6aa3c8" /><circle cx="7.5" cy="11" r="1" fill="#0e0b08" /><path d="M10 9.5c1 1.5 1 3.5 0 5" stroke="#bfe6ff" strokeWidth="1" /></svg>);
    case 'cloth':
      return (<svg {...s}><path d="M4 6h12a3 3 0 0 1 3 3v9H7a3 3 0 0 1-3-3V6Z" fill="#9b6fb5" /><path d="M16 6a3 3 0 0 1 3 3H16V6Z" fill="#7d4f9a" /><path d="M6 9h9M6 12h9M6 15h9" stroke="#c6a6dc" strokeWidth=".9" /></svg>);
    case 'weapons':
      return (<svg {...s}><path d="M16.5 3.5L20 4l.5 3.5L9 19l-3-3L16.5 3.5Z" fill="#c9d1da" /><path d="M5 14.5l4.5 4.5M4 20l3-3" stroke="#8a5a33" strokeWidth="2.2" strokeLinecap="round" /><path d="M12.5 8l3.5 3.5" stroke="#8c95a0" strokeWidth="1" /></svg>);
    case 'flour':
      return (<svg {...s}><path d="M7 7.5c0-1.5 2.2-2.5 5-2.5s5 1 5 2.5L18.5 19c0 1-2.9 2-6.5 2s-6.5-1-6.5-2L7 7.5Z" fill="#efe6d2" /><path d="M7.2 7.6c1.2 1 3 1.4 4.8 1.4s3.6-.4 4.8-1.4" stroke="#b9a988" strokeWidth="1.2" /><path d="M9.5 13.5h5M10 16h4" stroke="#c9b48a" strokeWidth="1.1" strokeLinecap="round" /><ellipse cx="12" cy="5.6" rx="2.2" ry=".9" fill="#fff" /></svg>);
    case 'planks':
      return (<svg {...s}><path d="M3 15.5l9-5 9 5-9 5-9-5Z" fill="#c9965c" /><path d="M3 12.5l9-5 9 5-9 5-9-5Z" fill="#deae72" /><path d="M7.5 10l9 5M5.2 11.3l9 5" stroke="#a87642" strokeWidth=".9" /><path d="M3 12.5v3l9 5v-3M21 12.5v3l-9 5" stroke="#8a5e33" strokeWidth=".9" fill="none" /></svg>);
    case 'steel':
      return (<svg {...s}><path d="M4 15l4-6h12l-4 6H4Z" fill="#d4dde6" /><path d="M4 15v3h12v-3M16 18l4-6v-3" fill="#9aa7b4" stroke="#7d8996" strokeWidth=".8" /><path d="M8.5 11h8" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity=".8" /></svg>);
    case 'ale':
      return (<svg {...s}><path d="M6 7h10v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Z" fill="#d99a35" /><path d="M16 9.5h2a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2" stroke="#8a5a2a" strokeWidth="1.8" fill="none" /><path d="M5.5 7.5c0-2 1.5-3 3-2.6.6-1.3 2.4-1.6 3.4-.6 1-.8 3.1-.2 3.4 1.3 1 .3 1.2 1.2.7 1.9H5.5Z" fill="#fff6e2" /><path d="M9 11v7M13 11v7" stroke="#b97a22" strokeWidth="1" /></svg>);
    case 'furniture':
      return (<svg {...s}><path d="M5 10h14v3H5z" fill="#a76b3c" /><path d="M6 13h2v7H6zM16 13h2v7h-2z" fill="#7d4c28" /><path d="M7 4h10v6H7z" fill="#c08550" /><path d="M9 6h6M9 8h6" stroke="#8a5530" strokeWidth=".9" /></svg>);
    default:
      return (<svg {...s}><circle cx="12" cy="12" r="7" fill="#d9a84a" /></svg>);
  }
}

export const Coin = ({ size = 16, ...rest }: P) => (
  <svg {...base(size, rest)}><circle cx="12" cy="12" r="9" fill="#f4c96b" /><circle cx="12" cy="12" r="6.5" fill="#d9a84a" stroke="#8f6a24" strokeWidth="1" /><path d="M12 8.5v7M9.8 10.2h3.6a1.3 1.3 0 0 1 0 2.6H10.6a1.3 1.3 0 0 0 0 2.6h3.6" stroke="#5a3f12" strokeWidth="1.2" strokeLinecap="round" /></svg>
);

const line = (d: string) =>
  function Icon({ size = 20, ...rest }: P) {
    return (<svg {...base(size, rest)} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>);
  };

export const IconBag = line('M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2');
export const IconEmpire = line('M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M12 5V2M10.5 2.5h3');
export const IconMap = line('M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14');
export const IconScale = line('M12 4v16M5 20h14M4 9l3-5 3 5a3 3 0 0 1-6 0Zm10 0l3-5 3 5a3 3 0 0 1-6 0ZM7 4h10');
export const IconPeople = line('M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.5M18 20a6 6 0 0 0-3-5.2');
export const IconHouse = line('M4 11l8-6 8 6v9H4v-9Zm6 9v-5h4v5');
export const IconChart = line('M4 19h16M6 15l4-5 3 3 5-7');
export const IconScroll = line('M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3V6M5 6a2 2 0 0 1 4 0v11M12 9h4M12 13h4');
export const IconCrown = line('M4 8l4 4 4-6 4 6 4-4-2 11H6L4 8Z');
export const IconMedal = line('M8 3l4 6 4-6M12 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-7v3');
export const IconWallet = line('M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7Zm0 0l11-3v3M16 13.5h.01');
export const IconGear = line('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z');
export const IconFast = line('M4 6l7 6-7 6V6Zm9 0l7 6-7 6V6Z');
export const IconClose = line('M6 6l12 12M18 6L6 18');
export const IconPlus = line('M12 5v14M5 12h14');
export const IconMinus = line('M5 12h14');
export const IconSpark = line('M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6');
export const IconChat = line('M5 5h14v10H9l-4 4V5Z');
export const IconSound = line('M4 10v4h4l5 4V6L8 10H4Zm12-1.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12');
export const IconMute = line('M4 10v4h4l5 4V6L8 10H4Zm12 0 5 5m0-5-5 5');
export const IconExternal = line('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6');

export function WeatherIcon({ w, size = 18 }: { w: string; size?: number }) {
  const s = base(size, {});
  if (w === 'clear') return (<svg {...s}><circle cx="12" cy="12" r="4.5" fill="#f4c96b" /><g stroke="#f4c96b" strokeWidth="1.6" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} d="M12 3v2" transform={`rotate(${a} 12 12)`} />)}</g></svg>);
  if (w === 'heatwave') return (<svg {...s}><circle cx="12" cy="11" r="5" fill="#f08a3c" /><path d="M5 19c2-1.5 4 1.5 7 0s5 1.5 7 0" stroke="#f08a3c" strokeWidth="1.5" /></svg>);
  const cloud = <path d="M7 16a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 17 16H7Z" fill="#c9b895" />;
  if (w === 'cloudy') return <svg {...s}>{cloud}</svg>;
  if (w === 'rain') return (<svg {...s}>{cloud}<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="#6aa3c8" strokeWidth="1.6" strokeLinecap="round" /></svg>);
  if (w === 'storm') return (<svg {...s}>{cloud}<path d="M12 16l-2 4h3l-1.5 3" stroke="#f4c96b" strokeWidth="1.6" strokeLinejoin="round" /></svg>);
  return (<svg {...s}>{cloud}<g fill="#fff"><circle cx="9" cy="19" r="1.2" /><circle cx="13" cy="21" r="1.2" /><circle cx="16" cy="18.5" r="1.2" /></g></svg>);
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M24 3l19 11v20L24 45 5 34V14L24 3Z" fill="#1a140f" stroke="#d9a84a" strokeWidth="2" />
      <path d="M14 30V18l10 12V18M34 18v12" stroke="#f4c96b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34" cy="14.5" r="2" fill="#00ec97" />
    </svg>
  );
}
export const IconDice = line('M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3.5 4h.01M15.5 8h.01M12 12h.01M8.5 16h.01M15.5 16h.01');
export const IconHorse = line('M5 20l2-6c-1-2 0-5 3-6l2-4 1 3c3 0 6 2 6 6v7M10 8l-4 3 1 2M14 20v-4');
