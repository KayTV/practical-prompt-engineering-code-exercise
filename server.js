import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Prompts ───────────────────────────────────────────────────────────────────

app.get('/api/prompts', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM prompts ORDER BY created_at DESC');
  res.json(rows.map(rowToPrompt));
}));

app.post('/api/prompts', asyncHandler(async (req, res) => {
  const { id, title, content, createdAt, rating, metadata } = req.body;
  await pool.query(
    'INSERT INTO prompts (id, title, content, created_at, rating, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, title, content, createdAt, rating ?? 0, metadata ?? null]
  );
  res.status(201).json({ id });
}));

app.patch('/api/prompts/:id/rating', asyncHandler(async (req, res) => {
  const { rating } = req.body;
  await pool.query('UPDATE prompts SET rating = $1 WHERE id = $2', [rating, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/prompts', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM prompts');
  res.json({ ok: true });
}));

app.delete('/api/prompts/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM prompts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Notes ─────────────────────────────────────────────────────────────────────

app.get('/api/notes', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notes ORDER BY created_at ASC');
  const notes = {};
  for (const row of rows) {
    if (!notes[row.prompt_id]) notes[row.prompt_id] = [];
    notes[row.prompt_id].push(rowToNote(row));
  }
  res.json(notes);
}));

app.post('/api/notes', asyncHandler(async (req, res) => {
  const { id, promptId, content, createdAt, lastEdited } = req.body;
  await pool.query(
    'INSERT INTO notes (id, prompt_id, content, created_at, last_edited) VALUES ($1, $2, $3, $4, $5)',
    [id, promptId, content, createdAt, lastEdited]
  );
  res.status(201).json({ id });
}));

app.patch('/api/notes/:id', asyncHandler(async (req, res) => {
  const { content, lastEdited } = req.body;
  await pool.query(
    'UPDATE notes SET content = $1, last_edited = $2 WHERE id = $3',
    [content, lastEdited, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/notes/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM notes WHERE id = $1 RETURNING *', [req.params.id]);
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
