import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import client from 'prom-client';
import { query } from './db.js';
import { requireAuth } from './auth-middleware.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

// ── Prometheus metrics ────────────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route?.path || req.path, status: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/readyz', async (req, res) => {
  try {
    await query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not-ready', error: err.message });
  }
});

// ── Validation schemas ─────────────────────────────────────────────────────
const createTaskSchema = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(), // 'YYYY-MM-DD'
});

const updateTaskSchema = createTaskSchema.partial().extend({
  position: z.number().int().optional(),
});

// All task routes require a valid access token issued by Auth Service
app.use('/api/tasks', requireAuth);

// GET /api/tasks?teamId=...&status=todo
app.get('/api/tasks', async (req, res) => {
  const { teamId, status } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId query param required' });

  const params = [teamId];
  let sql = 'SELECT * FROM tasks WHERE team_id = $1';
  if (status) {
    params.push(status);
    sql += ' AND status = $2';
  }
  sql += ' ORDER BY status, position ASC, created_at ASC';

  try {
    const result = await query(sql, params);
    return res.status(200).json({ tasks: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { teamId, title, description, status, assigneeId, dueDate } = parsed.data;

  try {
    const result = await query(
      `INSERT INTO tasks (team_id, title, description, status, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, COALESCE($4, 'todo'), $5, $6, $7)
       RETURNING *`,
      [teamId, title, description || null, status, assigneeId || null, dueDate || null, req.user.id]
    );
    const task = result.rows[0];
    await query(
      'INSERT INTO task_history (task_id, changed_by, change) VALUES ($1, $2, $3)',
      [task.id, req.user.id, JSON.stringify({ created: true })]
    );
    return res.status(201).json({ task });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const fields = parsed.data;
  const { id } = req.params;

  const setClauses = [];
  const values = [];
  let idx = 1;
  const colMap = { title: 'title', description: 'description', status: 'status', assigneeId: 'assignee_id', dueDate: 'due_date', position: 'position' };
  for (const [key, col] of Object.entries(colMap)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${col} = $${idx++}`);
      values.push(fields[key]);
    }
  }
  if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);

  try {
    const result = await query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Task not found' });

    await query(
      'INSERT INTO task_history (task_id, changed_by, change) VALUES ($1, $2, $3)',
      [id, req.user.id, JSON.stringify(fields)]
    );
    return res.status(200).json({ task: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/tasks/:id/history', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM task_history WHERE task_id = $1 ORDER BY changed_at DESC',
      [req.params.id]
    );
    return res.status(200).json({ history: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => console.log(`task-service listening on :${PORT}`));
