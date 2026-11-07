import { Suspense } from 'react';
import { RegisterForm } from './RegisterForm';
export const metadata = { title: 'Join Nearhaven — Merchants of NEAR' };
export default function Register() {
  return <Suspense><RegisterForm /></Suspense>;
}
