require("dotenv").config();

const bcrypt = require("bcrypt");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const pool = require("./db");
const requireAuth = require("./middleware/auth");

const app = express();
app.set("trust proxy", true);
const PORT = Number(process.env.PORT || process.env.API_PORT || 3002);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (IS_PRODUCTION && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production.");
}

const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    return next();
  });
}

app.use(express.json());
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
    }),
    secret: SESSION_SECRET || "deacons-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: process.env.SESSION_COOKIE_SAMESITE || "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOptionalBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return null;
}

function weekNumberFromSunday(dateValue) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  return Math.floor((date.getUTCDate() - 1) / 7) + 1;
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthZeroBased = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthZeroBased) || monthZeroBased < 0 || monthZeroBased > 11) {
    return null;
  }

  const first = new Date(Date.UTC(year, monthZeroBased, 1));
  const last = new Date(Date.UTC(year, monthZeroBased + 1, 0));

  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
    year,
    monthZeroBased,
  };
}

function sundayDatesForMonth(year, monthZeroBased) {
  const dates = [];
  const cursor = new Date(Date.UTC(year, monthZeroBased, 1));

  while (cursor.getUTCMonth() === monthZeroBased) {
    if (cursor.getUTCDay() === 0) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function isDateBlocked(date, blocks) {
  return blocks.some((block) => date >= block.start_date && date <= block.end_date);
}

async function refreshSessionUser(req) {
  const result = await pool.query(
    "SELECT id, name, email, is_admin FROM users WHERE id = $1",
    [req.session.userId],
  );

  const user = result.rows[0] || null;
  if (!user) {
    return null;
  }

  req.session.userName = user.name;
  req.session.userIsAdmin = user.is_admin;
  return user;
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await refreshSessionUser(req);
  if (!user?.is_admin) {
    return res.status(403).json({ error: "Admin access required." });
  }

  return next();
}

function handleServerError(res, context, error) {
  console.error(`${context}:`, error);
  return res.status(500).json({ error: `${context}.` });
}

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT NOW() AS now");
  res.json({
    status: "ok",
    service: "deacons-api",
    time: result.rows[0].now,
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({ ok: true });
  } catch (_error) {
    return res.status(503).json({ ok: false, error: "database unavailable" });
  }
});

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = await refreshSessionUser(req);
  if (!user) {
    req.session.destroy(() => { });
    return res.json({ user: null });
  }

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.is_admin,
    },
  });
});

app.post("/api/login", async (req, res) => {
  const email = normalizeText(req.body.email).toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email, password_hash, is_admin FROM users WHERE LOWER(email) = $1",
      [email],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userIsAdmin = user.is_admin;

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: user.is_admin,
      },
    });
  } catch (error) {
    return handleServerError(res, "Login failed", error);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("connect.sid");
    return res.json({ ok: true });
  });
});

app.post("/api/password-reset", async (req, res) => {
  const email = normalizeText(req.body.email).toLowerCase();
  const newPassword = String(req.body.newPassword || "");

  if (!email || !newPassword) {
    return res.status(400).json({ error: "Email and new password are required." });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE LOWER(email) = $2
       RETURNING id, name, email`,
      [passwordHash, email],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    return handleServerError(res, "Password reset failed", error);
  }
});

app.get("/api/dashboard", requireAuth, async (_req, res) => {
  try {
    const [peopleCount, positionCount, scheduleCount, nextEntries] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM people"),
      pool.query("SELECT COUNT(*)::int AS count FROM positions"),
      pool.query("SELECT COUNT(*)::int AS count FROM schedule"),
      pool.query(
        `SELECT s.id, s.track_date, s.week_number,
                COUNT(ps.id)::int AS assignment_count
         FROM schedule s
         LEFT JOIN people_schedule ps ON ps.schedule_id = s.id
         WHERE s.track_date >= CURRENT_DATE
         GROUP BY s.id
         ORDER BY s.track_date ASC
         LIMIT 6`,
      ),
    ]);

    return res.json({
      counts: {
        people: peopleCount.rows[0].count,
        positions: positionCount.rows[0].count,
        schedules: scheduleCount.rows[0].count,
      },
      upcoming: nextEntries.rows,
    });
  } catch (error) {
    return handleServerError(res, "Failed to load dashboard", error);
  }
});

app.get("/api/users", requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, is_admin, created_at
       FROM users
       ORDER BY name ASC, email ASC`,
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load users", error);
  }
});

app.get("/api/users/:id(\\d+)", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, is_admin, created_at
       FROM users
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load user", error);
  }
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const name = normalizeText(req.body.name);
  const email = normalizeText(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const isAdmin = Boolean(req.body.isAdmin);

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, is_admin, created_at`,
      [name, email, passwordHash, isAdmin],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists." });
    }

    return handleServerError(res, "Failed to create user", error);
  }
});

app.put("/api/users/:id(\\d+)", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = normalizeText(req.body.name);
  const email = normalizeText(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const hasPassword = Boolean(password);
  const isAdmin = Boolean(req.body.isAdmin);

  if (!id || !name || !email) {
    return res.status(400).json({ error: "Valid ID, name, and email are required." });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2", [email, id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already exists." });
    }

    let result;
    if (hasPassword) {
      const passwordHash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users
         SET name = $1,
             email = $2,
             is_admin = $3,
             password_hash = $4
         WHERE id = $5
         RETURNING id, name, email, is_admin, created_at`,
        [name, email, isAdmin, passwordHash, id],
      );
    } else {
      result = await pool.query(
        `UPDATE users
         SET name = $1,
             email = $2,
             is_admin = $3
         WHERE id = $4
         RETURNING id, name, email, is_admin, created_at`,
        [name, email, isAdmin, id],
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    if (req.session.userId === id) {
      req.session.userName = result.rows[0].name;
      req.session.userIsAdmin = result.rows[0].is_admin;
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists." });
    }

    return handleServerError(res, "Failed to update user", error);
  }
});

