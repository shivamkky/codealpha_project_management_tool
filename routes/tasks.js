const express = require('express');
const { db, uuidv4 } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ── Create Task ────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { column_id, project_id, title, description, priority, due_date, assigned_to } = req.body;

    if (!column_id || !project_id || !title?.trim()) {
      return res.status(400).json({ error: 'column_id, project_id, and title are required' });
    }

    // Check membership
    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(project_id, req.user.id);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this project' });
    }

    // Get max position in column
    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ?'
    ).get(column_id);

    const id = uuidv4();

    db.prepare(`
      INSERT INTO tasks (id, column_id, project_id, title, description, priority, due_date, position, created_by, assigned_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, column_id, project_id, title.trim(), description || '', priority || 'medium', due_date || null, maxPos.max_pos + 1, req.user.id, assigned_to || null);

    // Log activity
    db.prepare(
      'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), project_id, req.user.id, 'created', 'task', id, `Created task "${title.trim()}"`);

    // If assigned, create notification
    if (assigned_to && assigned_to !== req.user.id) {
      const assigner = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
      const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(project_id);
      const notifId = uuidv4();
      db.prepare(
        'INSERT INTO notifications (id, user_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(notifId, assigned_to, 'task_assigned', `${assigner.username} assigned you "${title.trim()}" in ${project.name}`, id, 'task');

      const { sendToUser } = require('../ws/websocket');
      sendToUser(assigned_to, {
        type: 'notification:new',
        notification: {
          id: notifId,
          type: 'task_assigned',
          message: `${assigner.username} assigned you "${title.trim()}" in ${project.name}`,
          reference_id: id,
          reference_type: 'task',
          is_read: 0,
          created_at: new Date().toISOString()
        }
      });
    }

    // Get full task with user info
    const task = db.prepare(`
      SELECT t.*,
        u_creator.username as creator_name,
        u_creator.avatar_color as creator_color,
        u_assignee.username as assignee_name,
        u_assignee.avatar_color as assignee_color,
        (SELECT COUNT(*) FROM comments WHERE task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.id = ?
    `).get(id);

    const { broadcast } = require('../ws/websocket');
    broadcast(project_id, {
      type: 'task:created',
      task
    });

    res.status(201).json(task);
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ── Get Task Detail ────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const task = db.prepare(`
      SELECT t.*,
        u_creator.username as creator_name,
        u_creator.avatar_color as creator_color,
        u_assignee.username as assignee_name,
        u_assignee.avatar_color as assignee_color
      FROM tasks t
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.id = ?
    `).get(id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get comments
    const comments = db.prepare(`
      SELECT c.*, u.username, u.avatar_color
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.task_id = ?
      ORDER BY c.created_at ASC
    `).all(id);

    // Get activity for this task
    const activity = db.prepare(`
      SELECT al.*, u.username, u.avatar_color
      FROM activity_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.entity_id = ? AND al.entity_type = 'task'
      ORDER BY al.created_at DESC
      LIMIT 10
    `).all(id);

    res.json({ ...task, comments, activity });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// ── Update Task ────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, priority, due_date, assigned_to } = req.body;

    const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date || null); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to || null); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Log activity
    const details = [];
    if (title !== undefined) details.push('updated title');
    if (description !== undefined) details.push('updated description');
    if (priority !== undefined) details.push(`set priority to ${priority}`);
    if (due_date !== undefined) details.push(`set due date to ${due_date || 'none'}`);
    if (assigned_to !== undefined) {
      if (assigned_to) {
        const assignee = db.prepare('SELECT username FROM users WHERE id = ?').get(assigned_to);
        details.push(`assigned to ${assignee?.username || 'unknown'}`);
      } else {
        details.push('unassigned');
      }
    }

    db.prepare(
      'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), existingTask.project_id, req.user.id, 'updated', 'task', id, details.join(', '));

    // Notification for new assignment
    if (assigned_to && assigned_to !== existingTask.assigned_to && assigned_to !== req.user.id) {
      const assigner = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
      const taskTitle = title?.trim() || existingTask.title;
      const notifId = uuidv4();
      db.prepare(
        'INSERT INTO notifications (id, user_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(notifId, assigned_to, 'task_assigned', `${assigner.username} assigned you "${taskTitle}"`, id, 'task');

      const { sendToUser } = require('../ws/websocket');
      sendToUser(assigned_to, {
        type: 'notification:new',
        notification: {
          id: notifId,
          type: 'task_assigned',
          message: `${assigner.username} assigned you "${taskTitle}"`,
          reference_id: id,
          reference_type: 'task',
          is_read: 0,
          created_at: new Date().toISOString()
        }
      });
    }

    // Get updated task
    const task = db.prepare(`
      SELECT t.*,
        u_creator.username as creator_name,
        u_creator.avatar_color as creator_color,
        u_assignee.username as assignee_name,
        u_assignee.avatar_color as assignee_color,
        (SELECT COUNT(*) FROM comments WHERE task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      WHERE t.id = ?
    `).get(id);

    const { broadcast } = require('../ws/websocket');
    broadcast(existingTask.project_id, {
      type: 'task:updated',
      task
    });

    res.json(task);
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// ── Move Task ──────────────────────────────────────────────────
router.put('/:id/move', (req, res) => {
  try {
    const { id } = req.params;
    const { column_id, position } = req.body;

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const oldColumnId = task.column_id;

    const moveTask = db.transaction(() => {
      // Update task column and position
      db.prepare('UPDATE tasks SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(column_id, position, id);

      // Reorder tasks in the target column
      const tasksInColumn = db.prepare(
        'SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position'
      ).all(column_id, id);

      tasksInColumn.forEach((t, index) => {
        const newPos = index >= position ? index + 1 : index;
        db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(newPos, t.id);
      });

      // Reorder old column if different
      if (oldColumnId !== column_id) {
        const tasksInOldColumn = db.prepare(
          'SELECT id FROM tasks WHERE column_id = ? ORDER BY position'
        ).all(oldColumnId);
        tasksInOldColumn.forEach((t, index) => {
          db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(index, t.id);
        });
      }
    });

    moveTask();

    // Get column names for activity log
    const newCol = db.prepare('SELECT name FROM columns WHERE id = ?').get(column_id);
    if (oldColumnId !== column_id) {
      const oldCol = db.prepare('SELECT name FROM columns WHERE id = ?').get(oldColumnId);
      db.prepare(
        'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), task.project_id, req.user.id, 'moved', 'task', id, `Moved "${task.title}" from ${oldCol.name} to ${newCol.name}`);
    }

    const { broadcast } = require('../ws/websocket');
    broadcast(task.project_id, {
      type: 'task:moved',
      taskId: id,
      fromColumn: oldColumnId,
      toColumn: column_id,
      position
    });

    res.json({ message: 'Task moved' });
  } catch (err) {
    console.error('Move task error:', err);
    res.status(500).json({ error: 'Failed to move task' });
  }
});

// ── Delete Task ────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    db.prepare(
      'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), task.project_id, req.user.id, 'deleted', 'task', id, `Deleted task "${task.title}"`);

    const { broadcast } = require('../ws/websocket');
    broadcast(task.project_id, {
      type: 'task:deleted',
      taskId: id,
      columnId: task.column_id
    });

    res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
