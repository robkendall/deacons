require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initializeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Other',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'Other';
  `);

  await pool.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_type_check;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_type_check
    CHECK (type IN ('Deacon', 'Pastor', 'Yokefellow', 'Other'));
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
    ALTER TABLE widows
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'Widowed';
  `);

  await pool.query(`
    ALTER TABLE widows
    ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE widows
    DROP CONSTRAINT IF EXISTS widows_type_check;
  `);

  await pool.query(`
    ALTER TABLE widows
    ADD CONSTRAINT widows_type_check
    CHECK (type IN ('Widowed', 'Home Bound'));
  `);

  await pool.query(`
    ALTER TABLE widows
    ALTER COLUMN deacon_user_id DROP NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS benevolence_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      request TEXT NOT NULL,
      request_date DATE NOT NULL,
      amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
      is_filled BOOLEAN NOT NULL DEFAULT FALSE,
      date_filled DATE,
      deacon_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE benevolence_requests
    ALTER COLUMN deacon_user_id DROP NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      request TEXT NOT NULL,
      request_date DATE NOT NULL,
      is_fulfilled BOOLEAN NOT NULL DEFAULT FALSE,
      date_fulfilled DATE,
      deacon_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE work_requests
    ALTER COLUMN deacon_user_id DROP NOT NULL;
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
    ALTER TABLE schedule_entries
    DROP COLUMN IF EXISTS deacon_user_id;
  `);

  await pool.query(`
    ALTER TABLE schedule_entries
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
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
}

initializeSchema().catch((error) => {
  console.error("Database schema initialization failed:", error);
  process.exit(1);
});

module.exports = pool;
