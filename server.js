require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-in-production";
const DB_FILE = process.env.DB_FILE || "bank.db";
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || "";

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

const mailer = EMAIL_USER && EMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD }
    })
  : null;

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','admin')),
      is_active INTEGER NOT NULL DEFAULT 1,
      account_status TEXT NOT NULL DEFAULT 'active',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY(from_user_id) REFERENCES users(id),
      FOREIGN KEY(to_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_users (
      email TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      verification_code_hash TEXT NOT NULL,
      code_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasIsActive = userColumns.some((col) => col.name === "is_active");
  const hasAccountStatus = userColumns.some((col) => col.name === "account_status");
  if (!hasIsActive) {
    db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasAccountStatus) {
    db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'");
    db.exec("UPDATE users SET account_status = CASE WHEN is_active = 1 THEN 'active' ELSE 'blocked' END");
  }

  const adminEmail = "admin@bank.local";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existing) {
    const admin = {
      id: uid("usr"),
      full_name: "System Admin",
      email: adminEmail,
      password_hash: bcrypt.hashSync("admin123", 10),
      role: "admin",
      is_active: 1,
      balance: 5000,
      created_at: new Date().toISOString()
    };

    db.prepare(
      `INSERT INTO users (id, full_name, email, password_hash, role, balance, created_at)
       VALUES (@id, @full_name, @email, @password_hash, @role, @balance, @created_at)`
    ).run(admin);
  }
}

initDb();

const app = express();
app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing token." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare("SELECT id, full_name, email, role, account_status, balance, created_at FROM users WHERE id = ?")
      .get(payload.sub);

    if (!user) {
      return res.status(401).json({ error: "Invalid session." });
    }
    if (user.account_status === "blocked") {
      return res.status(403).json({ error: "Your account is blocked. Contact admin." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function assertOperationalAccount(user, res) {
  if (user.account_status === "frozen") {
    res.status(403).json({ error: "Your account is frozen. Contact admin." });
    return false;
  }
  if (user.account_status === "blocked") {
    res.status(403).json({ error: "Your account is blocked. Contact admin." });
    return false;
  }
  return true;
}

async function sendVerificationEmail(email, fullName, code) {
  if (!mailer) {
    throw new Error("Email service is not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in .env.");
  }

  await mailer.sendMail({
    from: `Bank App <${EMAIL_USER}>`,
    to: email,
    subject: "Your Bank verification code",
    text: `Hi ${fullName}, your verification code is ${code}. It expires in 10 minutes.`
  });
}

app.post("/api/auth/register", async (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!fullName || !email || password.length < 6) {
    return res.status(400).json({ error: "Invalid registration details." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "Email is already registered." });
  }

  const code = createOtpCode();
  const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO pending_users (email, full_name, password_hash, verification_code_hash, code_expires_at, created_at)
     VALUES (@email, @full_name, @password_hash, @verification_code_hash, @code_expires_at, @created_at)
     ON CONFLICT(email) DO UPDATE SET
       full_name = excluded.full_name,
       password_hash = excluded.password_hash,
       verification_code_hash = excluded.verification_code_hash,
       code_expires_at = excluded.code_expires_at,
       created_at = excluded.created_at`
  ).run({
    email,
    full_name: fullName,
    password_hash: bcrypt.hashSync(password, 10),
    verification_code_hash: bcrypt.hashSync(code, 10),
    code_expires_at: codeExpiresAt,
    created_at: new Date().toISOString()
  });

  try {
    await sendVerificationEmail(email, fullName, code);
    return res.status(202).json({ message: "Verification code sent to your email." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to send verification email." });
  }
});

app.post("/api/auth/verify", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();

  if (!email || !code) {
    return res.status(400).json({ error: "Email and code are required." });
  }

  const pending = db
    .prepare("SELECT email, full_name, password_hash, verification_code_hash, code_expires_at FROM pending_users WHERE email = ?")
    .get(email);

  if (!pending) {
    return res.status(404).json({ error: "No pending registration for this email." });
  }

  if (new Date(pending.code_expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: "Verification code expired. Please register again." });
  }

  if (!bcrypt.compareSync(code, pending.verification_code_hash)) {
    return res.status(400).json({ error: "Invalid verification code." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    db.prepare("DELETE FROM pending_users WHERE email = ?").run(email);
    return res.status(409).json({ error: "Email is already registered." });
  }

  const user = {
    id: uid("usr"),
    full_name: pending.full_name,
    email: pending.email,
    password_hash: pending.password_hash,
    role: "user",
    is_active: 1,
    balance: 1000,
    created_at: new Date().toISOString()
  };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, full_name, email, password_hash, role, balance, created_at)
       VALUES (@id, @full_name, @email, @password_hash, @role, @balance, @created_at)`
    ).run(user);
    db.prepare("DELETE FROM pending_users WHERE email = ?").run(email);
  })();

  const safeUser = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    balance: user.balance,
    createdAt: user.created_at
  };

  return res.status(201).json({ token: signToken(user), user: safeUser });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const row = db
    .prepare("SELECT id, full_name, email, password_hash, role, account_status, balance, created_at FROM users WHERE email = ?")
    .get(email);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid login credentials." });
  }
  if (row.account_status === "blocked") {
    return res.status(403).json({ error: "Your account is blocked. Contact admin." });
  }

  const safeUser = {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    balance: row.balance,
    createdAt: row.created_at
  };

  return res.json({ token: signToken(row), user: safeUser });
});

