const express = require('express');
const { db, uuidv4 } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ── List User's Projects ───────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT p.*, pm.role,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
      FROM projects p
      JOIN project_members pm ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY p.created_at DESC
    `).all(req.user.id);

    // Get members for each project
    const result = projects.map(project => {
      const members = db.prepare(`
        SELECT u.id, u.username, u.email, u.avatar_color, pm.role
        FROM users u
        JOIN project_members pm ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY pm.role ASC
      `).all(project.id);
      return { ...project, members };
    });

    res.json(result);
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ── Create Project ─────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const projectId = uuidv4();

    const createProject = db.transaction(() => {
      // Create project
      db.prepare(
        'INSERT INTO projects (id, name, description, owner_id) VALUES (?, ?, ?, ?)'
      ).run(projectId, name.trim(), description || '', req.user.id);

      // Add owner as member
      db.prepare(
        'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
      ).run(projectId, req.user.id, 'owner');

      // Create default columns
      const defaultColumns = ['To Do', 'In Progress', 'Review', 'Done'];
      defaultColumns.forEach((colName, index) => {
        db.prepare(
          'INSERT INTO columns (id, project_id, name, position) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), projectId, colName, index);
      });

      // Log activity
      db.prepare(
        'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), projectId, req.user.id, 'created', 'project', projectId, `Created project "${name.trim()}"`);
    });

    createProject();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const columns = db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position').all(projectId);
    const members = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar_color, pm.role
      FROM users u JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ?
    `).all(projectId);

    res.status(201).json({ ...project, columns, members, task_count: 0 });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ── Get Project Detail ─────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    // Check membership
    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get columns
    const columns = db.prepare(
      'SELECT * FROM columns WHERE project_id = ? ORDER BY position'
    ).all(id);

    // Get tasks for each column
    const columnsWithTasks = columns.map(col => {
      const tasks = db.prepare(`
        SELECT t.*,
          u_creator.username as creator_name,
          u_creator.avatar_color as creator_color,
          u_assignee.username as assignee_name,
          u_assignee.avatar_color as assignee_color,
          (SELECT COUNT(*) FROM comments WHERE task_id = t.id) as comment_count
        FROM tasks t
        LEFT JOIN users u_creator ON t.created_by = u_creator.id
        LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
        WHERE t.column_id = ?
        ORDER BY t.position
      `).all(col.id);
      return { ...col, tasks };
    });

    // Get members
    const members = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar_color, pm.role
      FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
    `).all(id);

    // Get recent activity
    const activity = db.prepare(`
      SELECT al.*, u.username, u.avatar_color
      FROM activity_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.project_id = ?
      ORDER BY al.created_at DESC
      LIMIT 20
    `).all(id);

    res.json({
      ...project,
      role: membership.role,
      columns: columnsWithTasks,
      members,
      activity
    });
  } catch (err) {
    console.error('Get project detail error:', err);
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

// ── Update Project ─────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    db.prepare(
      'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
    ).run(name, description, id);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(project);
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ── Delete Project ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the project owner can delete it' });
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ── Add Member ─────────────────────────────────────────────────
router.post('/:id/members', (req, res) => {
  try {
    const { id } = req.params;
    const { identifier, role } = req.body; // identifier can be email or username

    if (!identifier) {
      return res.status(400).json({ error: 'Email or username is required' });
    }

    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Find user by email or username
    const user = db.prepare(
      'SELECT id, username, email, avatar_color FROM users WHERE email = ? OR username = ?'
    ).get(identifier.toLowerCase(), identifier);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already a member
    const existing = db.prepare(
      'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, user.id);

    if (existing) {
      return res.status(409).json({ error: 'User is already a member of this project' });
    }

    const memberRole = role || 'member';
    db.prepare(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
    ).run(id, user.id, memberRole);

    // Create notification for invited user
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
    const inviter = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const notifId = uuidv4();
    db.prepare(
      'INSERT INTO notifications (id, user_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(notifId, user.id, 'project_invite', `${inviter.username} added you to "${project.name}"`, id, 'project');

    // Log activity
    db.prepare(
      'INSERT INTO activity_log (id, project_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), id, req.user.id, 'added_member', 'member', user.id, `Added ${user.username} to the project`);

    // Broadcast real-time update
    broadcast(id, {
      type: 'member:joined',
      member: { ...user, role: memberRole }
    });

    // Send notification via WebSocket
    const { sendToUser } = require('../ws/websocket');
    sendToUser(user.id, {
      type: 'notification:new',
      notification: {
        id: notifId,
        type: 'project_invite',
        message: `${inviter.username} added you to "${project.name}"`,
        reference_id: id,
        reference_type: 'project',
        is_read: 0,
        created_at: new Date().toISOString()
      }
    });

    res.status(201).json({ ...user, role: memberRole });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ── Remove Member ──────────────────────────────────────────────
router.delete('/:id/members/:userId', (req, res) => {
  try {
    const { id, userId } = req.params;

    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, req.user.id);

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      // Allow users to remove themselves
      if (req.user.id !== userId) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    // Cannot remove the owner
    const targetMembership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(id, userId);

    if (targetMembership?.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the project owner' });
    }

    db.prepare(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
    ).run(id, userId);

    broadcast(id, {
      type: 'member:left',
      userId
    });

    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
