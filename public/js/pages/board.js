// ═══════════════════════════════════════════════════════════════
// Board Page — Kanban board with drag & drop
// ═══════════════════════════════════════════════════════════════

const BoardPage = (() => {
  let projectId = null;
  let project = null;
  let columns = [];
  let members = [];
  let draggedTaskId = null;
  let draggedFromColumn = null;

  async function render(id) {
    projectId = id;
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

    return `
      ${renderNavbar(currentUser, { backLink: '#/dashboard' })}
      ${NotificationsComponent.renderPanel()}
      <div class="board-layout">
        <div class="board-header" id="board-header">
          <div class="board-header-left">
            <span class="board-title" id="board-title">Loading...</span>
          </div>
          <div class="board-header-right">
            <div class="board-members" id="board-members-display"></div>
            <button class="btn btn-secondary btn-sm" onclick="BoardPage.openMemberManager()">👥 Members</button>
          </div>
        </div>
        <div class="board-container" id="board-container">
          <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  async function onMount(id) {
    projectId = id;
    await fetchProject();
    setupWebSocketListeners();
    NotificationsComponent.fetchNotifications();
  }

  async function fetchProject() {
    try {
      const data = await API.get(`/api/projects/${projectId}`);
      if (!data) return;

      project = data;
      columns = data.columns || [];
      members = data.members || [];

      TaskModal.setProjectMembers(members);
      WS.subscribeProject(projectId);

      renderBoard();
      renderBoardHeader();
    } catch (err) {
      showToast('Failed to load project', 'error');
    }
  }

  function renderBoardHeader() {
    const titleEl = document.getElementById('board-title');
    if (titleEl) titleEl.textContent = project.name;

    const membersEl = document.getElementById('board-members-display');
    if (membersEl) {
      membersEl.innerHTML = members.slice(0, 5).map(m => {
        const initials = getInitials(m.username);
        return `<div class="user-avatar small" style="background: ${m.avatar_color}" title="${escapeHtml(m.username)}">${initials}</div>`;
      }).join('');
    }
  }

  function renderBoard() {
    const container = document.getElementById('board-container');
    if (!container) return;

    const columnsHtml = columns.map(col => {
      const tasks = col.tasks || [];
      const tasksHtml = tasks.map(task => renderTaskCard(task)).join('');

      return `
        <div class="board-column" id="column-${col.id}"
          ondragover="BoardPage.handleDragOver(event)"
          ondrop="BoardPage.handleDrop(event, '${col.id}')"
          ondragenter="BoardPage.handleDragEnter(event, '${col.id}')"
          ondragleave="BoardPage.handleDragLeave(event, '${col.id}')">

          <div class="column-header">
            <div class="column-title-wrapper">
              <input class="column-title" value="${escapeHtml(col.name)}"
                onblur="BoardPage.renameColumn('${col.id}', this.value)"
                onkeydown="if(event.key==='Enter'){this.blur()}"
                title="Click to rename">
              <span class="column-count">${tasks.length}</span>
            </div>
            <div class="column-actions">
              <button class="btn btn-ghost btn-icon" onclick="BoardPage.deleteColumn('${col.id}')" title="Delete column" style="font-size: 0.85rem;">✕</button>
            </div>
          </div>

          <div class="column-body" id="column-body-${col.id}">
            ${tasksHtml}
          </div>

          <div class="column-footer">
            <button class="add-task-btn" onclick="BoardPage.showAddTask('${col.id}')">
              + Add Task
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      ${columnsHtml}
      <button class="add-column-btn" onclick="BoardPage.addColumn()">
        <span style="font-size: 1.5rem;">+</span>
        Add Column
      </button>
    `;
  }

  function renderTaskCard(task) {
    const priorityColors = { low: 'low', medium: 'medium', high: 'high', urgent: 'urgent' };

    const dueDateHtml = task.due_date ? (() => {
      const isOverdue = new Date(task.due_date) < new Date();
      const formatted = new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<span class="task-tag due-date ${isOverdue ? 'overdue' : ''}">📅 ${formatted}</span>`;
    })() : '';

    const assigneeHtml = task.assignee_name ? `
      <div class="user-avatar tiny" style="background: ${task.assignee_color}" title="${escapeHtml(task.assignee_name)}">${getInitials(task.assignee_name)}</div>
    ` : '';

    return `
      <div class="task-card" id="task-${task.id}"
        draggable="true"
        ondragstart="BoardPage.handleDragStart(event, '${task.id}', '${task.column_id}')"
        ondragend="BoardPage.handleDragEnd(event)"
        onclick="TaskModal.open('${task.id}')">

        <div class="task-card-priority ${priorityColors[task.priority]}"></div>
        <div class="task-card-title">${escapeHtml(task.title)}</div>

        <div class="task-card-footer">
          <div class="task-card-tags">
            <span class="task-tag priority-${task.priority}">${task.priority}</span>
            ${dueDateHtml}
          </div>
          <div class="task-card-meta">
            ${task.comment_count > 0 ? `<span>💬 ${task.comment_count}</span>` : ''}
            ${assigneeHtml}
          </div>
        </div>
      </div>
    `;
  }

  // ── Add Task ───────────────────────────────────────────────

  function showAddTask(columnId) {
    // Remove any existing inline forms
    document.querySelectorAll('.inline-add-task').forEach(el => el.remove());

    const columnBody = document.getElementById(`column-body-${columnId}`);
    if (!columnBody) return;

    const form = document.createElement('div');
    form.className = 'inline-add-task';
    form.innerHTML = `
      <input type="text" placeholder="Enter task title..." id="new-task-input-${columnId}" autofocus
        onkeydown="if(event.key==='Enter'){BoardPage.createTask('${columnId}')}else if(event.key==='Escape'){this.parentElement.remove()}">
      <div class="inline-add-task-actions">
        <button class="btn btn-ghost btn-sm" onclick="this.closest('.inline-add-task').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="BoardPage.createTask('${columnId}')">Add</button>
      </div>
    `;

    columnBody.appendChild(form);
    form.querySelector('input').focus();
  }

  async function createTask(columnId) {
    const input = document.getElementById(`new-task-input-${columnId}`);
    const title = input?.value?.trim();

    if (!title) return;

    try {
      const task = await API.post('/api/tasks', {
        column_id: columnId,
        project_id: projectId,
        title
      });

      if (task) {
        // Add task to the correct column (guard against WS duplicate)
        const col = columns.find(c => c.id === columnId);
        if (col) {
          if (!col.tasks) col.tasks = [];
          if (!col.tasks.find(t => t.id === task.id)) {
            col.tasks.push(task);
          }
        }

        // Remove inline form and re-render column body
        renderBoard();
        showToast('Task created', 'success');
      }
    } catch (err) {
      showToast(err.message || 'Failed to create task', 'error');
    }
  }

  // ── Column Operations ──────────────────────────────────────

  async function addColumn() {
    const name = prompt('Enter column name:');
    if (!name?.trim()) return;

    try {
      const column = await API.post(`/api/columns/projects/${projectId}/columns`, { name: name.trim() });
      if (column) {
        columns.push(column);
        renderBoard();
        showToast('Column added', 'success');
      }
    } catch (err) {
      showToast(err.message || 'Failed to add column', 'error');
    }
  }

  async function renameColumn(columnId, newName) {
    if (!newName?.trim()) return;

    const col = columns.find(c => c.id === columnId);
    if (col && col.name === newName.trim()) return;

    try {
      await API.put(`/api/columns/${columnId}`, { name: newName.trim() });
      if (col) col.name = newName.trim();
    } catch (err) {
      showToast('Failed to rename column', 'error');
    }
  }

  async function deleteColumn(columnId) {
    const col = columns.find(c => c.id === columnId);
    const taskCount = col?.tasks?.length || 0;

    if (!confirm(`Delete column "${col?.name}"? ${taskCount > 0 ? `This will also delete ${taskCount} task(s).` : ''}`)) return;

    try {
      await API.del(`/api/columns/${columnId}`);
      columns = columns.filter(c => c.id !== columnId);
      renderBoard();
      showToast('Column deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to delete column', 'error');
    }
  }

  // ── Drag & Drop ────────────────────────────────────────────

  function handleDragStart(event, taskId, columnId) {
    draggedTaskId = taskId;
    draggedFromColumn = columnId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);

    // Add dragging class after a small delay for visual feedback
    setTimeout(() => {
      const card = document.getElementById(`task-${taskId}`);
      if (card) card.classList.add('dragging');
    }, 0);
  }

  function handleDragEnd(event) {
    const card = document.getElementById(`task-${draggedTaskId}`);
    if (card) card.classList.remove('dragging');

    document.querySelectorAll('.board-column').forEach(col => {
      col.classList.remove('drag-over');
    });

    draggedTaskId = null;
    draggedFromColumn = null;
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(event, columnId) {
    event.preventDefault();
    const colEl = document.getElementById(`column-${columnId}`);
    if (colEl) colEl.classList.add('drag-over');
  }

  function handleDragLeave(event, columnId) {
    const colEl = document.getElementById(`column-${columnId}`);
    // Only remove if actually leaving the column
    if (colEl && !colEl.contains(event.relatedTarget)) {
      colEl.classList.remove('drag-over');
    }
  }

  async function handleDrop(event, targetColumnId) {
    event.preventDefault();

    document.querySelectorAll('.board-column').forEach(col => {
      col.classList.remove('drag-over');
    });

    if (!draggedTaskId) return;

    // Find the task
    let task = null;
    let sourceCol = null;
    for (const col of columns) {
      const found = col.tasks?.find(t => t.id === draggedTaskId);
      if (found) {
        task = found;
        sourceCol = col;
        break;
      }
    }

    if (!task || !sourceCol) return;

    const targetCol = columns.find(c => c.id === targetColumnId);
    if (!targetCol) return;

    // Optimistic UI update
    sourceCol.tasks = sourceCol.tasks.filter(t => t.id !== task.id);
    task.column_id = targetColumnId;
    if (!targetCol.tasks) targetCol.tasks = [];
    targetCol.tasks.push(task);

    renderBoard();

    // Send to server
    try {
      await API.put(`/api/tasks/${task.id}/move`, {
        column_id: targetColumnId,
        position: targetCol.tasks.length - 1
      });
    } catch (err) {
      showToast('Failed to move task', 'error');
      // Revert on error
      await fetchProject();
    }
  }

  // ── WebSocket Listeners ────────────────────────────────────

  function setupWebSocketListeners() {
    WS.on('task:created', (data) => {
      if (!project) return;
      const col = columns.find(c => c.id === data.task.column_id);
      if (col) {
        if (!col.tasks) col.tasks = [];
        if (!col.tasks.find(t => t.id === data.task.id)) {
          col.tasks.push(data.task);
          renderBoard();
        }
      }
    });

    WS.on('task:updated', (data) => {
      if (!project) return;
      for (const col of columns) {
        const idx = col.tasks?.findIndex(t => t.id === data.task.id);
        if (idx !== undefined && idx >= 0) {
          col.tasks[idx] = data.task;
          renderBoard();
          break;
        }
      }
    });

    WS.on('task:moved', (data) => {
      if (!project) return;
      refresh();
    });

    WS.on('task:deleted', (data) => {
      if (!project) return;
      const col = columns.find(c => c.id === data.columnId);
      if (col) {
        col.tasks = (col.tasks || []).filter(t => t.id !== data.taskId);
        renderBoard();
      }
    });

    WS.on('column:created', (data) => {
      if (!project) return;
      if (!columns.find(c => c.id === data.column.id)) {
        columns.push(data.column);
        renderBoard();
      }
    });

    WS.on('column:deleted', (data) => {
      if (!project) return;
      columns = columns.filter(c => c.id !== data.columnId);
      renderBoard();
    });

    WS.on('column:updated', (data) => {
      if (!project) return;
      const col = columns.find(c => c.id === data.column.id);
      if (col) {
        col.name = data.column.name;
        renderBoard();
      }
    });

    WS.on('member:joined', (data) => {
      if (!members.find(m => m.id === data.member.id)) {
        members.push(data.member);
        TaskModal.setProjectMembers(members);
        renderBoardHeader();
      }
    });

    WS.on('member:left', (data) => {
      members = members.filter(m => m.id !== data.userId);
      TaskModal.setProjectMembers(members);
      renderBoardHeader();
    });
  }

  // ── Public Helpers ─────────────────────────────────────────

  async function refresh() {
    await fetchProject();
  }

  function updateMembers(newMembers) {
    members = newMembers;
    TaskModal.setProjectMembers(members);
    renderBoardHeader();
  }

  function openMemberManager() {
    MemberManager.open(projectId, members);
  }

  function cleanup() {
    if (projectId) {
      WS.unsubscribeProject(projectId);
    }
    WS.removeAllListeners();
    NotificationsComponent.init(); // Re-init notification listener
    project = null;
    columns = [];
    members = [];
    projectId = null;
  }

  return {
    render,
    onMount,
    refresh,
    updateMembers,
    openMemberManager,
    cleanup,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    showAddTask,
    createTask,
    addColumn,
    renameColumn,
    deleteColumn
  };
})();