app.delete("/api/users/:id(\\d+)", requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  if (req.session.userId === id) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }

  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete user", error);
  }
});

app.get("/api/people", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, include_in_auto_schedule, created_at, updated_at
       FROM people
       ORDER BY name ASC`,
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people", error);
  }
});

app.get("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, include_in_auto_schedule, created_at, updated_at
       FROM people
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load person", error);
  }
});

app.post("/api/people", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const includeInAutoSchedule = true;
  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO people (name, include_in_auto_schedule)
       VALUES ($1, $2)
       RETURNING id, name, include_in_auto_schedule, created_at, updated_at`,
      [name, includeInAutoSchedule],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create person", error);
  }
});

app.put("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = normalizeText(req.body.name);
  const includeInAutoSchedule = req.body.includeInAutoSchedule !== undefined
    ? Boolean(req.body.includeInAutoSchedule)
    : null;

  if (!id || !name) {
    return res.status(400).json({ error: "Valid ID and name are required." });
  }

  try {
    const result = await pool.query(
      `UPDATE people
       SET name = $1,
           include_in_auto_schedule = COALESCE($2, include_in_auto_schedule),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, include_in_auto_schedule, created_at, updated_at`,
      [name, includeInAutoSchedule, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update person", error);
  }
});

app.delete("/api/people/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM people WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Person not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete person", error);
  }
});

app.get("/api/normal-weeks", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT nw.id, nw.person_id, p.name AS person_name, nw.week_number, nw.created_at, nw.updated_at
       FROM normal_weeks nw
       JOIN people p ON p.id = nw.person_id
       ORDER BY p.name ASC, nw.week_number ASC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load normal weeks", error);
  }
});

app.get("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT nw.id, nw.person_id, p.name AS person_name, nw.week_number, nw.created_at, nw.updated_at
       FROM normal_weeks nw
       JOIN people p ON p.id = nw.person_id
       WHERE nw.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load normal week preference", error);
  }
});

app.post("/api/normal-weeks", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.body.personId);
  const weekNumber = parsePositiveInt(req.body.weekNumber);

  if (!personId || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid person ID and week number (1-5) are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO normal_weeks (person_id, week_number)
       VALUES ($1, $2)
       RETURNING id, person_id, week_number, created_at, updated_at`,
      [personId, weekNumber],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Person already has this normal week preference." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to create normal week preference", error);
  }
});

app.put("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const personId = parsePositiveInt(req.body.personId);
  const weekNumber = parsePositiveInt(req.body.weekNumber);

  if (!id || !personId || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid ID, person ID, and week number (1-5) are required." });
  }

  try {
    const result = await pool.query(
      `UPDATE normal_weeks
       SET person_id = $1,
           week_number = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, person_id, week_number, created_at, updated_at`,
      [personId, weekNumber, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Person already has this normal week preference." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to update normal week preference", error);
  }
});

app.delete("/api/normal-weeks/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM normal_weeks WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Normal week preference not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete normal week preference", error);
  }
});

app.get("/api/blocked-out", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.person_id, p.name AS person_name, b.start_date, b.end_date, b.created_at, b.updated_at
       FROM blocked_out b
       JOIN people p ON p.id = b.person_id
       ORDER BY b.start_date ASC, p.name ASC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load blocked out dates", error);
  }
});

app.get("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT b.id, b.person_id, p.name AS person_name, b.start_date, b.end_date, b.created_at, b.updated_at
       FROM blocked_out b
       JOIN people p ON p.id = b.person_id
       WHERE b.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load blocked out entry", error);
  }
});

app.post("/api/blocked-out", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.body.personId);
  const startDate = normalizeDate(req.body.startDate);
  const endDate = normalizeDate(req.body.endDate);

  if (!personId || !startDate || !endDate) {
    return res.status(400).json({ error: "Valid person ID, start date, and end date are required." });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: "Start date must be on or before end date." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO blocked_out (person_id, start_date, end_date)
       VALUES ($1, $2, $3)
       RETURNING id, person_id, start_date, end_date, created_at, updated_at`,
      [personId, startDate, endDate],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to create blocked out entry", error);
  }
});

app.put("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const personId = parsePositiveInt(req.body.personId);
  const startDate = normalizeDate(req.body.startDate);
  const endDate = normalizeDate(req.body.endDate);

  if (!id || !personId || !startDate || !endDate) {
    return res.status(400).json({ error: "Valid ID, person ID, start date, and end date are required." });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: "Start date must be on or before end date." });
  }

  try {
    const result = await pool.query(
      `UPDATE blocked_out
       SET person_id = $1,
           start_date = $2,
           end_date = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, person_id, start_date, end_date, created_at, updated_at`,
      [personId, startDate, endDate, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({ error: "Person does not exist." });
    }

    return handleServerError(res, "Failed to update blocked out entry", error);
  }
});

app.delete("/api/blocked-out/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM blocked_out WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Blocked out entry not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete blocked out entry", error);
  }
});

app.get("/api/positions", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, required, priority, created_at, updated_at
       FROM positions
       ORDER BY priority ASC, name ASC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load positions", error);
  }
});

app.get("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, required, priority, created_at, updated_at
       FROM positions
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load position", error);
  }
});

app.post("/api/positions", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const required = parseOptionalBoolean(req.body.required);

  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  try {
    const priorityResult = await pool.query(
      "SELECT COALESCE(MAX(priority), 0)::int + 1 AS next_priority FROM positions",
    );
    const nextPriority = priorityResult.rows[0].next_priority;

    const result = await pool.query(
      `INSERT INTO positions (name, required, priority)
       VALUES ($1, $2, $3)
       RETURNING id, name, required, priority, created_at, updated_at`,
      [name, required === null ? true : required, nextPriority],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position name already exists." });
    }

    return handleServerError(res, "Failed to create position", error);
  }
});

