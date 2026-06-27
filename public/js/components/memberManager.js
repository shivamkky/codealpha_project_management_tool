// ═══════════════════════════════════════════════════════════════
// Member Manager Component
// ═══════════════════════════════════════════════════════════════

const MemberManager = (() => {
  let currentProjectId = null;
  let members = [];

  function open(projectId, projectMembers) {
    currentProjectId = projectId;
    members = projectMembers || [];
    render();
  }

  function render() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'member-modal-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const myRole = members.find(m => m.id === currentUser.id)?.role;
    const canManage = myRole === 'owner' || myRole === 'admin';

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Team Members</h3>
          <button class="modal-close" onclick="MemberManager.close()">✕</button>
        </div>
        <div class="modal-body">
          ${canManage ? `
          <div style="margin-bottom: 1.5rem;">
            <label class="form-label">Invite Member</label>
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" class="form-input" id="invite-input" placeholder="Enter username or email" style="flex: 1;">
              <button class="btn btn-primary" onclick="MemberManager.invite()">Invite</button>
            </div>
            <div class="form-error" id="invite-error"></div>
          </div>
          ` : ''}

          <label class="form-label">Members (${members.length})</label>
          <div class="member-list" id="member-list-container">
            ${members.map(m => renderMemberItem(m, canManage, currentUser.id)).join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  function renderMemberItem(member, canManage, currentUserId) {
    const initials = getInitials(member.username);
    const isOwner = member.role === 'owner';
    const isSelf = member.id === currentUserId;

    return `
      <div class="member-item">
        <div class="user-avatar" style="background: ${member.avatar_color}; width: 36px; height: 36px; font-size: 0.8rem;">${initials}</div>
        <div class="member-info">
          <div class="name">${escapeHtml(member.username)} ${isSelf ? '(You)' : ''}</div>
          <div class="email">${escapeHtml(member.email)}</div>
        </div>
        <span class="member-role ${member.role}">${member.role}</span>
        ${canManage && !isOwner && !isSelf ? `
          <button class="btn btn-ghost btn-icon" onclick="MemberManager.remove('${member.id}')" title="Remove member" style="color: var(--error); font-size: 0.9rem;">✕</button>
        ` : ''}
      </div>
    `;
  }

  async function invite() {
    const input = document.getElementById('invite-input');
    const errorEl = document.getElementById('invite-error');
    const identifier = input?.value?.trim();

    if (!identifier) {
      errorEl.textContent = 'Please enter a username or email';
      errorEl.classList.add('visible');
      return;
    }

    try {
      errorEl.classList.remove('visible');
      const member = await API.post(`/api/projects/${currentProjectId}/members`, { identifier });

      if (member) {
        members.push(member);
        input.value = '';
        showToast(`${member.username} has been added to the project`, 'success');

        // Re-render member list
        const container = document.getElementById('member-list-container');
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const myRole = members.find(m => m.id === currentUser.id)?.role;
        const canManage = myRole === 'owner' || myRole === 'admin';
        if (container) {
          container.innerHTML = members.map(m => renderMemberItem(m, canManage, currentUser.id)).join('');
        }

        // Update board members display if on board page
        if (typeof BoardPage !== 'undefined' && BoardPage.updateMembers) {
          BoardPage.updateMembers(members);
        }
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add('visible');
    }
  }

  async function remove(userId) {
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      await API.del(`/api/projects/${currentProjectId}/members/${userId}`);
      members = members.filter(m => m.id !== userId);
      showToast('Member removed', 'success');

      // Re-render
      const container = document.getElementById('member-list-container');
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const myRole = members.find(m => m.id === currentUser.id)?.role;
      const canManage = myRole === 'owner' || myRole === 'admin';
      if (container) {
        container.innerHTML = members.map(m => renderMemberItem(m, canManage, currentUser.id)).join('');
      }

      if (typeof BoardPage !== 'undefined' && BoardPage.updateMembers) {
        BoardPage.updateMembers(members);
      }
    } catch (err) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  }

  function close() {
    const overlay = document.getElementById('member-modal-overlay');
    if (overlay) overlay.remove();
  }

  return { open, close, invite, remove };
})();
