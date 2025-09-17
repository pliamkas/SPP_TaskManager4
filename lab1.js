const express = require('express');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const { db, initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Set proper UTF-8 encoding for all responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Encoding', 'utf-8');
  next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    // Try to fix Cyrillic filename encoding
    let originalName = file.originalname;
    
    // If filename contains corrupted Cyrillic characters, try to fix them
    if (originalName.includes('Ð') || originalName.includes('Ñ')) {
      try {
        // Try to decode the corrupted filename
        originalName = Buffer.from(originalName, 'latin1').toString('utf8');
      } catch (e) {
        // If that fails, keep original
      }
    }
    
    // Clean the filename and preserve the extension
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    const cleanName = baseName.replace(/[<>:"/\\|?*]/g, '_');
    
    const finalName = cleanName + '-' + uniqueSuffix + extension;
    
    // Debug logging
    console.log('File upload debug:');
    console.log('  Original:', file.originalname);
    console.log('  Processed:', originalName);
    console.log('  Final:', finalName);
    
    cb(null, finalName);
  }
});

const upload = multer({ storage: storage });

// Routes
app.get('/', async (req, res) => {
  try {
    const statusFilter = req.query.status || 'all';
    const tasks = await db.getAllTasks(statusFilter);
    
    res.render('index', { 
      tasks, 
      currentFilter: statusFilter,
      statusOptions: ['all', 'pending', 'in-progress', 'completed']
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).send('Error fetching tasks');
  }
});

app.get('/add', (req, res) => {
  res.render('add-task');
});

app.post('/add', upload.single('attachment'), async (req, res) => {
  try {
    const { title, description, status, dueDate } = req.body;
    
    // Create the task
    const newTask = await db.createTask({
      title,
      description,
      status: status || 'pending',
      dueDate
    });
    
    // Add attachment if provided
    if (req.file) {
      // Fix the original name for display
      let displayName = req.file.originalname;
      if (displayName.includes('Ð') || displayName.includes('Ñ')) {
        try {
          displayName = Buffer.from(displayName, 'latin1').toString('utf8');
        } catch (e) {
          // Keep original if conversion fails
        }
      }
      
      await db.addAttachment(newTask.id, {
        filename: req.file.filename,
        originalName: displayName,
        filePath: req.file.path
      });
    }
    
    res.redirect('/');
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).send('Error creating task');
  }
});

app.get('/edit/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const task = await db.getTaskById(taskId);
    
    if (!task) {
      return res.status(404).send('Task not found');
    }
    
    res.render('edit-task', { task });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).send('Error fetching task');
  }
});

app.post('/edit/:id', upload.single('attachment'), async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { title, description, status, dueDate } = req.body;
    
    // Update the task
    const updatedTask = await db.updateTask(taskId, {
      title,
      description,
      status,
      dueDate
    });
    
    if (!updatedTask) {
      return res.status(404).send('Task not found');
    }
    
    // Add new attachment if provided
    if (req.file) {
      // Fix the original name for display
      let displayName = req.file.originalname;
      if (displayName.includes('Ð') || displayName.includes('Ñ')) {
        try {
          displayName = Buffer.from(displayName, 'latin1').toString('utf8');
        } catch (e) {
          // Keep original if conversion fails
        }
      }
      
      await db.addAttachment(taskId, {
        filename: req.file.filename,
        originalName: displayName,
        filePath: req.file.path
      });
    }
    
    res.redirect('/');
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).send('Error updating task');
  }
});

app.post('/delete/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    await db.deleteTask(taskId);
    res.redirect('/');
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).send('Error deleting task');
  }
});

app.post('/toggle-status/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    await db.toggleTaskStatus(taskId);
    res.redirect('/');
  } catch (error) {
    console.error('Error toggling task status:', error);
    res.status(500).send('Error toggling task status');
  }
});

// Start server
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