app.put("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const name = req.body.name === undefined ? null : normalizeText(req.body.name);
  const priority = parsePositiveInt(req.body.priority);
  const required = parseOptionalBoolean(req.body.required);

  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  if (req.body.name !== undefined && !name) {
    return res.status(400).json({ error: "Name cannot be blank." });
  }

  if (name === null && !priority && required === null) {
    return res.status(400).json({ error: "At least one field to update is required." });
  }

  try {
    const result = await pool.query(
      `UPDATE positions
       SET name = COALESCE($1, name),
           priority = COALESCE($2, priority),
           required = COALESCE($3, required),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, required, priority, created_at, updated_at`,
      [name, priority, required, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Position not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position name already exists." });
    }

    return handleServerError(res, "Failed to update position", error);
  }
});

app.put("/api/positions/reorder", requireAuth, async (req, res) => {
  const orderedPositionIds = Array.isArray(req.body.orderedPositionIds)
    ? req.body.orderedPositionIds.map((value) => parsePositiveInt(value)).filter(Boolean)
    : [];

  if (orderedPositionIds.length === 0) {
    return res.status(400).json({ error: "orderedPositionIds is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT id FROM positions ORDER BY priority ASC, id ASC",
    );
    const existingIds = existingResult.rows.map((row) => row.id);

    const sameLength = existingIds.length === orderedPositionIds.length;
    const sameSet = sameLength && existingIds.every((id) => orderedPositionIds.includes(id));

    if (!sameSet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "orderedPositionIds must include all positions exactly once." });
    }

    for (let index = 0; index < orderedPositionIds.length; index += 1) {
      await client.query(
        `UPDATE positions
         SET priority = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [index + 1, orderedPositionIds[index]],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      "SELECT id, name, required, priority, created_at, updated_at FROM positions ORDER BY priority ASC, id ASC",
    );
    return res.json(updated.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to reorder positions", error);
  } finally {
    client.release();
  }
});

app.get("/api/people-positions", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order,
              p.name AS person_name,
              pos.name AS position_name,
              pp.created_at, pp.updated_at
       FROM person_positions pp
       JOIN people p ON p.id = pp.person_id
       JOIN positions pos ON pos.id = pp.position_id
       ORDER BY p.name ASC, pp.rank_order ASC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people positions", error);
  }
});

app.get("/api/people/:id/positions", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  if (!personId) {
    return res.status(400).json({ error: "Valid person ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order,
              pos.name AS position_name,
              pp.created_at, pp.updated_at
       FROM person_positions pp
       JOIN positions pos ON pos.id = pp.position_id
       WHERE pp.person_id = $1
       ORDER BY pp.rank_order ASC`,
      [personId],
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load person positions", error);
  }
});

app.post("/api/people/:id/positions", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!personId || !positionId) {
    return res.status(400).json({ error: "Valid person ID and position ID are required." });
  }

  try {
    const rankResult = await pool.query(
      "SELECT COALESCE(MAX(rank_order), 0)::int + 1 AS next_rank FROM person_positions WHERE person_id = $1",
      [personId],
    );

    const result = await pool.query(
      `INSERT INTO person_positions (person_id, position_id, rank_order)
       VALUES ($1, $2, $3)
       RETURNING person_id, position_id, rank_order, created_at, updated_at`,
      [personId, positionId, rankResult.rows[0].next_rank],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position already assigned to this person." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Person or position does not exist." });
    }

    return handleServerError(res, "Failed to assign position to person", error);
  }
});

app.put("/api/people/:id/positions/reorder", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const orderedPositionIds = Array.isArray(req.body.orderedPositionIds)
    ? req.body.orderedPositionIds.map((value) => parsePositiveInt(value)).filter(Boolean)
    : [];

  if (!personId || orderedPositionIds.length === 0) {
    return res.status(400).json({ error: "Valid person ID and orderedPositionIds are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT position_id FROM person_positions WHERE person_id = $1 ORDER BY rank_order ASC",
      [personId],
    );
    const existingIds = existingResult.rows.map((row) => row.position_id);

    const sameLength = existingIds.length === orderedPositionIds.length;
    const sameSet = sameLength && existingIds.every((id) => orderedPositionIds.includes(id));

    if (!sameSet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "orderedPositionIds must include all assigned positions exactly once." });
    }

    const maxRankResult = await client.query(
      "SELECT COALESCE(MAX(rank_order), 0)::int AS max_rank FROM person_positions WHERE person_id = $1",
      [personId],
    );
    const tempOffset = maxRankResult.rows[0].max_rank + orderedPositionIds.length + 100;

    // Shift all current ranks out of the target range first so unique(person_id, rank_order)
    // cannot conflict during sequential final updates.
    await client.query(
      `UPDATE person_positions
       SET rank_order = rank_order + $1,
           updated_at = NOW()
       WHERE person_id = $2`,
      [tempOffset, personId],
    );

    for (let index = 0; index < orderedPositionIds.length; index += 1) {
      await client.query(
        `UPDATE person_positions
         SET rank_order = $1,
             updated_at = NOW()
         WHERE person_id = $2 AND position_id = $3`,
        [index + 1, personId, orderedPositionIds[index]],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT pp.person_id, pp.position_id, pp.rank_order, pos.name AS position_name
       FROM person_positions pp
       JOIN positions pos ON pos.id = pp.position_id
       WHERE pp.person_id = $1
       ORDER BY pp.rank_order ASC`,
      [personId],
    );

    return res.json(updated.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to reorder person positions", error);
  } finally {
    client.release();
  }
});

app.delete("/api/people/:id/positions/:positionId", requireAuth, async (req, res) => {
  const personId = parsePositiveInt(req.params.id);
  const positionId = parsePositiveInt(req.params.positionId);

  if (!personId || !positionId) {
    return res.status(400).json({ error: "Valid person ID and position ID are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deleted = await client.query(
      `DELETE FROM person_positions
       WHERE person_id = $1 AND position_id = $2
       RETURNING person_id, position_id`,
      [personId, positionId],
    );

    if (deleted.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Person position assignment not found." });
    }

    const remaining = await client.query(
      "SELECT position_id FROM person_positions WHERE person_id = $1 ORDER BY rank_order ASC",
      [personId],
    );

    for (let index = 0; index < remaining.rows.length; index += 1) {
      await client.query(
        `UPDATE person_positions
         SET rank_order = $1,
             updated_at = NOW()
         WHERE person_id = $2 AND position_id = $3`,
        [index + 1, personId, remaining.rows[index].position_id],
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to remove person position assignment", error);
  } finally {
    client.release();
  }
});

app.delete("/api/positions/:id(\\d+)", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query("DELETE FROM positions WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Position not found." });
    }

    const remaining = await client.query("SELECT id FROM positions ORDER BY priority ASC, id ASC");
    for (let index = 0; index < remaining.rows.length; index += 1) {
      await client.query(
        `UPDATE positions
         SET priority = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [index + 1, remaining.rows[index].id],
      );
    }

    await client.query("COMMIT");

    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to delete position", error);
  } finally {
    client.release();
  }
});

