-- BrickFly account + cloud-save schema (Neon / Postgres).
-- Run this once against your database (Neon SQL editor or `psql "$DATABASE_URL" -f schema.sql`).
-- The first four tables are the standard Auth.js (@auth/pg-adapter) schema; the
-- last one holds each player's synced game state.

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL,
  name VARCHAR(255),
  email VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  PRIMARY KEY (id)
);

-- Per-player cloud save: discovered landmarks, flight stats and settings.
CREATE TABLE IF NOT EXISTS game_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  collection JSONB NOT NULL DEFAULT '[]',
  stats JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
