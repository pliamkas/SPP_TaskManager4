const { Pool } = require('pg');
require('dotenv').config({ path: './config.env' });

// Database configuration with UTF-8 encoding
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'task_manager',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  client_encoding: 'utf8',
  application_name: 'task_manager'
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize database tables with UTF-8 support
async function initializeDatabase() {
  try {
    // Set client encoding to UTF-8
    await pool.query("SET client_encoding = 'UTF8'");
    
    // Create tasks table with UTF-8 support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        due_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create attachments table with UTF-8 support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attachments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully with UTF-8 support');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Database operations
const db = {
  // Task operations
  async getAllTasks(statusFilter = 'all') {
    let query = 'SELECT * FROM tasks ORDER BY created_at DESC';
    let params = [];
    
    if (statusFilter !== 'all') {
      query = 'SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC';
      params = [statusFilter];
    }
    
    const result = await pool.query(query, params);
    const tasks = result.rows;
    
    // Get attachments for each task
    for (let task of tasks) {
      const attachmentsResult = await pool.query(
        'SELECT * FROM attachments WHERE task_id = $1 ORDER BY uploaded_at ASC',
        [task.id]
      );
      task.attachments = attachmentsResult.rows;
    }
    
    return tasks;
  },

  async getTaskById(id) {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return null;
    }
    
    const task = result.rows[0];
    
    // Get attachments for the task
    const attachmentsResult = await pool.query(
      'SELECT * FROM attachments WHERE task_id = $1 ORDER BY uploaded_at ASC',
      [id]
    );
    task.attachments = attachmentsResult.rows;
    
    return task;
  },

  async createTask(taskData) {
    const { title, description, status, dueDate } = taskData;
    // Convert empty string to null for due_date
    const dueDateValue = dueDate && dueDate.trim() !== '' ? dueDate : null;
    const result = await pool.query(
      'INSERT INTO tasks (title, description, status, due_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, status, dueDateValue]
    );
    return result.rows[0];
  },

  async updateTask(id, taskData) {
    const { title, description, status, dueDate } = taskData;
    // Convert empty string to null for due_date
    const dueDateValue = dueDate && dueDate.trim() !== '' ? dueDate : null;
    const result = await pool.query(
      'UPDATE tasks SET title = $1, description = $2, status = $3, due_date = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [title, description, status, dueDateValue, id]
    );
    return result.rows[0];
  },

  async deleteTask(id) {
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  },

  async toggleTaskStatus(id) {
    const task = await this.getTaskById(id);
    if (!task) return null;
    
    let newStatus;
    if (task.status === 'pending') {
      newStatus = 'in-progress';
    } else if (task.status === 'in-progress') {
      newStatus = 'completed';
    } else if (task.status === 'completed') {
      newStatus = 'pending';
    }
    
    const result = await pool.query(
      'UPDATE tasks SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [newStatus, id]
    );
    return result.rows[0];
  },

  // Attachment operations
  async addAttachment(taskId, attachmentData) {
    const { filename, originalName, filePath } = attachmentData;
    const result = await pool.query(
      'INSERT INTO attachments (task_id, filename, original_name, file_path) VALUES ($1, $2, $3, $4) RETURNING *',
      [taskId, filename, originalName, filePath]
    );
    return result.rows[0];
  },

  async deleteAttachment(id) {
    await pool.query('DELETE FROM attachments WHERE id = $1', [id]);
  },

  // Close database connection
  async close() {
    await pool.end();
  }
};

module.exports = { db, initializeDatabase };
