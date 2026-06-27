// ═══════════════════════════════════════════════════════════════
// Dashboard Page — Project listing & creation
// ═══════════════════════════════════════════════════════════════

const DashboardPage = (() => {
  let projects = [];

  async function render() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

    const html = `
      ${renderNavbar(currentUser)}
      ${NotificationsComponent.renderPanel()}
      <div class="dashboard">
        <div class="dashboard-header">
          <h1>Welcome back, <span>${escapeHtml(currentUser.username || 'User')}</span> 👋</h1>
        </div>

        <div class="dashboard-stats" id="dashboard-stats">
          <div class="stat-card">
            <div class="stat-icon">📁</div>
            <div class="stat-value" id="stat-projects">—</div>
            <div class="stat-label">Projects</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📋</div>
            <div class="stat-value" id="stat-tasks">—</div>
            <div class="stat-label">Total Tasks</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">👥</div>
            <div class="stat-value" id="stat-members">—</div>
            <div class="stat-label">Team Members</div>
          </div>
        </div>

        <div class="section-header">
          <h2>Your Projects</h2>
        </div>

        <div class="projects-grid" id="projects-grid">
          <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    return html;
  }

  async function onMount() {
    await fetchProjects();
    NotificationsComponent.fetchNotifications();
  }

  async function fetchProjects() {
    try {
      const data = await API.get('/api/projects');
      if (data) {
        projects = data;
        renderProjects();
        updateStats();
      }
    } catch (err) {
      showToast('Failed to load projects', 'error');
    }
  }

  function updateStats() {
    const totalTasks = projects.reduce((sum, p) => sum + (p.task_count || 0), 0);
    const uniqueMembers = new Set();
    projects.forEach(p => {
      if (p.members) p.members.forEach(m => uniqueMembers.add(m.id));
    });

    const statProjects = document.getElementById('stat-projects');
    const statTasks = document.getElementById('stat-tasks');
    const statMembers = document.getElementById('stat-members');

    if (statProjects) statProjects.textContent = projects.length;
    if (statTasks) statTasks.textContent = totalTasks;
    if (statMembers) statMembers.textContent = uniqueMembers.size;
  }

  function renderProjects() {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;

    const projectCards = projects.map(project => {
      const membersHtml = (project.members || []).slice(0, 4).map(m => {
        const initials = getInitials(m.username);
        return `<div class="user-avatar" style="background: ${m.avatar_color}" title="${escapeHtml(m.username)}">${initials}</div>`;
      }).join('');

      const overflowCount = (project.members?.length || 0) - 4;
      const overflowHtml = overflowCount > 0 ? `<div class="overflow-count">+${overflowCount}</div>` : '';

      return `
        <div class="project-card" onclick="window.location.hash='#/project/${project.id}'">
          <div class="project-card-header">
            <h3>${escapeHtml(project.name)}</h3>
          </div>
          <p class="project-card-desc">${escapeHtml(project.description || 'No description')}</p>
          <div class="project-card-meta">
            <div class="project-card-members">${membersHtml}${overflowHtml}</div>
            <div class="project-card-stats">
              <span>📋 ${project.task_count || 0}</span>
              <span>👥 ${project.member_count || 0}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.innerHTML = `
      <div class="project-card create-card" onclick="DashboardPage.openCreateModal()">
        <div class="create-icon">+</div>
        <span>Create New Project</span>
      </div>
      ${projectCards}
    `;
  }

  function openCreateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'create-project-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Create New Project</h3>
          <button class="modal-close" onclick="document.getElementById('create-project-overlay').remove()">✕</button>
        </div>
        <div class="modal-body">
          <form id="create-project-form" onsubmit="DashboardPage.createProject(event)">
            <div class="form-group">
              <label class="form-label" for="project-name">Project Name</label>
              <input type="text" class="form-input" id="project-name" placeholder="My Awesome Project" required autofocus>
            </div>
            <div class="form-group">
              <label class="form-label" for="project-desc">Description (optional)</label>
              <textarea class="form-input" id="project-desc" placeholder="What is this project about?" rows="3"></textarea>
            </div>
            <div class="form-error" id="create-project-error"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('create-project-overlay').remove()">Cancel</button>
          <button class="btn btn-primary" id="create-project-btn" onclick="document.getElementById('create-project-form').dispatchEvent(new Event('submit', {cancelable: true}))">Create Project</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  async function createProject(event) {
    event.preventDefault();
    const name = document.getElementById('project-name').value.trim();
    const description = document.getElementById('project-desc').value.trim();
    const errorEl = document.getElementById('create-project-error');
    const btn = document.getElementById('create-project-btn');

    if (!name) {
      errorEl.textContent = 'Project name is required';
      errorEl.classList.add('visible');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const project = await API.post('/api/projects', { name, description });
      if (project) {
        showToast(`Project "${name}" created!`, 'success');
        document.getElementById('create-project-overlay')?.remove();
        window.location.hash = `#/project/${project.id}`;
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create project';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Project';
    }
  }

  return { render, onMount, fetchProjects, openCreateModal, createProject };
})();

// ── Shared Navbar Renderer ─────────────────────────────────────

function renderNavbar(currentUser, options = {}) {
  const initials = getInitials(currentUser?.username || '?');

  return `
    <nav class="navbar">
      <div style="display: flex; align-items: center; gap: 1rem;">
        ${options.backLink ? `
          <button class="navbar-back" onclick="window.location.hash='${options.backLink}'">
            ← Back
          </button>
        ` : ''}
        <a class="navbar-brand" href="#/dashboard">
          <span class="brand-icon">📋</span>
          <h2>ProjectFlow</h2>
        </a>
      </div>
      <div class="navbar-actions">
        ${NotificationsComponent.renderButton()}
        <div class="user-menu">
          <div class="user-avatar" style="background: ${currentUser?.avatar_color || '#6366f1'}" onclick="App.toggleUserMenu()">${initials}</div>
          <div class="user-dropdown" id="user-dropdown">
            <div class="user-dropdown-header">
              <div class="name">${escapeHtml(currentUser?.username || 'User')}</div>
              <div class="email">${escapeHtml(currentUser?.email || '')}</div>
            </div>
            <button class="user-dropdown-item danger" onclick="App.logout()">
              <span>🚪</span> Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  `;
}
