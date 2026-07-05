# BrickFly Accounts & Cloud Save — Setup

The account system lets players sign in with **Google** or **GitHub** and syncs their
landmark collection, flight stats, and settings to a **Neon Postgres** database.

**The game works with none of this configured** — sign-in just stays hidden until you
finish these steps. Do them in order; each is a few minutes.

---

## 1. Create the database (Neon)

Easiest via Vercel:

1. Vercel → your project → **Storage** → **Create Database** → **Neon** (Postgres).
2. Follow the prompts. Vercel auto-adds a `DATABASE_URL` env var to the project.
3. Open the **Neon dashboard → SQL Editor** and run the contents of [`schema.sql`](./schema.sql)
   (creates the Auth.js tables + the `game_state` table).

> Prefer doing it by hand? Grab the **pooled** connection string from Neon and set it as
> `DATABASE_URL` yourself (see `.env.example`), then run:
> `psql "$DATABASE_URL" -f schema.sql`

## 2. Generate the auth secret

```bash
npx auth secret        # prints AUTH_SECRET, or:
openssl rand -base64 33
```

Set it as **`AUTH_SECRET`** (Vercel env var, and `.env.local` for local dev).

## 3. Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs** — add both:
   - `https://brickfly.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
4. Copy the client id/secret into **`AUTH_GOOGLE_ID`** and **`AUTH_GOOGLE_SECRET`**.

## 4. GitHub sign-in

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Homepage URL:** `https://brickfly.vercel.app`
3. **Authorization callback URL:** `https://brickfly.vercel.app/api/auth/callback/github`
   (make a second app with the `localhost:3000` callback for local dev).
4. Copy into **`AUTH_GITHUB_ID`** and **`AUTH_GITHUB_SECRET`**.

## 5. Deploy

Add all the env vars in **Vercel → Settings → Environment Variables** (Production +
Preview), then **redeploy**. The "Sign in with Google / GitHub" chip appears on the main
menu automatically once the providers are detected.

---

## How it fits together

| File | Role |
|------|------|
| `lib/db.ts` | Neon pool; `null` when `DATABASE_URL` is unset (graceful degradation). |
| `auth.ts` | Auth.js v5 config; enables only the providers whose env vars are present; database sessions. |
| `app/api/auth/[...nextauth]/route.ts` | OAuth sign-in / callback routes. |
| `app/api/state/route.ts` | `GET`/`POST` the signed-in player's `game_state` (collection, stats, settings). |
| `components/AuthProvider.tsx` | `SessionProvider` wrapper (in `app/layout.tsx`). |
| `components/AccountButton.tsx` | Menu sign-in / account chip; hidden until providers exist. |
| `components/CloudSync.tsx` | Merges cloud ↔ local collection on sign-in, debounce-saves changes. |
| `schema.sql` | Database tables. |

### What's stored per player
- **collection** — array of discovered landmark ids, e.g. `["nyc","eiffel","giza"]`
- **stats** — `{ "distanceKm": 42.7, "wonders": 3 }`
- **settings** — the same object saved to `localStorage['brickfly.settings']`

Data merges rather than overwrites: signing in on a new device unions that device's local
discoveries with whatever the cloud already has, so nothing is lost.

## Local development

```bash
cp .env.example .env.local   # fill in the values you have
npm run dev
```

Leave the OAuth vars blank to develop the game without accounts; fill them in to test sign-in.
