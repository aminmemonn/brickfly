'use client';

import { SessionProvider } from 'next-auth/react';

/** Wraps the app so client components can read the signed-in session. */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
