const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Add a Postgres database in Railway and it will be provided automatically.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : process.env.PGSSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false,
});

async function initSchema() {
  // Real accounts: email + hashed password. This is the actual identity
  // system. Everything else (profiles, ownership) hangs off a user's id now.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      owner_token TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // owner_token was the old browser-based pseudo-auth. It's no longer used by
  // new code (real accounts replace it) but the column stays, nullable, so
  // any profiles created before this change don't break.
  await pool.query(`ALTER TABLE profiles ALTER COLUMN owner_token DROP NOT NULL;`);
  // One user account = one profile. NULL user_id means the profile predates
  // real accounts (created during testing) and is no longer editable by
  // anyone until claimed - see README.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) UNIQUE;`);
  // Trial/plan tracking lives in real columns (not the payload) so the client
  // can never edit its own trial state.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial';`);
  // Real DB column (not payload) so it can never be set by a client request -
  // only by the protected /api/admin/create-profile endpoint using the server secret.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);`);

  // Scout/agent <-> player access grants. A scout must be granted access
  // before they can see a player's contract/contact/salary info or chat.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_grants (
      id TEXT PRIMARY KEY,
      scout_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (scout_id, player_id)
    );
  `);

  // Direct messages, only usable between a scout and a player once a grant is accepted.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (from_id, to_id, created_at);`);

  // Live matches: a club activates one, supporters submit score guesses,
  // the most-submitted score becomes the displayed "live score".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_matches (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS live_matches_status_idx ON live_matches (status, created_at DESC);`);

  // General-purpose connections between any two profiles (unlike roster/access_grants,
  // which are specific to one relationship type). A friendship row IS the connection -
  // status='accepted' means they're friends; 'pending' is an outstanding invite.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (requester_id, addressee_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);`);

  // Upcoming fixtures a club/team schedules ahead of time - distinct from
  // live_matches, which is real-time score tracking during a game already happening.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS events_club_idx ON events (club_id, created_at DESC);`);
}

module.exports = { pool, initSchema };