app.get("/api/schedule", requireAuth, async (req, res) => {
  const month = normalizeText(req.query.month);

  try {
    const values = [];
    let whereClause = "";

    if (month) {
      const bounds = monthBounds(month);
      if (!bounds) {
        return res.status(400).json({ error: "Month must be in YYYY-MM format." });
      }
      values.push(bounds.start, bounds.end);
      whereClause = "WHERE s.track_date BETWEEN $1 AND $2";
    }

    const result = await pool.query(
      `SELECT s.id, s.track_date, s.week_number, s.created_at, s.updated_at,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'id', ps.id,
                    'personId', ps.person_id,
                    'personName', p.name,
                    'positionId', ps.position_id,
                    'positionName', pos.name,
                    'priority', pos.priority
                  )
                  ORDER BY pos.name ASC
                ) FILTER (WHERE ps.id IS NOT NULL),
                '[]'::json
              ) AS assignments
       FROM schedule s
       LEFT JOIN people_schedule ps ON ps.schedule_id = s.id
       LEFT JOIN people p ON p.id = ps.person_id
       LEFT JOIN positions pos ON pos.id = ps.position_id
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.track_date ASC`,
      values,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load schedule", error);
  }
});

app.get("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, track_date, week_number, created_at, updated_at
       FROM schedule
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load schedule row", error);
  }
});

app.post("/api/schedule", requireAuth, async (req, res) => {
  const trackDate = normalizeDate(req.body.trackDate);
  const weekNumber = parsePositiveInt(req.body.weekNumber) || (trackDate ? weekNumberFromSunday(trackDate) : null);

  if (!trackDate || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid track date and week number (1-5) are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO schedule (track_date, week_number)
       VALUES ($1, $2)
       RETURNING id, track_date, week_number, created_at, updated_at`,
      [trackDate, weekNumber],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Schedule already exists for this date." });
    }

    if (error.code === "23514") {
      return res.status(400).json({ error: "Track date must be a Sunday and week number must be 1-5." });
    }

    return handleServerError(res, "Failed to create schedule row", error);
  }
});

app.put("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const trackDate = normalizeDate(req.body.trackDate);
  const weekNumber = parsePositiveInt(req.body.weekNumber) || (trackDate ? weekNumberFromSunday(trackDate) : null);

  if (!id || !trackDate || !weekNumber || weekNumber > 5) {
    return res.status(400).json({ error: "Valid ID, track date, and week number (1-5) are required." });
  }

  try {
    const result = await pool.query(
      `UPDATE schedule
       SET track_date = $1,
           week_number = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, track_date, week_number, created_at, updated_at`,
      [trackDate, weekNumber, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Schedule already exists for this date." });
    }

    if (error.code === "23514") {
      return res.status(400).json({ error: "Track date must be a Sunday and week number must be 1-5." });
    }

    return handleServerError(res, "Failed to update schedule row", error);
  }
});

app.delete("/api/schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM schedule WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Schedule row not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete schedule row", error);
  }
});

app.delete("/api/schedule", requireAuth, async (req, res) => {
  const month = normalizeText(req.query.month);
  const bounds = monthBounds(month);

  if (!bounds) {
    return res.status(400).json({ error: "Month must be in YYYY-MM format." });
  }

  try {
    const result = await pool.query(
      `DELETE FROM schedule
       WHERE track_date BETWEEN $1 AND $2
       RETURNING id`,
      [bounds.start, bounds.end],
    );

    return res.json({ ok: true, deletedScheduleRows: result.rows.length, month });
  } catch (error) {
    return handleServerError(res, "Failed to clear month schedule", error);
  }
});

app.delete("/api/schedule/:id/assignments", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    await pool.query("DELETE FROM people_schedule WHERE schedule_id = $1", [id]);
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to clear schedule assignments", error);
  }
});

app.get("/api/people-schedule", requireAuth, async (req, res) => {
  const scheduleId = parsePositiveInt(req.query.scheduleId);

  try {
    const values = [];
    let whereClause = "";

    if (scheduleId) {
      values.push(scheduleId);
      whereClause = "WHERE ps.schedule_id = $1";
    }

    const result = await pool.query(
      `SELECT ps.id, ps.schedule_id, s.track_date, s.week_number,
              ps.person_id, p.name AS person_name,
              ps.position_id, pos.name AS position_name, pos.priority,
              ps.created_at, ps.updated_at
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       JOIN people p ON p.id = ps.person_id
       JOIN positions pos ON pos.id = ps.position_id
       ${whereClause}
       ORDER BY s.track_date ASC, pos.priority ASC, p.name ASC`,
      values,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load people schedule", error);
  }
});

app.get("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query(
      `SELECT ps.id, ps.schedule_id, ps.person_id, ps.position_id,
              s.track_date, s.week_number,
              p.name AS person_name,
              pos.name AS position_name,
              pos.priority,
              ps.created_at, ps.updated_at
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       JOIN people p ON p.id = ps.person_id
       JOIN positions pos ON pos.id = ps.position_id
       WHERE ps.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to load people schedule assignment", error);
  }
});

