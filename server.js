import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(express.static(__dirname));

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPrompt(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: Number(row.created_at),
    rating: row.rating,
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

function rowToNote(row) {
  return {
    id: row.id,
    content: row.content,
    createdAt: Number(row.created_at),
    lastEdited: Number(row.last_edited),
  };
}

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.userId, email: req.session.userEmail });
});

app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)',
    [id, email.toLowerCase(), passwordHash, Date.now()]
  );

  req.session.userId = id;
  req.session.userEmail = email.toLowerCase();
  res.status(201).json({ id, email: email.toLowerCase() });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = rows[0].id;
  req.session.userEmail = rows[0].email;
  res.json({ id: rows[0].id, email: rows[0].email });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true })); // eslint-disable-line no-unused-vars
});

// ── Prompts ───────────────────────────────────────────────────────────────────

app.get('/api/prompts', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM prompts WHERE user_id = $1 ORDER BY created_at DESC',
    [req.session.userId]
  );
  res.json(rows.map(rowToPrompt));
}));

app.post('/api/prompts', requireAuth, asyncHandler(async (req, res) => {
  const { id, title, content, createdAt, rating, metadata } = req.body;
  await pool.query(
    'INSERT INTO prompts (id, title, content, created_at, rating, metadata, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, title, content, createdAt, rating ?? 0, metadata ?? null, req.session.userId]
  );
  res.status(201).json({ id });
}));

app.patch('/api/prompts/:id', requireAuth, asyncHandler(async (req, res) => {
  const { title, content, metadata } = req.body;
  await pool.query(
    'UPDATE prompts SET title = $1, content = $2, metadata = $3 WHERE id = $4 AND user_id = $5',
    [title, content, metadata ?? null, req.params.id, req.session.userId]
  );
  res.json({ ok: true });
}));

app.patch('/api/prompts/:id/rating', requireAuth, asyncHandler(async (req, res) => {
  const { rating } = req.body;
  await pool.query(
    'UPDATE prompts SET rating = $1 WHERE id = $2 AND user_id = $3',
    [rating, req.params.id, req.session.userId]
  );
  res.json({ ok: true });
}));

app.delete('/api/prompts', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM prompts WHERE user_id = $1', [req.session.userId]);
  res.json({ ok: true });
}));

app.delete('/api/prompts/:id', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM prompts WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
  res.json({ ok: true });
}));

// ── Notes ─────────────────────────────────────────────────────────────────────

app.get('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT n.* FROM notes n JOIN prompts p ON n.prompt_id = p.id WHERE p.user_id = $1 ORDER BY n.created_at ASC',
    [req.session.userId]
  );
  const notes = {};
  for (const row of rows) {
    if (!notes[row.prompt_id]) notes[row.prompt_id] = [];
    notes[row.prompt_id].push(rowToNote(row));
  }
  res.json(notes);
}));

app.post('/api/notes', requireAuth, asyncHandler(async (req, res) => {
  const { id, promptId, content, createdAt, lastEdited } = req.body;
  // Verify prompt belongs to user
  const { rows } = await pool.query('SELECT id FROM prompts WHERE id = $1 AND user_id = $2', [promptId, req.session.userId]);
  if (rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

  await pool.query(
    'INSERT INTO notes (id, prompt_id, content, created_at, last_edited) VALUES ($1, $2, $3, $4, $5)',
    [id, promptId, content, createdAt, lastEdited]
  );
  res.status(201).json({ id });
}));

app.patch('/api/notes/:id', requireAuth, asyncHandler(async (req, res) => {
  const { content, lastEdited } = req.body;
  await pool.query(
    'UPDATE notes SET content = $1, last_edited = $2 WHERE id = $3 AND prompt_id IN (SELECT id FROM prompts WHERE user_id = $4)',
    [content, lastEdited, req.params.id, req.session.userId]
  );
  res.json({ ok: true });
}));

app.delete('/api/notes/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM notes WHERE id = $1 AND prompt_id IN (SELECT id FROM prompts WHERE user_id = $2) RETURNING *',
    [req.params.id, req.session.userId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rowToNote(rows[0]));
}));

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
