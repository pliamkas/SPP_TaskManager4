const express = require('express');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const { db, initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [/^http:\/\/localhost:\d+$/],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploads for client access
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Multer storage for attachments
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    let originalName = file.originalname;
    if (originalName.includes('Ð') || originalName.includes('Ñ')) {
      try { originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch (e) {}
    }
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext).replace(/[<>:"/\\|?*]/g, '_');
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

function normalizeTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    attachments: task.attachments?.map(a => ({
      id: a.id,
      filename: a.filename,
      originalName: a.original_name,
      filePath: a.file_path,
      url: `/uploads/${a.filename}`,
      uploadedAt: a.uploaded_at
    })) || []
  };
}

const api = express.Router();

api.get('/tasks', async (req, res) => {
  try {
    const statusFilter = req.query.status || 'all';
    const tasks = await db.getAllTasks(statusFilter);
    res.status(200).json(tasks.map(normalizeTask));
  } catch (e) {
    console.error('GET /api/tasks error:', e);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

api.get('/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const task = await db.getTaskById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.status(200).json(normalizeTask(task));
  } catch (e) {
    console.error('GET /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

api.post('/tasks', async (req, res) => {
  try {
    const { title, description, status, dueDate } = req.body;
    if (!title || typeof title !== 'string') return res.status(400).json({ error: 'Title is required' });
    const created = await db.createTask({ title, description: description || '', status: status || 'pending', dueDate: dueDate || null });
    const full = await db.getTaskById(created.id);
    res.status(201).json(normalizeTask(full));
  } catch (e) {
    console.error('POST /api/tasks error:', e);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

api.put('/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await db.getTaskById(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const { title, description, status, dueDate } = req.body;
    const updated = await db.updateTask(id, {
      title: title ?? existing.title,
      description: description ?? existing.description,
      status: status ?? existing.status,
      dueDate: dueDate ?? (existing.due_date ? new Date(existing.due_date).toISOString().slice(0, 10) : null)
    });
    const full = await db.getTaskById(updated.id);
    res.status(200).json(normalizeTask(full));
  } catch (e) {
    console.error('PUT /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

api.delete('/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await db.getTaskById(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    await db.deleteTask(id);
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

api.post('/tasks/:id/attachments', upload.single('attachment'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await db.getTaskById(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let displayName = req.file.originalname;
    if (displayName.includes('Ð') || displayName.includes('Ñ')) {
      try { displayName = Buffer.from(displayName, 'latin1').toString('utf8'); } catch (e) {}
    }

    const created = await db.addAttachment(id, {
      filename: req.file.filename,
      originalName: displayName,
      filePath: req.file.path
    });

    res.status(201).json({
      id: created.id,
      filename: created.filename,
      originalName: created.original_name,
      filePath: created.file_path,
      url: `/uploads/${created.filename}`,
      uploadedAt: created.uploaded_at
    });
  } catch (e) {
    console.error('POST /api/tasks/:id/attachments error:', e);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

api.delete('/attachments/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.deleteAttachment(id);
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /api/attachments/:id error:', e);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

app.use('/api', api);

async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
}

start();
