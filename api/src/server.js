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
    const [widowCount, benevolenceCount, workCount, informationCount, nextEntries] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM widows"),
      pool.query("SELECT COUNT(*)::int AS count FROM benevolence_requests"),
      pool.query("SELECT COUNT(*)::int AS count FROM work_requests"),
      pool.query("SELECT COUNT(*)::int AS count FROM information_entries"),
      pool.query(
        `SELECT s.id, s.entry_date, s.title, s.details, s.created_at, s.updated_at
         FROM schedule_entries s
         WHERE s.entry_date >= CURRENT_DATE
         ORDER BY s.entry_date ASC
         LIMIT 6`,
      ),
    ]);

    return res.json({
      counts: {
        widows: widowCount.rows[0].count,
        benevolence: benevolenceCount.rows[0].count,
        work: workCount.rows[0].count,
        information: informationCount.rows[0].count,
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