app.post("/api/people-schedule", requireAuth, async (req, res) => {
  const scheduleId = parsePositiveInt(req.body.scheduleId);
  const personId = parsePositiveInt(req.body.personId);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!scheduleId || !personId || !positionId) {
    return res.status(400).json({ error: "Schedule ID, person ID, and position ID are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO people_schedule (schedule_id, person_id, position_id)
       VALUES ($1, $2, $3)
       RETURNING id, schedule_id, person_id, position_id, created_at, updated_at`,
      [scheduleId, personId, positionId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position is already assigned for this schedule." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Schedule, person, or position does not exist." });
    }

    return handleServerError(res, "Failed to create people schedule assignment", error);
  }
});

app.put("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const scheduleId = parsePositiveInt(req.body.scheduleId);
  const personId = parsePositiveInt(req.body.personId);
  const positionId = parsePositiveInt(req.body.positionId);

  if (!id || !scheduleId || !personId || !positionId) {
    return res.status(400).json({ error: "Valid ID, schedule ID, person ID, and position ID are required." });
  }

  try {
    const result = await pool.query(
      `UPDATE people_schedule
       SET schedule_id = $1,
           person_id = $2,
           position_id = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, schedule_id, person_id, position_id, created_at, updated_at`,
      [scheduleId, personId, positionId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Position is already assigned for this schedule." });
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Schedule, person, or position does not exist." });
    }

    return handleServerError(res, "Failed to update people schedule assignment", error);
  }
});

app.delete("/api/people-schedule/:id", requireAuth, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Valid ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM people_schedule WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "People schedule assignment not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete people schedule assignment", error);
  }
});

app.post("/api/schedule/prepopulate", requireAuth, async (req, res) => {
  const month = normalizeText(req.body.month);
  const bounds = monthBounds(month);

  if (!bounds) {
    return res.status(400).json({ error: "Month must be in YYYY-MM format." });
  }

  const sundayDates = sundayDatesForMonth(bounds.year, bounds.monthZeroBased);
  if (sundayDates.length === 0) {
    return res.status(400).json({ error: "No Sundays found for that month." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const [peopleResult, positionsResult, normalWeeksResult, blockedResult, personPositionsResult] = await Promise.all([
      client.query("SELECT id, name FROM people WHERE include_in_auto_schedule = TRUE ORDER BY id ASC"),
      client.query("SELECT id, name, required, priority FROM positions ORDER BY priority ASC, id ASC"),
      client.query("SELECT person_id, week_number FROM normal_weeks"),
      client.query("SELECT person_id, start_date, end_date FROM blocked_out"),
      client.query("SELECT person_id, position_id, rank_order FROM person_positions"),
    ]);

    const people = peopleResult.rows;
    const positions = positionsResult.rows;

    if (people.length === 0 || positions.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "People and positions must exist before pre-populating schedule." });
    }

    const weeksByPerson = new Map();
    normalWeeksResult.rows.forEach((row) => {
      if (!weeksByPerson.has(row.person_id)) {
        weeksByPerson.set(row.person_id, new Set());
      }
      weeksByPerson.get(row.person_id).add(row.week_number);
    });

    const blockedByPerson = new Map();
    blockedResult.rows.forEach((row) => {
      if (!blockedByPerson.has(row.person_id)) {
        blockedByPerson.set(row.person_id, []);
      }
      blockedByPerson.get(row.person_id).push(row);
    });

    const rankByPosition = new Map();
    personPositionsResult.rows.forEach((row) => {
      if (!rankByPosition.has(row.position_id)) {
        rankByPosition.set(row.position_id, new Map());
      }
      rankByPosition.get(row.position_id).set(row.person_id, row.rank_order);
    });

    const existingSchedulesResult = await client.query(
      `SELECT id, track_date, week_number
       FROM schedule
       WHERE track_date BETWEEN $1 AND $2`,
      [bounds.start, bounds.end],
    );

    const scheduleByDate = new Map();
    existingSchedulesResult.rows.forEach((row) => {
      scheduleByDate.set(row.track_date, row);
    });

    for (const date of sundayDates) {
      if (!scheduleByDate.has(date)) {
        const insertResult = await client.query(
          `INSERT INTO schedule (track_date, week_number)
           VALUES ($1, $2)
           ON CONFLICT (track_date) DO UPDATE SET week_number = EXCLUDED.week_number
           RETURNING id, track_date, week_number`,
          [date, weekNumberFromSunday(date)],
        );
        scheduleByDate.set(date, insertResult.rows[0]);
      }
    }

    const scheduleIds = [...scheduleByDate.values()].map((row) => row.id);
    const existingAssignmentsResult = await client.query(
      `SELECT ps.id, ps.schedule_id, ps.person_id, ps.position_id, s.track_date
       FROM people_schedule ps
       JOIN schedule s ON s.id = ps.schedule_id
       WHERE ps.schedule_id = ANY($1::int[])`,
      [scheduleIds],
    );

    const assignedBySchedule = new Map();
    const peopleById = new Map(people.map((person) => [person.id, person]));

    existingAssignmentsResult.rows.forEach((row) => {
      if (!assignedBySchedule.has(row.schedule_id)) {
        assignedBySchedule.set(row.schedule_id, {
          personIds: new Set(),
          positionIds: new Set(),
        });
      }
      assignedBySchedule.get(row.schedule_id).personIds.add(row.person_id);
      assignedBySchedule.get(row.schedule_id).positionIds.add(row.position_id);
    });

    const createdAssignments = [];

    function shuffle(array) {
      const next = [...array];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      }
      return next;
    }

    function getEligiblePeople(date, weekNumber, positionId, assignedPersonIds) {
      const rankMap = rankByPosition.get(positionId) || new Map();

      return people.filter((person) => {
        const availableWeeks = weeksByPerson.get(person.id);
        if (!availableWeeks?.has(weekNumber)) {
          return false;
        }

        if (!rankMap.has(person.id)) {
          return false;
        }

        if (assignedPersonIds.has(person.id)) {
          return false;
        }

        const blocks = blockedByPerson.get(person.id) || [];
        return !isDateBlocked(date, blocks);
      });
    }

    function buildOptimalAssignments(date, weekNumber, assignedState) {
      const remainingPositions = positions
        .filter((position) => !assignedState.positionIds.has(position.id))
        .sort((left, right) => left.priority - right.priority || left.id - right.id);

      if (remainingPositions.length === 0) {
        return [];
      }

      const remainingPeople = people
        .filter((person) => !assignedState.personIds.has(person.id));

      const positionScoreByIndex = remainingPositions.map((position, index) => {
        const priorityBit = 1n << BigInt(remainingPositions.length - index);
        const requiredBit = position.required ? (1n << BigInt(remainingPositions.length * 2)) : 0n;
        return requiredBit + priorityBit;
      });

      const eligiblePeopleByPositionIndex = remainingPositions.map((position) => (
        new Set(getEligiblePeople(date, weekNumber, position.id, assignedState.personIds).map((person) => person.id))
      ));

      const eligiblePositionIndexesByPerson = remainingPeople.map((person) => (
        shuffle(
          remainingPositions
            .map((_, positionIndex) => positionIndex)
            .filter((positionIndex) => eligiblePeopleByPositionIndex[positionIndex].has(person.id)),
        )
      ));

      const memo = new Map();

      function solve(personIndex, mask) {
        if (personIndex >= remainingPeople.length) {
          return 0n;
        }

        const key = `${personIndex}:${mask}`;
        if (memo.has(key)) {
          return memo.get(key);
        }

        let best = solve(personIndex + 1, mask);

        for (const positionIndex of eligiblePositionIndexesByPerson[personIndex]) {
          const bit = 1 << positionIndex;
          if (mask & bit) {
            continue;
          }

          const score = positionScoreByIndex[positionIndex] + solve(personIndex + 1, mask | bit);
          if (score > best) {
            best = score;
          }
        }

        memo.set(key, best);
        return best;
      }

      const assignments = [];

      function reconstruct(personIndex, mask) {
        if (personIndex >= remainingPeople.length) {
          return;
        }

        const baseline = solve(personIndex + 1, mask);
        const currentBest = solve(personIndex, mask);

        const matchingChoices = eligiblePositionIndexesByPerson[personIndex]
          .filter((positionIndex) => !(mask & (1 << positionIndex)))
          .filter((positionIndex) => {
            const bit = 1 << positionIndex;
            const score = positionScoreByIndex[positionIndex] + solve(personIndex + 1, mask | bit);
            return score === currentBest;
          });

        if (matchingChoices.length > 0) {
          const selectedPositionIndex = matchingChoices[0];
          assignments.push({
            person: remainingPeople[personIndex],
            position: remainingPositions[selectedPositionIndex],
          });
          reconstruct(personIndex + 1, mask | (1 << selectedPositionIndex));
          return;
        }

        if (baseline === currentBest) {
          reconstruct(personIndex + 1, mask);
        }
      }

      reconstruct(0, 0);

      return assignments.sort((left, right) => left.position.priority - right.position.priority || left.position.id - right.position.id);
    }

    for (const date of sundayDates) {
      const schedule = scheduleByDate.get(date);
      const weekNumber = schedule.week_number;
      const assigned = assignedBySchedule.get(schedule.id) || {
        personIds: new Set(),
        positionIds: new Set(),
      };

      if (!assignedBySchedule.has(schedule.id)) {
        assignedBySchedule.set(schedule.id, assigned);
      }

      const optimizedAssignments = buildOptimalAssignments(date, weekNumber, assigned);

      for (const assignment of optimizedAssignments) {
        const selectedPerson = peopleById.get(assignment.person.id);
        if (!selectedPerson) {
          // Defensive guard if the person vanished mid-transaction.
          // This should not happen in normal flow.
          // eslint-disable-next-line no-continue
          continue;
        }

        const insertAssignmentResult = await client.query(
          `INSERT INTO people_schedule (schedule_id, person_id, position_id)
           VALUES ($1, $2, $3)
           RETURNING id, schedule_id, person_id, position_id`,
          [schedule.id, selectedPerson.id, assignment.position.id],
        );

        assigned.personIds.add(selectedPerson.id);
        assigned.positionIds.add(assignment.position.id);

        createdAssignments.push({
          ...insertAssignmentResult.rows[0],
          trackDate: date,
          weekNumber,
          personName: selectedPerson.name,
          positionName: assignment.position.name,
          positionPriority: assignment.position.priority,
        });
      }
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      month,
      schedulesTouched: sundayDates.length,
      assignmentsCreated: createdAssignments.length,
      createdAssignments,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleServerError(res, "Failed to pre-populate schedule", error);
  } finally {
    client.release();
  }
});

// ── Ministry helpers ───────────────────────────────────────────────────────────

const MINISTRY_ASSIGNABLE_TYPES = ["Deacon", "Yokefellow"];
const WIDOW_TYPES = ["Widowed", "Home Bound"];

function normalizeBoolean(value) {
  return Boolean(value);
}

function parseAmount(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return null;
  }
  return amount;
}

async function requireAssignableUser(deaconUserId) {
  const result = await pool.query(
    `SELECT id, email, type
         FROM users
         WHERE id = $1
           AND type = ANY($2::text[])`,
    [deaconUserId, MINISTRY_ASSIGNABLE_TYPES],
  );
  return result.rows[0] || null;
}

function isAllowedWidowType(type) {
  return WIDOW_TYPES.includes(type);
}

// ── Ministry: assignable users ─────────────────────────────────────────────────

app.get("/api/users/assignable", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, type
             FROM users
             WHERE type = ANY($1::text[])
             ORDER BY email ASC`,
      [MINISTRY_ASSIGNABLE_TYPES],
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load assignable users", error);
  }
});

// ── Ministry: benevolence ──────────────────────────────────────────────────────

app.get("/api/widows", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.name, w.type, w.location, w.latest_notes, w.deacon_user_id, w.created_at, w.updated_at,
              u.name AS deacon_name, u.email AS deacon_email, u.type AS deacon_type
       FROM widows w
       LEFT JOIN users u ON u.id = w.deacon_user_id
       ORDER BY w.name ASC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load widows", error);
  }
});

