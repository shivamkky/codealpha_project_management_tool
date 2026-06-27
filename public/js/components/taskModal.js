// ═══════════════════════════════════════════════════════════════
// Task Detail Modal Component
// ═══════════════════════════════════════════════════════════════

const TaskModal = (() => {
  let currentTask = null;
  let projectMembers = [];
  let isOpen = false;

  function setProjectMembers(members) {
    projectMembers = members || [];
  }

  async function open(taskId) {
    try {
      const task = await API.get(`/api/tasks/${taskId}`);
      if (!task) return;

      currentTask = task;
      isOpen = true;
      render();

      // Listen for real-time comment updates
      WS.on('comment:added', handleNewComment);
    } catch (err) {
      showToast('Failed to load task details', 'error');
    }
  }

  function handleNewComment(data) {
    if (!currentTask || data.taskId !== currentTask.id) return;

    // Add comment if not already present
    if (!currentTask.comments.find(c => c.id === data.comment.id)) {
      currentTask.comments.push(data.comment);
      renderComments();
    }
  }

  function close() {
    isOpen = false;
    currentTask = null;
    WS.off('comment:added', handleNewComment);

    const overlay = document.getElementById('task-modal-overlay');
    if (overlay) overlay.remove();
  }

  function render() {
    // Remove existing modal
    const existing = document.getElementById('task-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'task-modal-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const task = currentTask;
    const priorityColors = { low: 'priority-low', medium: 'priority-medium', high: 'priority-high', urgent: 'priority-urgent' };

    const dueDateClass = task.due_date && new Date(task.due_date) < new Date() ? 'overdue' : '';

    overlay.innerHTML = `
      <div class="modal task-detail-modal">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="task-tag ${priorityColors[task.priority]}">${task.priority}</span>
            <span style="font-size: var(--font-xs); color: var(--text-tertiary);">Created ${formatTimeAgo(task.created_at)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <button class="btn btn-ghost btn-icon" onclick="TaskModal.deleteTask()" title="Delete task" style="color: var(--error);">🗑️</button>
            <button class="modal-close" onclick="TaskModal.close()">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="task-detail-grid">
            <div class="task-detail-main">
              <input type="text" class="task-detail-title" id="task-title-input" value="${escapeHtml(task.title)}" onblur="TaskModal.updateField('title', this.value)">

              <div class="task-detail-section">
                <h4>Description</h4>
                <textarea class="form-input" id="task-desc-input" placeholder="Add a description..." rows="3" onblur="TaskModal.updateField('description', this.value)">${escapeHtml(task.description || '')}</textarea>
              </div>

              <div class="task-detail-section">
                <h4 id="task-comments-heading">Comments (${task.comments?.length || 0})</h4>
                <div class="comments-list" id="task-comments-list">
                  ${renderCommentsHTML(task.comments || [])}
                </div>
                <div class="comment-input-wrapper">
                  <textarea class="comment-input" id="comment-input" placeholder="Write a comment..." rows="1" onkeydown="TaskModal.handleCommentKey(event)"></textarea>
                  <button class="btn btn-primary btn-sm" onclick="TaskModal.addComment()">Send</button>
                </div>
              </div>
            </div>

            <div class="task-detail-sidebar">
              <div class="sidebar-field">
                <label>Assignee</label>
                <select class="form-input" id="task-assignee-select" onchange="TaskModal.updateField('assigned_to', this.value)" style="padding: 0.5rem 0.75rem; font-size: var(--font-sm);">
                  <option value="">Unassigned</option>
                  ${projectMembers.map(m => `
                    <option value="${m.id}" ${task.assigned_to === m.id ? 'selected' : ''}>${escapeHtml(m.username)}</option>
                  `).join('')}
                </select>
              </div>

              <div class="sidebar-field">
                <label>Priority</label>
                <select class="form-input" id="task-priority-select" onchange="TaskModal.updateField('priority', this.value)" style="padding: 0.5rem 0.75rem; font-size: var(--font-sm);">
                  <option value="low" ${task.priority === 'low' ? 'selected' : ''}>🟢 Low</option>
                  <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
                  <option value="high" ${task.priority === 'high' ? 'selected' : ''}>🟠 High</option>
                  <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
                </select>
              </div>

              <div class="sidebar-field">
                <label>Due Date</label>
                <input type="date" class="form-input" id="task-duedate-input" value="${task.due_date || ''}" onchange="TaskModal.updateField('due_date', this.value)" style="padding: 0.5rem 0.75rem; font-size: var(--font-sm);">
              </div>

              <div class="sidebar-field">
                <label>Created By</label>
                <div class="value">
                  <div class="user-avatar tiny" style="background: ${task.creator_color}">${getInitials(task.creator_name)}</div>
                  <span style="font-size: var(--font-sm);">${escapeHtml(task.creator_name)}</span>
                </div>
              </div>

              ${task.assignee_name ? `
              <div class="sidebar-field">
                <label>Assigned To</label>
                <div class="value">
                  <div class="user-avatar tiny" style="background: ${task.assignee_color}">${getInitials(task.assignee_name)}</div>
                  <span style="font-size: var(--font-sm);">${escapeHtml(task.assignee_name)}</span>
                </div>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Auto-resize comment input
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
      commentInput.addEventListener('input', () => {
        commentInput.style.height = 'auto';
        commentInput.style.height = Math.min(commentInput.scrollHeight, 120) + 'px';
      });
    }
  }

  function renderCommentsHTML(comments) {
    if (!comments || comments.length === 0) {
      return '<p style="color: var(--text-tertiary); font-size: var(--font-sm); text-align: center; padding: 1rem;">No comments yet. Start the conversation!</p>';
    }

    return comments.map(c => `
      <div class="comment-item">
        <div class="user-avatar small" style="background: ${c.avatar_color}; flex-shrink: 0;">${getInitials(c.username)}</div>
        <div class="comment-body">
          <div class="comment-header">
            <span class="comment-author">${escapeHtml(c.username)}</span>
            <span class="comment-time">${formatTimeAgo(c.created_at)}</span>
          </div>
          <div class="comment-content">${escapeHtml(c.content)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderComments() {
    const list = document.getElementById('task-comments-list');
    if (list && currentTask) {
      list.innerHTML = renderCommentsHTML(currentTask.comments);
      list.scrollTop = list.scrollHeight;
    }
    // Update comment count heading
    const heading = document.getElementById('task-comments-heading');
    if (heading && currentTask) {
      heading.textContent = `Comments (${currentTask.comments?.length || 0})`;
    }
  }

  async function updateField(field, value) {
    if (!currentTask) return;

    // Don't update if value hasn't changed
    if (currentTask[field] === value) return;
    if (field === 'assigned_to' && !value) value = null;

    try {
      const updated = await API.put(`/api/tasks/${currentTask.id}`, { [field]: value });
      if (updated) {
        currentTask = { ...currentTask, ...updated };

        // Refresh the board
        if (typeof BoardPage !== 'undefined' && BoardPage.refresh) {
          BoardPage.refresh();
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to update task', 'error');
    }
  }

  async function addComment() {
    const input = document.getElementById('comment-input');
    const content = input?.value?.trim();

    if (!content || !currentTask) return;

    try {
      const comment = await API.post(`/api/comments/tasks/${currentTask.id}/comments`, { content });
      if (comment) {
        if (!currentTask.comments.find(c => c.id === comment.id)) {
          currentTask.comments.push(comment);
        }
        input.value = '';
        input.style.height = 'auto';
        renderComments();
      }
    } catch (err) {
      showToast(err.message || 'Failed to add comment', 'error');
    }
  }

  function handleCommentKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      addComment();
    }
  }

  async function deleteTask() {
    if (!currentTask) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await API.del(`/api/tasks/${currentTask.id}`);
      showToast('Task deleted', 'success');
      close();

      if (typeof BoardPage !== 'undefined' && BoardPage.refresh) {
        BoardPage.refresh();
      }
    } catch (err) {
      showToast(err.message || 'Failed to delete task', 'error');
    }
  }

  return {
    open,
    close,
    setProjectMembers,
    updateField,
    addComment,
    handleCommentKey,
    deleteTask
  };
})();
