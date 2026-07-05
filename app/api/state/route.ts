import { auth } from '@/auth';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Load the signed-in player's saved collection, stats and settings. */
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId || !pool) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const { rows } = await pool.query(
    'select collection, stats, settings, updated_at from game_state where user_id = $1',
    [userId]
  );
  return Response.json({ ok: true, state: rows[0] ?? null });
}

/** Upsert the signed-in player's game state. */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId || !pool) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let body: { collection?: unknown; stats?: unknown; settings?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  await pool.query(
    `insert into game_state (user_id, collection, stats, settings, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id) do update set
       collection = excluded.collection,
       stats = excluded.stats,
       settings = excluded.settings,
       updated_at = now()`,
    [
      userId,
      JSON.stringify(body.collection ?? []),
      JSON.stringify(body.stats ?? {}),
      JSON.stringify(body.settings ?? {})
    ]
  );
  return Response.json({ ok: true });
}
