const express = require('express');
const { db, uuidv4 } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ── Add Column ─────────────────────────────────────────────────
router.post('/projects/:projectId/columns', (req, res) => {
  try {
    const { projectId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Column name is required' });
    }

    // Check membership
    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(projectId, req.user.id);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this project' });
    }

    // Get max position
    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), -1) as max_pos FROM columns WHERE project_id = ?'
    ).get(projectId);

    const id = uuidv4();
    db.prepare(
      'INSERT INTO columns (id, project_id, name, position) VALUES (?, ?, ?, ?)'
    ).run(id, projectId, name.trim(), maxPos.max_pos + 1);

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(id);

    // Broadcast
    const { broadcast } = require('../ws/websocket');
    broadcast(projectId, {
      type: 'column:created',
      column: { ...column, tasks: [] }
    });

    res.status(201).json({ ...column, tasks: [] });
  } catch (err) {
    console.error('Create column error:', err);
    res.status(500).json({ error: 'Failed to create column' });
  }
});

// ── Rename Column ──────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Column name is required' });
    }

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
    if (!column) {
      return res.status(404).json({ error: 'Column not found' });
    }

    db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(name.trim(), id);

    const { broadcast } = require('../ws/websocket');
    broadcast(column.project_id, {
      type: 'column:updated',
      column: { ...column, name: name.trim() }
    });

    res.json({ ...column, name: name.trim() });
  } catch (err) {
    console.error('Rename column error:', err);
    res.status(500).json({ error: 'Failed to rename column' });
  }
});

// ── Reorder Columns ────────────────────────────────────────────
router.put('/reorder/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const { columnOrder } = req.body; // Array of column IDs in new order

    if (!Array.isArray(columnOrder)) {
      return res.status(400).json({ error: 'columnOrder must be an array' });
    }

    const reorder = db.transaction(() => {
      columnOrder.forEach((colId, index) => {
        db.prepare('UPDATE columns SET position = ? WHERE id = ? AND project_id = ?').run(index, colId, projectId);
      });
    });

    reorder();

    res.json({ message: 'Columns reordered' });
  } catch (err) {
    console.error('Reorder columns error:', err);
    res.status(500).json({ error: 'Failed to reorder columns' });
  }
});

// ── Delete Column ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
    if (!column) {
      return res.status(404).json({ error: 'Column not found' });
    }

    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(column.project_id, req.user.id);

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    db.prepare('DELETE FROM columns WHERE id = ?').run(id);

    const { broadcast } = require('../ws/websocket');
    broadcast(column.project_id, {
      type: 'column:deleted',
      columnId: id
    });

    res.json({ message: 'Column deleted' });
  } catch (err) {
    console.error('Delete column error:', err);
    res.status(500).json({ error: 'Failed to delete column' });
  }
});

module.exports = router;