app.post("/api/widows", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const type = normalizeText(req.body.type) || "Widowed";
  const location = normalizeText(req.body.location);
  const latestNotes = normalizeText(req.body.latestNotes);
  const rawDeaconUserId = req.body.deaconUserId;
  const deaconUserId =
    rawDeaconUserId === undefined || rawDeaconUserId === null || rawDeaconUserId === ""
      ? null
      : Number(rawDeaconUserId);

  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }

  if (!isAllowedWidowType(type)) {
    return res.status(400).json({ error: "Invalid widow type." });
  }

  if (deaconUserId !== null && Number.isNaN(deaconUserId)) {
    return res.status(400).json({ error: "Invalid deacon selection." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `INSERT INTO widows (name, type, location, deacon_user_id, latest_notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, type, location, deacon_user_id, latest_notes, created_at, updated_at`,
      [name, type, location, deaconUserId, latestNotes],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create widow", error);
  }
});

app.put("/api/widows/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const name = normalizeText(req.body.name);
  const type = normalizeText(req.body.type) || "Widowed";
  const location = normalizeText(req.body.location);
  const latestNotes = normalizeText(req.body.latestNotes);
  const rawDeaconUserId = req.body.deaconUserId;
  const deaconUserId =
    rawDeaconUserId === undefined || rawDeaconUserId === null || rawDeaconUserId === ""
      ? null
      : Number(rawDeaconUserId);

  if (!id || !name) {
    return res.status(400).json({ error: "ID and name are required." });
  }

  if (!isAllowedWidowType(type)) {
    return res.status(400).json({ error: "Invalid widow type." });
  }

  if (deaconUserId !== null && Number.isNaN(deaconUserId)) {
    return res.status(400).json({ error: "Invalid deacon selection." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `UPDATE widows
       SET name = $1,
           type = $2,
           location = $3,
           deacon_user_id = $4,
           latest_notes = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, type, location, deacon_user_id, latest_notes, created_at, updated_at`,
      [name, type, location, deaconUserId, latestNotes, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Widow not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update widow", error);
  }
});

app.delete("/api/widows/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM widows WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Widow not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete widow", error);
  }
});

