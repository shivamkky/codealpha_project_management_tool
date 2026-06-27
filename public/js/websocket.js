// ═══════════════════════════════════════════════════════════════
// WebSocket Client — Real-time updates with auto-reconnect
// ═══════════════════════════════════════════════════════════════

const WS = (() => {
  let socket = null;
  let reconnectAttempts = 0;
  let maxReconnectAttempts = 10;
  let reconnectTimer = null;
  let pingInterval = null;
  const listeners = new Map();

  function connect() {
    const token = API.getToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

    try {
      socket = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('WebSocket connection failed:', e);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      console.log('🔌 WebSocket connected');
      reconnectAttempts = 0;

      // Start ping interval
      pingInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        emit(data.type, data);
      } catch (e) {
        // Ignore parse errors
      }
    };

    socket.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      cleanup();
      scheduleReconnect();
    };

    socket.onerror = () => {
      // Error handling — onclose will fire after
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    cleanup();
    if (socket) {
      socket.close();
      socket = null;
    }
    reconnectAttempts = maxReconnectAttempts; // Prevent reconnection
  }

  function cleanup() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) return;
    if (!API.getToken()) return;

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      console.log(`🔄 Reconnecting (attempt ${reconnectAttempts})...`);
      connect();
    }, delay);
  }

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  function subscribeProject(projectId) {
    send({ type: 'subscribe:project', projectId });
  }

  function unsubscribeProject(projectId) {
    send({ type: 'unsubscribe:project', projectId });
  }

  // ── Event System ───────────────────────────────────────────

  function on(eventType, callback) {
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set());
    }
    listeners.get(eventType).add(callback);
    return () => off(eventType, callback);
  }

  function off(eventType, callback) {
    if (listeners.has(eventType)) {
      listeners.get(eventType).delete(callback);
    }
  }

  function emit(eventType, data) {
    if (listeners.has(eventType)) {
      listeners.get(eventType).forEach(cb => {
        try { cb(data); } catch (e) { console.error('WS listener error:', e); }
      });
    }
  }

  function removeAllListeners() {
    listeners.clear();
  }

  return {
    connect,
    disconnect,
    send,
    subscribeProject,
    unsubscribeProject,
    on,
    off,
    removeAllListeners
  };
})();
