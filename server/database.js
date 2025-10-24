const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') });

// Database configuration with UTF-8 encoding
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
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
        title VARCHAR(255) NOT NULL CHECK (LENGTH(title) <= 255),
        description TEXT CHECK (LENGTH(description) <= 10000),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'completed')),
        due_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add user_id column and FK to users if not exists
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id INTEGER`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_tasks_user' AND table_name = 'tasks'
        ) THEN
          ALTER TABLE tasks ADD CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END$$;
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`);

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
  async getAllTasks(statusFilter = 'all', userId) {
    let query = 'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC';
    let params = [userId];

    if (statusFilter !== 'all') {
      query = 'SELECT * FROM tasks WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC';
      params = [userId, statusFilter];
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

  async getTaskById(id, userId) {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [id, userId]);
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

  // Claim orphan task (no owner) to a user, return task or null
  async claimTaskOwner(id, userId) {
    const result = await pool.query(
      'UPDATE tasks SET user_id = $2 WHERE id = $1 AND user_id IS NULL RETURNING *',
      [id, userId]
    );
    return result.rows[0] || null;
  },

  async createTask(taskData) {
    const { title, description, status, dueDate, userId } = taskData;
    const dueDateValue = dueDate && String(dueDate).trim() !== '' ? dueDate : null;
    const result = await pool.query(
      'INSERT INTO tasks (title, description, status, due_date, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, description, status, dueDateValue, userId]
    );
    return result.rows[0];
  },

  async updateTask(id, taskData) {
    const { title, description, status, dueDate, userId } = taskData;
    const dueDateValue = dueDate && String(dueDate).trim() !== '' ? dueDate : null;
    const result = await pool.query(
      'UPDATE tasks SET title = $1, description = $2, status = $3, due_date = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND user_id = $6 RETURNING *',
      [title, description, status, dueDateValue, id, userId]
    );
    return result.rows[0];
  },

  async deleteTask(id, userId) {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, userId]);
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