app.get("/api/benevolence", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.name, b.request, b.request_date, b.amount, b.is_filled, b.date_filled,
                    b.deacon_user_id, b.created_at, b.updated_at,
                    u.email AS deacon_email, u.type AS deacon_type
             FROM benevolence_requests b
             LEFT JOIN users u ON u.id = b.deacon_user_id
             ORDER BY b.request_date DESC, b.created_at DESC`,
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load benevolence requests", error);
  }
});

app.post("/api/benevolence", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const request = normalizeText(req.body.request);
  const requestDate = normalizeDate(req.body.requestDate);
  const amount = parseAmount(req.body.amount);
  const isFilled = normalizeBoolean(req.body.isFilled);
  const dateFilled = normalizeDate(req.body.dateFilled);
  const hasDeaconUserId = req.body.deaconUserId !== undefined && req.body.deaconUserId !== null && req.body.deaconUserId !== "";
  const deaconUserId = hasDeaconUserId ? Number(req.body.deaconUserId) : null;

  if (!name || !request || !requestDate || amount === null) {
    return res.status(400).json({ error: "Name, request, request date, and amount are required." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `INSERT INTO benevolence_requests (name, request, request_date, amount, is_filled, date_filled, deacon_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
      [name, request, requestDate, amount, isFilled, isFilled ? dateFilled : null, deaconUserId],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create benevolence request", error);
  }
});

app.put("/api/benevolence/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const name = normalizeText(req.body.name);
  const request = normalizeText(req.body.request);
  const requestDate = normalizeDate(req.body.requestDate);
  const amount = parseAmount(req.body.amount);
  const isFilled = normalizeBoolean(req.body.isFilled);
  const dateFilled = normalizeDate(req.body.dateFilled);
  const hasDeaconUserId = req.body.deaconUserId !== undefined && req.body.deaconUserId !== null && req.body.deaconUserId !== "";
  const deaconUserId = hasDeaconUserId ? Number(req.body.deaconUserId) : null;

  if (!id || !name || !request || !requestDate || amount === null) {
    return res.status(400).json({ error: "ID, name, request, request date, and amount are required." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `UPDATE benevolence_requests
             SET name = $1, request = $2, request_date = $3, amount = $4,
                 is_filled = $5, date_filled = $6, deacon_user_id = $7, updated_at = NOW()
             WHERE id = $8
             RETURNING *`,
      [name, request, requestDate, amount, isFilled, isFilled ? dateFilled : null, deaconUserId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Benevolence request not found." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update benevolence request", error);
  }
});

app.delete("/api/benevolence/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM benevolence_requests WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Benevolence request not found." });
    }
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete benevolence request", error);
  }
});

// ── Ministry: work requests ────────────────────────────────────────────────────

app.get("/api/work", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.name, w.request, w.request_date, w.is_fulfilled, w.date_fulfilled,
                    w.deacon_user_id, w.created_at, w.updated_at,
                    u.email AS deacon_email, u.type AS deacon_type
             FROM work_requests w
             LEFT JOIN users u ON u.id = w.deacon_user_id
             ORDER BY w.request_date DESC, w.created_at DESC`,
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load work requests", error);
  }
});

app.post("/api/work", requireAuth, async (req, res) => {
  const name = normalizeText(req.body.name);
  const request = normalizeText(req.body.request);
  const requestDate = normalizeDate(req.body.requestDate);
  const isFulfilled = normalizeBoolean(req.body.isFulfilled);
  const dateFulfilled = normalizeDate(req.body.dateFulfilled);
  const hasDeaconUserId = req.body.deaconUserId !== undefined && req.body.deaconUserId !== null && req.body.deaconUserId !== "";
  const deaconUserId = hasDeaconUserId ? Number(req.body.deaconUserId) : null;

  if (!name || !request || !requestDate) {
    return res.status(400).json({ error: "Name, request, and request date are required." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `INSERT INTO work_requests (name, request, request_date, is_fulfilled, date_fulfilled, deacon_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
      [name, request, requestDate, isFulfilled, isFulfilled ? dateFulfilled : null, deaconUserId],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create work request", error);
  }
});