app.get("/api/me", auth, (req, res) => {
  const user = db
    .prepare("SELECT id, full_name, email, role, account_status, balance, created_at FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      accountStatus: user.account_status,
      balance: user.balance,
      createdAt: user.created_at
    }
  });
});

app.put("/api/me", auth, (req, res) => {
  if (!assertOperationalAccount(req.user, res)) return;
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const newPassword = String(req.body.password || "").trim();

  if (!fullName || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  const duplicate = db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(email, req.user.id);
  if (duplicate) {
    return res.status(409).json({ error: "Email is already used by another account." });
  }

  if (newPassword) {
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    db.prepare("UPDATE users SET full_name = ?, email = ?, password_hash = ? WHERE id = ?")
      .run(fullName, email, bcrypt.hashSync(newPassword, 10), req.user.id);
  } else {
    db.prepare("UPDATE users SET full_name = ?, email = ? WHERE id = ?").run(fullName, email, req.user.id);
  }

  const user = db
    .prepare("SELECT id, full_name, email, role, account_status, balance, created_at FROM users WHERE id = ?")
    .get(req.user.id);

  return res.json({
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      accountStatus: user.account_status,
      balance: user.balance,
      createdAt: user.created_at
    }
  });
});

app.get("/api/users", auth, (req, res) => {
  const users = db
    .prepare("SELECT id, full_name, email FROM users WHERE id <> ? ORDER BY created_at DESC")
    .all(req.user.id)
    .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }));

  return res.json({ users });
});

app.post("/api/transfers", auth, (req, res) => {
  if (!assertOperationalAccount(req.user, res)) return;
  const toUserId = String(req.body.toUserId || "").trim();
  const amount = Number(req.body.amount);

  if (!toUserId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer details." });
  }

  if (toUserId === req.user.id) {
    return res.status(400).json({ error: "Cannot transfer to your own account." });
  }

  const fromUser = db.prepare("SELECT id, balance FROM users WHERE id = ?").get(req.user.id);
  const toUser = db.prepare("SELECT id, email, account_status FROM users WHERE id = ?").get(toUserId);

  if (!toUser) {
    return res.status(404).json({ error: "Recipient not found." });
  }
  if (toUser.account_status !== "active") {
    return res.status(400).json({ error: `Recipient account is ${toUser.account_status}.` });
  }

  if (fromUser.balance < amount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  const transfer = db.transaction(() => {
    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, req.user.id);
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, toUserId);
    db.prepare("INSERT INTO transactions (id, from_user_id, to_user_id, amount, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(uid("tx"), req.user.id, toUserId, amount, new Date().toISOString());
  });

  transfer();

  const refreshed = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);

  return res.status(201).json({
    message: `Transferred $${amount.toFixed(2)} to ${toUser.email}.`,
    balance: refreshed.balance
  });
});

