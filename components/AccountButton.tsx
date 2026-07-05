'use client';

import { useEffect, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

/**
 * Sign-in / account chip. Renders nothing until it knows which OAuth providers
 * are configured, and stays hidden entirely if the account system is disabled
 * (no secrets set) — so the game looks normal before the DB is provisioned.
 */
export default function AccountButton() {
  const { data: session, status } = useSession();
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (alive) setProviders(p ? Object.keys(p) : []);
      })
      .catch(() => {
        if (alive) setProviders([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Loading, or accounts not configured → show nothing.
  if (!providers || providers.length === 0) return null;

  if (status === 'authenticated' && session?.user) {
    return (
      <div style={wrap}>
        {session.user.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" style={avatar} />
        )}
        <span style={name}>{session.user.name ?? 'Player'}</span>
        <button style={btn} onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {providers.includes('google') && (
        <button style={btn} onClick={() => signIn('google')}>
          Sign in with Google
        </button>
      )}
      {providers.includes('github') && (
        <button style={btn} onClick={() => signIn('github')}>
          Sign in with GitHub
        </button>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  top: 18,
  right: 18,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 12,
  background: 'rgba(8, 14, 24, 0.72)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#e8eef7',
  fontSize: 13,
  fontWeight: 600
};

const btn: React.CSSProperties = {
  cursor: 'pointer',
  border: 'none',
  borderRadius: 8,
  padding: '7px 12px',
  background: '#ffcf33',
  color: '#20160a',
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: 0.2
};

const avatar: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  objectFit: 'cover'
};

const name: React.CSSProperties = { maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
