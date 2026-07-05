import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import PostgresAdapter from '@auth/pg-adapter';
import { pool } from '@/lib/db';

// Only enable the providers whose credentials are present, so the app builds
// and runs even before any OAuth apps are configured.
const providers: unknown[] = [];
if (process.env.AUTH_GOOGLE_ID) providers.push(Google);
if (process.env.AUTH_GITHUB_ID) providers.push(GitHub);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: pool ? PostgresAdapter(pool) : undefined,
  // Database sessions when a DB is present; harmless JWT fallback otherwise.
  session: { strategy: pool ? 'database' : 'jwt' },
  trustHost: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers: providers as any,
  callbacks: {
    session({ session, user }) {
      // Expose the user id to the client/session so the state API can key on it.
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    }
  }
});
