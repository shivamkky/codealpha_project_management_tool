// ═══════════════════════════════════════════════════════════════
// App — SPA Router & Main Controller
// ═══════════════════════════════════════════════════════════════

const App = (() => {
  let currentPage = null;

  function init() {
    // Initialize notifications listener
    NotificationsComponent.init();

    // Check if user is logged in
    const token = API.getToken();
    if (token) {
      WS.connect();
    }

    // Listen for hash changes
    window.addEventListener('hashchange', handleRoute);

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      // Close user dropdown
      const dropdown = document.getElementById('user-dropdown');
      if (dropdown && dropdown.classList.contains('open')) {
        if (!e.target.closest('.user-menu')) {
          dropdown.classList.remove('open');
        }
      }

      // Close notification panel
      if (!e.target.closest('.notif-panel') && !e.target.closest('.notif-btn')) {
        NotificationsComponent.close();
      }
    });

    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close any open modals
        const modals = document.querySelectorAll('.modal-overlay');
        if (modals.length > 0) {
          modals[modals.length - 1].remove();
        }
        NotificationsComponent.close();
      }
    });

    // Initial route
    handleRoute();
  }

  async function handleRoute() {
    const hash = window.location.hash || '#/login';
    const app = document.getElementById('app');

    // Cleanup previous page
    if (currentPage === 'board') {
      BoardPage.cleanup();
    }

    const token = API.getToken();

    // Auth guard
    if (!token && !hash.startsWith('#/login') && !hash.startsWith('#/register')) {
      window.location.hash = '#/login';
      return;
    }

    if (token && (hash === '#/login' || hash === '#/register')) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Route matching
    if (hash === '#/login') {
      currentPage = 'login';
      app.innerHTML = AuthPage.render('login');
    } else if (hash === '#/register') {
      currentPage = 'register';
      app.innerHTML = AuthPage.render('register');
    } else if (hash === '#/dashboard') {
      currentPage = 'dashboard';
      app.innerHTML = await DashboardPage.render();
      DashboardPage.onMount();
    } else if (hash.startsWith('#/project/')) {
      const projectId = hash.split('/')[2];
      if (projectId) {
        currentPage = 'board';
        app.innerHTML = await BoardPage.render(projectId);
        BoardPage.onMount(projectId);
      }
    } else {
      // Default redirect
      window.location.hash = token ? '#/dashboard' : '#/login';
    }
  }

  function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('open');
    }
  }

  async function logout() {
    try {
      await API.post('/api/auth/logout');
    } catch (e) {
      // Ignore errors during logout
    }
    WS.disconnect();
    API.logout();
  }

  return { init, handleRoute, toggleUserMenu, logout };
})();

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