app.put("/api/work/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const name = normalizeText(req.body.name);
  const request = normalizeText(req.body.request);
  const requestDate = normalizeDate(req.body.requestDate);
  const isFulfilled = normalizeBoolean(req.body.isFulfilled);
  const dateFulfilled = normalizeDate(req.body.dateFulfilled);
  const hasDeaconUserId = req.body.deaconUserId !== undefined && req.body.deaconUserId !== null && req.body.deaconUserId !== "";
  const deaconUserId = hasDeaconUserId ? Number(req.body.deaconUserId) : null;

  if (!id || !name || !request || !requestDate) {
    return res.status(400).json({ error: "ID, name, request, and request date are required." });
  }

  try {
    if (deaconUserId !== null) {
      const assignable = await requireAssignableUser(deaconUserId);
      if (!assignable) {
        return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
      }
    }

    const result = await pool.query(
      `UPDATE work_requests
             SET name = $1, request = $2, request_date = $3,
                 is_fulfilled = $4, date_fulfilled = $5, deacon_user_id = $6, updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
      [name, request, requestDate, isFulfilled, isFulfilled ? dateFulfilled : null, deaconUserId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Work request not found." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update work request", error);
  }
});

app.delete("/api/work/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM work_requests WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Work request not found." });
    }
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete work request", error);
  }
});

// ── Ministry: calendar (schedule entries) ─────────────────────────────────────

app.get("/api/calendar", requireAuth, async (req, res) => {
  const month = String(req.query.month || "").trim();

  try {
    if (!month) {
      const result = await pool.query(
        `SELECT s.*, u.email AS created_by_email, u.name AS created_by_name
                 FROM schedule_entries s
                 LEFT JOIN users u ON u.id = s.created_by_user_id
                 ORDER BY s.entry_date ASC, s.created_at ASC`,
      );
      return res.json(result.rows);
    }

    const monthStart = `${month}-01`;
    const result = await pool.query(
      `SELECT s.*, u.email AS created_by_email, u.name AS created_by_name
             FROM schedule_entries s
             LEFT JOIN users u ON u.id = s.created_by_user_id
             WHERE DATE_TRUNC('month', s.entry_date) = DATE_TRUNC('month', $1::date)
             ORDER BY s.entry_date ASC, s.created_at ASC`,
      [monthStart],
    );
    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load calendar entries", error);
  }
});

app.post("/api/calendar", requireAuth, async (req, res) => {
  const title = normalizeText(req.body.title);
  const details = normalizeText(req.body.details);
  const entryDate = normalizeDate(req.body.entryDate);
  const createdByUserId = req.session.userId;

  if (!title || !entryDate) {
    return res.status(400).json({ error: "Title and date are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO schedule_entries (title, details, entry_date, created_by_user_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
      [title, details, entryDate, createdByUserId],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create calendar entry", error);
  }
});

app.put("/api/calendar/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const title = normalizeText(req.body.title);
  const details = normalizeText(req.body.details);
  const entryDate = normalizeDate(req.body.entryDate);

  if (!id || !title || !entryDate) {
    return res.status(400).json({ error: "ID, title, and date are required." });
  }

  try {
    const result = await pool.query(
      `UPDATE schedule_entries
             SET title = $1, details = $2, entry_date = $3, updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
      [title, details, entryDate, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Calendar entry not found." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update calendar entry", error);
  }
});

app.delete("/api/calendar/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM schedule_entries WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Calendar entry not found." });
    }
    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete calendar entry", error);
  }
});

// ── Ministry: information ─────────────────────────────────────────────────────

app.get("/api/information", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, u.email AS deacon_email, u.type AS deacon_type
       FROM information_entries i
       JOIN users u ON u.id = i.deacon_user_id
       ORDER BY i.created_at DESC`,
    );

    return res.json(result.rows);
  } catch (error) {
    return handleServerError(res, "Failed to load information entries", error);
  }
});

app.post("/api/information", requireAuth, async (req, res) => {
  const title = normalizeText(req.body.title);
  const details = normalizeText(req.body.details);
  const deaconUserId = Number(req.body.deaconUserId);

  if (!title || !details || !deaconUserId) {
    return res.status(400).json({ error: "Title, details, and deacon selection are required." });
  }

  try {
    const assignable = await requireAssignableUser(deaconUserId);
    if (!assignable) {
      return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
    }

    const result = await pool.query(
      `INSERT INTO information_entries (title, details, deacon_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, details, deaconUserId],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to create information entry", error);
  }
});

app.put("/api/information/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const title = normalizeText(req.body.title);
  const details = normalizeText(req.body.details);
  const deaconUserId = Number(req.body.deaconUserId);

  if (!id || !title || !details || !deaconUserId) {
    return res.status(400).json({ error: "ID, title, details, and deacon selection are required." });
  }

  try {
    const assignable = await requireAssignableUser(deaconUserId);
    if (!assignable) {
      return res.status(400).json({ error: "Selected user must be a Deacon or Yokefellow." });
    }

    const result = await pool.query(
      `UPDATE information_entries
       SET title = $1,
           details = $2,
           deacon_user_id = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [title, details, deaconUserId, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Information entry not found." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return handleServerError(res, "Failed to update information entry", error);
  }
});

app.delete("/api/information/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID is required." });
  }

  try {
    const result = await pool.query("DELETE FROM information_entries WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Information entry not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(res, "Failed to delete information entry", error);
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`deacons-api running on http://localhost:${PORT}`);
});