app.get("/api/transactions", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.from_user_id, t.to_user_id, t.amount, t.created_at,
              f.email AS from_email, to_u.email AS to_email
       FROM transactions t
       JOIN users f ON f.id = t.from_user_id
       JOIN users to_u ON to_u.id = t.to_user_id
       WHERE t.from_user_id = ? OR t.to_user_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(req.user.id, req.user.id);

  return res.json({
    transactions: rows.map((t) => ({
      id: t.id,
      fromUserId: t.from_user_id,
      toUserId: t.to_user_id,
      fromEmail: t.from_email,
      toEmail: t.to_email,
      amount: t.amount,
      createdAt: t.created_at
    }))
  });
});

app.get("/api/admin/users", auth, requireAdmin, (req, res) => {
  const users = db
    .prepare("SELECT id, full_name, email, role, account_status, balance, created_at FROM users ORDER BY created_at DESC")
    .all()
    .map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      role: u.role,
      accountStatus: u.account_status,
      balance: u.balance,
      createdAt: u.created_at
    }));

  return res.json({ users });
});

app.put("/api/admin/users/:id/balance", auth, requireAdmin, (req, res) => {
  const userId = String(req.params.id || "").trim();
  const balance = Number(req.body.balance);

  if (!Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: "Balance must be a non-negative number." });
  }

  const found = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  if (!found) {
    return res.status(404).json({ error: "User not found." });
  }

  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balance, userId);

  return res.json({ message: `Balance updated for ${found.email}.` });
});

app.put("/api/admin/users/:id/role", auth, requireAdmin, (req, res) => {
  const userId = String(req.params.id || "").trim();
  const role = String(req.body.role || "").trim();
  if (role !== "user" && role !== "admin") {
    return res.status(400).json({ error: "Role must be user or admin." });
  }

  const found = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  if (!found) return res.status(404).json({ error: "User not found." });

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  return res.json({ message: `Role updated for ${found.email}.` });
});

app.put("/api/admin/users/:id/status", auth, requireAdmin, (req, res) => {
  const userId = String(req.params.id || "").trim();
  const accountStatus = String(req.body.accountStatus || "").trim();
  if (!["active", "frozen", "blocked"].includes(accountStatus)) {
    return res.status(400).json({ error: "Status must be active, frozen, or blocked." });
  }
  const found = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  if (!found) return res.status(404).json({ error: "User not found." });
  if (req.user.id === userId && accountStatus !== "active") {
    return res.status(400).json({ error: "You cannot freeze or block your own admin account." });
  }
  const isActive = accountStatus === "blocked" ? 0 : 1;
  db.prepare("UPDATE users SET account_status = ?, is_active = ? WHERE id = ?").run(accountStatus, isActive, userId);
  return res.json({ message: `${found.email} is now ${accountStatus}.` });
});

app.delete("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  const userId = String(req.params.id || "").trim();
  if (req.user.id === userId) {
    return res.status(400).json({ error: "You cannot delete your own admin account." });
  }
  const found = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  if (!found) return res.status(404).json({ error: "User not found." });

  db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE from_user_id = ? OR to_user_id = ?").run(userId, userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  return res.json({ message: `Deleted user ${found.email}.` });
});

app.get("/api/admin/transactions", auth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.amount, t.created_at, f.email AS from_email, to_u.email AS to_email
       FROM transactions t
       JOIN users f ON f.id = t.from_user_id
       JOIN users to_u ON to_u.id = t.to_user_id
       ORDER BY t.created_at DESC`
    )
    .all();

  return res.json({
    transactions: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      createdAt: r.created_at,
      fromEmail: r.from_email,
      toEmail: r.to_email
    }))
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bank app running on http://localhost:${PORT}`);
});
