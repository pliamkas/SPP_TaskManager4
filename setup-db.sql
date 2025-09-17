-- PostgreSQL Database Setup for Task Manager
-- Run this script to create the database and user

-- Create database with UTF-8 encoding
CREATE DATABASE task_manager WITH ENCODING 'UTF8' LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8';

-- Create user (optional - you can use your existing postgres user)
-- CREATE USER task_user WITH PASSWORD 'your_password';
-- GRANT ALL PRIVILEGES ON DATABASE task_manager TO task_user;

-- Connect to the task_manager database
\c task_manager;

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create attachments table
CREATE TABLE IF NOT EXISTS attachments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO tasks (title, description, status, due_date) VALUES 
('Complete lab assignment', 'Finish the server-side rendering task management app', 'in-progress', '2024-01-15'),
('Review code', 'Review and test the application', 'pending', '2024-01-20');

-- Create indexes for better performance
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_attachments_task_id ON attachments(task_id);
