import { Suspense } from 'react';
import { Intro } from './Intro';
export const metadata = { title: 'The Road to Nearhaven — Merchants of NEAR' };
export default function Page() { return <Suspense><Intro /></Suspense>; }
