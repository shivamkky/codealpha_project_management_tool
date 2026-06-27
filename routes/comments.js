const express = require('express');
const { db, uuidv4 } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ── Add Comment ────────────────────────────────────────────────
router.post('/tasks/:taskId/comments', (req, res) => {
  try {
    const { taskId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check membership
    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(task.project_id, req.user.id);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this project' });
    }

    const id = uuidv4();
    db.prepare(
      'INSERT INTO comments (id, task_id, user_id, content) VALUES (?, ?, ?, ?)'
    ).run(id, taskId, req.user.id, content.trim());

    const comment = db.prepare(`
      SELECT c.*, u.username, u.avatar_color
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(id);

    // Log activity
    db.prepare(
      'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), task.project_id, req.user.id, 'commented', 'task', taskId, `Commented on "${task.title}"`);

    // Notify task creator and assignee (if different from commenter)
    const commenter = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const notifyUsers = new Set();
    if (task.created_by && task.created_by !== req.user.id) notifyUsers.add(task.created_by);
    if (task.assigned_to && task.assigned_to !== req.user.id) notifyUsers.add(task.assigned_to);

    const { sendToUser } = require('../ws/websocket');
    notifyUsers.forEach(userId => {
      const notifId = uuidv4();
      db.prepare(
        'INSERT INTO notifications (id, user_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(notifId, userId, 'comment', `${commenter.username} commented on "${task.title}"`, taskId, 'task');

      sendToUser(userId, {
        type: 'notification:new',
        notification: {
          id: notifId,
          type: 'comment',
          message: `${commenter.username} commented on "${task.title}"`,
          reference_id: taskId,
          reference_type: 'task',
          is_read: 0,
          created_at: new Date().toISOString()
        }
      });
    });

    // Broadcast comment to project
    const { broadcast } = require('../ws/websocket');
    broadcast(task.project_id, {
      type: 'comment:added',
      taskId,
      comment
    });

    res.status(201).json(comment);
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ── Delete Comment ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only comment author or project admin/owner can delete
    if (comment.user_id !== req.user.id) {
      const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(comment.task_id);
      const membership = db.prepare(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
      ).get(task.project_id, req.user.id);

      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(id);

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
