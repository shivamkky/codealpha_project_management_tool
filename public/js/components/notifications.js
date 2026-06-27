// ═══════════════════════════════════════════════════════════════
// Notifications Component
// ═══════════════════════════════════════════════════════════════

const NotificationsComponent = (() => {
  let isOpen = false;
  let notifications = [];
  let unreadCount = 0;

  function init() {
    // Listen for real-time notifications
    WS.on('notification:new', (data) => {
      notifications.unshift(data.notification);
      unreadCount++;
      updateBadge();
      showToast(data.notification.message, 'info');

      if (isOpen) {
        renderList();
      }
    });
  }

  function updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderButton() {
    return `
      <button class="notif-btn" id="notif-toggle-btn" onclick="NotificationsComponent.toggle()">
        🔔
        <span class="notif-badge" id="notif-badge" style="display: none;">0</span>
      </button>
    `;
  }

  function renderPanel() {
    return `
      <div class="notif-panel" id="notif-panel">
        <div class="notif-panel-header">
          <h3>Notifications</h3>
          <button class="btn btn-ghost btn-sm" onclick="NotificationsComponent.markAllRead()">Mark all read</button>
        </div>
        <div class="notif-list" id="notif-list">
          <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  async function toggle() {
    isOpen = !isOpen;
    const panel = document.getElementById('notif-panel');
    if (!panel) return;

    if (isOpen) {
      panel.classList.add('open');
      await fetchNotifications();
    } else {
      panel.classList.remove('open');
    }
  }

  function close() {
    isOpen = false;
    const panel = document.getElementById('notif-panel');
    if (panel) panel.classList.remove('open');
  }

  async function fetchNotifications() {
    try {
      const data = await API.get('/api/notifications');
      if (data) {
        notifications = data.notifications;
        unreadCount = data.unread_count;
        updateBadge();
        renderList();
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }

  function renderList() {
    const list = document.getElementById('notif-list');
    if (!list) return;

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <div class="empty-icon">🔕</div>
          <p>No notifications yet</p>
        </div>
      `;
      return;
    }

    list.innerHTML = notifications.map(n => {
      const iconClass = n.type === 'comment' ? 'comment' : n.type === 'project_invite' ? 'invite' : 'task';
      const icon = n.type === 'comment' ? '💬' : n.type === 'project_invite' ? '📨' : '📋';
      const timeAgo = formatTimeAgo(n.created_at);

      return `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="NotificationsComponent.handleClick('${n.id}', '${n.reference_type}', '${n.reference_id}')">
          <div class="notif-icon ${iconClass}">${icon}</div>
          <div class="notif-body">
            <div class="notif-message">${escapeHtml(n.message)}</div>
            <div class="notif-time">${timeAgo}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function handleClick(notifId, refType, refId) {
    // Mark as read
    await API.put(`/api/notifications/${notifId}/read`);

    const notif = notifications.find(n => n.id === notifId);
    if (notif) {
      if (!notif.is_read) {
        notif.is_read = 1;
        unreadCount = Math.max(0, unreadCount - 1);
        updateBadge();
      }
    }

    // Navigate based on reference type
    if (refType === 'project') {
      close();
      window.location.hash = `#/project/${refId}`;
    } else if (refType === 'task') {
      // We need to find which project the task belongs to
      try {
        const task = await API.get(`/api/tasks/${refId}`);
        if (task) {
          close();
          window.location.hash = `#/project/${task.project_id}`;
          // Open task modal after a short delay for board to load
          setTimeout(() => {
            TaskModal.open(refId);
          }, 500);
        }
      } catch (e) {
        // Just close
        close();
      }
    }

    renderList();
  }

  async function markAllRead() {
    try {
      await API.put('/api/notifications/read-all');
      notifications.forEach(n => n.is_read = 1);
      unreadCount = 0;
      updateBadge();
      renderList();
    } catch (err) {
      showToast('Failed to mark notifications as read', 'error');
    }
  }

  return {
    init,
    renderButton,
    renderPanel,
    toggle,
    close,
    fetchNotifications,
    updateBadge,
    handleClick,
    markAllRead
  };
})();

// ── Toast Notifications ────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Utility Functions ──────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
