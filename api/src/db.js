require("dotenv").config();

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
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await ensureColumn("users", "name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("users", "email", "TEXT");
  await ensureColumn("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE");

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_email_key'
      ) THEN
        BEGIN
          ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
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

  // ── Ministry schema additions ──────────────────────────────────────────────

  // Ensure ministry columns exist before the seed insert runs
  await ensureColumn("users", "type", "TEXT NOT NULL DEFAULT 'Other'");

  // Backfill email/name from legacy username rows before dropping the column.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'username'
      ) THEN
        UPDATE users
        SET email = COALESCE(NULLIF(email, ''), NULLIF(username, ''), CONCAT('user', id, '@local.dev'))
        WHERE email IS NULL OR email = '';
      ELSE
        UPDATE users
        SET email = COALESCE(NULLIF(email, ''), CONCAT('user', id, '@local.dev'))
        WHERE email IS NULL OR email = '';
      END IF;
    END
    $$;
  `);

  await pool.query(`
    UPDATE users
    SET name = COALESCE(NULLIF(name, ''), SPLIT_PART(email, '@', 1), CONCAT('User ', id))
    WHERE name IS NULL OR name = ''
  `);

  await pool.query(`ALTER TABLE users ALTER COLUMN email SET NOT NULL`);

  // Remove legacy username schema once email-based auth is in place.
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key`);
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS username`);

  // Intentionally do not auto-seed users here.
  // User accounts and admin assignment are managed explicitly through the app/DB.

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
    CREATE TABLE IF NOT EXISTS widows (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Widowed',
      location TEXT DEFAULT '',
      deacon_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      latest_notes TEXT DEFAULT '',
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS information_entries (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      deacon_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Backfill widow notes into information_entries if they haven't been migrated.
  await pool.query(`
    INSERT INTO information_entries (title, details, deacon_user_id, created_at, updated_at)
    SELECT
      CONCAT('Widow: ', w.name) AS title,
      w.latest_notes AS details,
      COALESCE(
        w.deacon_user_id,
        (
          SELECT u1.id
          FROM users u1
          WHERE u1.type IN ('Deacon', 'Yokefellow')
          ORDER BY u1.id ASC
          LIMIT 1
        ),
        (
          SELECT u2.id
          FROM users u2
          ORDER BY u2.id ASC
          LIMIT 1
        )
      ) AS deacon_user_id,
      NOW(),
      NOW()
    FROM widows w
    WHERE COALESCE(w.latest_notes, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM information_entries i
        WHERE i.title = CONCAT('Widow: ', w.name)
          AND i.details = w.latest_notes
      )
      AND COALESCE(
        w.deacon_user_id,
        (
          SELECT u3.id
          FROM users u3
          WHERE u3.type IN ('Deacon', 'Yokefellow')
          ORDER BY u3.id ASC
          LIMIT 1
        ),
        (
          SELECT u4.id
          FROM users u4
          ORDER BY u4.id ASC
          LIMIT 1
        )
      ) IS NOT NULL;
  `);
}

initializeSchema().catch((error) => {
  console.error("Database schema initialization failed:", error);
  process.exit(1);
});

module.exports = pool;
