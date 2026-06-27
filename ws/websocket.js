const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { db } = require('../db/database');

// Map of userId -> Set of WebSocket connections
const userConnections = new Map();
// Map of projectId -> Set of userIds
const projectSubscriptions = new Map();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Extract token from query string
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (err) {
      ws.close(4003, 'Invalid token');
      return;
    }

    // Store connection
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId).add(ws);

    // Auto-subscribe to all user's projects
    const projects = db.prepare(
      'SELECT project_id FROM project_members WHERE user_id = ?'
    ).all(userId);

    projects.forEach(({ project_id }) => {
      if (!projectSubscriptions.has(project_id)) {
        projectSubscriptions.set(project_id, new Set());
      }
      projectSubscriptions.get(project_id).add(userId);
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connected successfully'
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        // Handle subscribe/unsubscribe to projects
        if (message.type === 'subscribe:project') {
          const projectId = message.projectId;
          if (!projectSubscriptions.has(projectId)) {
            projectSubscriptions.set(projectId, new Set());
          }
          projectSubscriptions.get(projectId).add(userId);
        }

        if (message.type === 'unsubscribe:project') {
          const projectId = message.projectId;
          if (projectSubscriptions.has(projectId)) {
            projectSubscriptions.get(projectId).delete(userId);
          }
        }

        // Handle ping/pong for keep-alive
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        // Ignore invalid messages
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      if (userConnections.has(userId)) {
        userConnections.get(userId).delete(ws);
        if (userConnections.get(userId).size === 0) {
          userConnections.delete(userId);

          // Clean up project subscriptions
          projectSubscriptions.forEach((users) => {
            users.delete(userId);
          });
        }
      }
    });

    ws.on('error', () => {
      // Silently handle errors
    });
  });

  // Heartbeat interval to clean up dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  return wss;
}

// ── Broadcast to all members of a project ──────────────────────
function broadcast(projectId, data, excludeUserId = null) {
  const subscribers = projectSubscriptions.get(projectId);
  if (!subscribers) return;

  const message = JSON.stringify(data);

  subscribers.forEach(userId => {
    if (userId === excludeUserId) return;

    const connections = userConnections.get(userId);
    if (connections) {
      connections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  });
}

// ── Send to a specific user ────────────────────────────────────
function sendToUser(userId, data) {
  const connections = userConnections.get(userId);
  if (!connections) return;

  const message = JSON.stringify(data);
  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcast, sendToUser };
