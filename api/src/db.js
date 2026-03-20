require("dotenv").config();

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SUNDAY_SQL = "((EXTRACT(DOW FROM track_date)::int + 7) % 7)";

async function ensureColumn(table, column, definition) {
  await pool.query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition};`,
  );
}

async function initializeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("users", "username", "TEXT");
  await ensureColumn("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE");

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_username_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
      END IF;
    END
    $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      include_in_auto_schedule BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("people", "include_in_auto_schedule", "BOOLEAN NOT NULL DEFAULT TRUE");

  await pool.query(`
    UPDATE people
    SET include_in_auto_schedule = TRUE
    WHERE include_in_auto_schedule IS DISTINCT FROM TRUE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS normal_weeks (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 5),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS normal_weeks_unique_person_week
    ON normal_weeks(person_id, week_number);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_out (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CHECK (start_date <= end_date)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS blocked_out_person_idx
    ON blocked_out(person_id, start_date, end_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS positions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      required BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL CHECK (priority >= 1),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("positions", "required", "BOOLEAN NOT NULL DEFAULT TRUE");

  await pool.query(`
    UPDATE positions
    SET required = TRUE
    WHERE required IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS person_positions (
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      rank_order INTEGER NOT NULL CHECK (rank_order >= 1),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (person_id, position_id)
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS person_positions_unique_rank
    ON person_positions(person_id, rank_order);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS person_positions_position_idx
    ON person_positions(position_id, person_id, rank_order);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS positions_priority_idx
    ON positions(priority, id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule (
      id SERIAL PRIMARY KEY,
      track_date DATE NOT NULL UNIQUE,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 5),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS schedule_track_date_idx
    ON schedule (track_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people_schedule (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (schedule_id, position_id),
      UNIQUE (schedule_id, person_id, position_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS people_schedule_schedule_idx
    ON people_schedule(schedule_id, position_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS people_schedule_person_idx
    ON people_schedule(person_id, schedule_id);
  `);

  await pool.query(`
    ALTER TABLE schedule
    DROP CONSTRAINT IF EXISTS schedule_track_date_is_sunday;
  `);

  await pool.query(`
    ALTER TABLE schedule
    ADD CONSTRAINT schedule_track_date_is_sunday
    CHECK (${SUNDAY_SQL} = 0);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL PRIMARY KEY,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  const seedPasswordHash = await bcrypt.hash("asdf", 10);

  await pool.query(
    `INSERT INTO users (username, password_hash, is_admin)
         VALUES ($1, $2, $3)
         ON CONFLICT (username)
         DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            is_admin = EXCLUDED.is_admin`,
    ["rob", seedPasswordHash, true],
  );

  // ── Ministry schema additions ──────────────────────────────────────────────

  // Extend users table with ministry-specific columns
  await ensureColumn("users", "name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("users", "email", "TEXT");
  await ensureColumn("users", "type", "TEXT NOT NULL DEFAULT 'Other'");

  // Backfill email from username for any rows missing it
  await pool.query(`UPDATE users SET email = username WHERE email IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS benevolence_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      request TEXT NOT NULL DEFAULT '',
      request_date DATE NOT NULL,
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      is_filled BOOLEAN NOT NULL DEFAULT FALSE,
      date_filled DATE,
      deacon_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      request TEXT NOT NULL DEFAULT '',
      request_date DATE NOT NULL,
      is_fulfilled BOOLEAN NOT NULL DEFAULT FALSE,
      date_fulfilled DATE,
      deacon_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_entries (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      entry_date DATE NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

initializeSchema().catch((error) => {
  console.error("Database schema initialization failed:", error);
  process.exit(1);
});

module.exports = pool;
