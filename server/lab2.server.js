const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { db, initializeDatabase } = require('./database');
const { initializeUsersTable, userDb, tokenUtils, authMiddleware } = require('./auth');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [/^http:\/\/localhost:\d+$/],
    methods: ['GET', 'POST'],
    credentials: true
  }
});
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [/^http:\/\/localhost:\d+$/],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Allow cookies to be sent
}));

app.use(cookieParser());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Ensure uploads directory exists and serve it
const uploadsDir = path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) { console.error('Failed to ensure uploads dir:', e); }
app.use('/uploads', express.static(uploadsDir));

// Multer storage for attachments
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '..', 'uploads');
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      return cb(e);
    }
    cb(null, dir);
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
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    files: 10 // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /image\/jpeg|image\/jpg|image\/png|image\/gif|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain|application\/zip|application\/x-rar-compressed/.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only images, PDFs, documents, and archives are allowed'));
    }
  }
});

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

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: 'Username must be 3-50 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    
    // Check if user already exists
    const existingUser = await userDb.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Check if email already exists
    const existingEmail = await userDb.getUserByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Create user
    const user = await userDb.createUser({ username, email, password });
    
    // Generate token
    const token = tokenUtils.generateToken(user);
    
    // Set httpOnly cookie
    res.cookie('authToken', token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    });
    
    res.status(201).json({ 
      message: 'User created successfully',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Verify credentials
    const user = await userDb.verifyPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = tokenUtils.generateToken(user);
    
    // Set httpOnly cookie
    res.cookie('authToken', token, {
      httpOnly: true,
      secure: false, 
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    });
    
    res.status(200).json({ 
      message: 'Login successful',
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('authToken');
  res.status(200).json({ message: 'Logout successful' });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.status(200).json({ 
    user: { 
      id: req.user.id, 
      username: req.user.username, 
      email: req.user.email 
    } 
  });
});

const api = express.Router();

api.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const statusFilter = req.query.status || 'all';
    const tasks = await db.getAllTasks(statusFilter, req.user.id);
    res.status(200).json(tasks.map(normalizeTask));
  } catch (e) {
    console.error('GET /api/tasks error:', e);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

api.get('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const task = await db.getTaskById(id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.status(200).json(normalizeTask(task));
  } catch (e) {
    console.error('GET /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

api.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { title, description, status, dueDate } = req.body;
    
    // Validation
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (title.length > 255) {
      return res.status(400).json({ error: 'Title must be 255 characters or less' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Description must be 10,000 characters or less' });
    }
    
    const created = await db.createTask({ title, description: description || '', status: status || 'pending', dueDate: dueDate || null, userId: req.user.id });
    const full = await db.getTaskById(created.id, req.user.id);
    res.status(201).json(normalizeTask(full));
  } catch (e) {
    console.error('POST /api/tasks error:', e);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

api.put('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let existing = await db.getTaskById(id, req.user.id);
    if (!existing) {
      const claimed = await db.claimTaskOwner(id, req.user.id);
      if (claimed) {
        existing = claimed;
      } else {
        return res.status(404).json({ error: 'Task not found' });
      }
    }
    const { title, description, status, dueDate } = req.body;
    
    // Validation
    const newTitle = title ?? existing.title;
    const newDescription = description ?? existing.description;
    
    if (newTitle && newTitle.length > 255) {
      return res.status(400).json({ error: 'Title must be 255 characters or less' });
    }
    if (newDescription && newDescription.length > 10000) {
      return res.status(400).json({ error: 'Description must be 10,000 characters or less' });
    }
    
    const updated = await db.updateTask(id, {
      title: newTitle,
      description: newDescription,
      status: status ?? existing.status,
      dueDate: dueDate ?? (existing.due_date ? new Date(existing.due_date).toISOString().slice(0, 10) : null),
      userId: req.user.id
    });
    const full = await db.getTaskById(updated.id, req.user.id);
    res.status(200).json(normalizeTask(full));
  } catch (e) {
    console.error('PUT /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

api.delete('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let existing = await db.getTaskById(id, req.user.id);
    if (!existing) {
      const claimed = await db.claimTaskOwner(id, req.user.id);
      if (claimed) {
        existing = claimed;
      } else {
        return res.status(404).json({ error: 'Task not found' });
      }
    }
    await db.deleteTask(id, req.user.id);
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /api/tasks/:id error:', e);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

api.post('/tasks/:id/attachments', authMiddleware, upload.array('attachment', 10), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let existing = await db.getTaskById(id, req.user.id);
    if (!existing) {
      // Backward-compat: claim orphan tasks created before user_id migration
      const claimed = await db.claimTaskOwner(id, req.user.id);
      if (claimed) {
        existing = claimed;
      } else {
        return res.status(404).json({ error: 'Task not found' });
      }
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const uploadedFiles = [];
    
    for (const file of req.files) {
      let displayName = file.originalname;
      if (displayName.includes('Ð') || displayName.includes('Ñ')) {
        try { displayName = Buffer.from(displayName, 'latin1').toString('utf8'); } catch (e) {}
      }

      const created = await db.addAttachment(id, {
        filename: file.filename,
        originalName: displayName,
        filePath: file.path
      });

      uploadedFiles.push({
        id: created.id,
        filename: created.filename,
        originalName: created.original_name,
        filePath: created.file_path,
        url: `/uploads/${created.filename}`,
        uploadedAt: created.uploaded_at
      });
    }

    res.status(201).json(uploadedFiles);
  } catch (e) {
    console.error('POST /api/tasks/:id/attachments error:', e);
    if (e.message.includes('Only images, PDFs')) {
      res.status(400).json({ error: e.message });
    } else if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum size is 5MB per file.' });
    } else if (e.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: 'Too many files. Maximum 10 files per upload.' });
    } else {
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  }
});

api.delete('/attachments/:id', authMiddleware, async (req, res) => {
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

// Socket.IO event handlers mirroring REST API
io.on('connection', (socket) => {
  // AUTH
  socket.on('auth:register', async (data, callback) => {
    try {
      const { username, email, password } = data || {};
      if (!username || !email || !password) {
        return callback({ error: 'Username, email, and password are required' });
      }
      if (username.length < 3 || username.length > 50) {
        return callback({ error: 'Username must be 3-50 characters' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return callback({ error: 'Please enter a valid email address' });
      }
      if (password.length < 6) {
        return callback({ error: 'Password must be at least 6 characters' });
      }

      const existingUser = await userDb.getUserByUsername(username);
      if (existingUser) return callback({ error: 'Username already exists' });
      const existingEmail = await userDb.getUserByEmail(email);
      if (existingEmail) return callback({ error: 'Email already exists' });

      const user = await userDb.createUser({ username, email, password });
      const token = tokenUtils.generateToken(user);
      callback({ user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (error) {
      console.error('Socket register error:', error);
      callback({ error: 'Registration failed' });
    }
  });

  socket.on('auth:login', async (data, callback) => {
    try {
      const { username, password } = data || {};
      if (!username || !password) {
        return callback({ error: 'Username and password are required' });
      }
      const user = await userDb.verifyPassword(username, password);
      if (!user) return callback({ error: 'Invalid username or password' });
      const token = tokenUtils.generateToken(user);
      callback({ user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (error) {
      console.error('Socket login error:', error);
      callback({ error: 'Login failed' });
    }
  });

  socket.on('auth:logout', (data, callback) => {
    if (typeof callback === 'function') {
      callback({ message: 'Logout successful' });
    }
  });

  socket.on('auth:me', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'Authentication required' });
      callback({ user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
      console.error('Socket me error:', error);
      callback({ error: 'Authentication failed' });
    }
  });

  // Helper to require auth per-event
  const requireAuth = async (data) => {
    const token = (socket.handshake.auth && socket.handshake.auth.token) ||
      ((socket.handshake.headers && socket.handshake.headers.cookie || '').match(/(?:^|; )authToken=([^;]+)/)?.[1] && decodeURIComponent((socket.handshake.headers.cookie.match(/(?:^|; )authToken=([^;]+)/) || [])[1])) ||
      (data && data.token) || null;
    if (!token) return null;
    const decoded = tokenUtils.verifyToken(token);
    if (!decoded) return null;
    const user = await userDb.getUserById(decoded.userId);
    return user || null;
  };

  // TASKS
  socket.on('tasks:get', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const statusFilter = (data && data.status) || 'all';
      const tasks = await db.getAllTasks(statusFilter, user.id);
      callback(tasks.map(normalizeTask));
    } catch (e) {
      console.error('Socket tasks:get error:', e);
      callback({ error: 'Failed to fetch tasks' });
    }
  });

  socket.on('tasks:getById', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const id = parseInt(data && data.id);
      const task = await db.getTaskById(id, user.id);
      if (!task) return callback({ error: 'Task not found' });
      callback(normalizeTask(task));
    } catch (e) {
      console.error('Socket tasks:getById error:', e);
      callback({ error: 'Failed to fetch task' });
    }
  });

  socket.on('tasks:create', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const { title, description, status, dueDate } = data || {};
      if (!title || typeof title !== 'string') return callback({ error: 'Title is required' });
      if (title.length > 255) return callback({ error: 'Title must be 255 characters or less' });
      if (description && description.length > 10000) return callback({ error: 'Description must be 10,000 characters or less' });
      const created = await db.createTask({ title, description: description || '', status: status || 'pending', dueDate: dueDate || null, userId: user.id });
      const full = await db.getTaskById(created.id, user.id);
      const normalized = normalizeTask(full);
      callback(normalized);
      io.emit('tasks:created', normalized);
    } catch (e) {
      console.error('Socket tasks:create error:', e);
      callback({ error: 'Failed to create task' });
    }
  });

  socket.on('tasks:update', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const { id, title, description, status, dueDate } = data || {};
      const existing = await db.getTaskById(parseInt(id), user.id);
      if (!existing) return callback({ error: 'Task not found' });
      const newTitle = title ?? existing.title;
      const newDescription = description ?? existing.description;
      if (newTitle && newTitle.length > 255) return callback({ error: 'Title must be 255 characters or less' });
      if (newDescription && newDescription.length > 10000) return callback({ error: 'Description must be 10,000 characters or less' });
      const updated = await db.updateTask(parseInt(id), {
        title: newTitle,
        description: newDescription,
        status: status ?? existing.status,
        dueDate: dueDate ?? (existing.due_date ? new Date(existing.due_date).toISOString().slice(0, 10) : null),
        userId: user.id
      });
      const full = await db.getTaskById(updated.id, user.id);
      const normalized = normalizeTask(full);
      callback(normalized);
      io.emit('tasks:updated', normalized);
    } catch (e) {
      console.error('Socket tasks:update error:', e);
      callback({ error: 'Failed to update task' });
    }
  });

  socket.on('tasks:delete', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const id = parseInt(data && data.id);
      const existing = await db.getTaskById(id, user.id);
      if (!existing) return callback({ error: 'Task not found' });
      await db.deleteTask(id, user.id);
      callback({ success: true });
      io.emit('tasks:deleted', { id });
    } catch (e) {
      console.error('Socket tasks:delete error:', e);
      callback({ error: 'Failed to delete task' });
    }
  });

  socket.on('attachments:delete', async (data, callback) => {
    try {
      const user = await requireAuth(data);
      if (!user) return callback({ error: 'AUTH_REQUIRED' });
      const id = parseInt(data && data.id);
      await db.deleteAttachment(id);
      callback({ success: true });
      io.emit('attachments:deleted', { id });
    } catch (e) {
      console.error('Socket attachments:delete error:', e);
      callback({ error: 'Failed to delete attachment' });
    }
  });
});

async function start() {
  try {
    await initializeDatabase();
    await initializeUsersTable();
    server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
}

start();
