// ═══════════════════════════════════════════════════════════════
// Auth Page — Login & Register
// ═══════════════════════════════════════════════════════════════

const AuthPage = (() => {
  let currentTab = 'login';

  function render(tab = 'login') {
    currentTab = tab;

    return `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-logo">
            <span class="logo-icon">📋</span>
            <h1>ProjectFlow</h1>
            <p>Manage projects with your team, seamlessly</p>
          </div>

          <div class="auth-tabs">
            <button class="auth-tab ${currentTab === 'login' ? 'active' : ''}" onclick="AuthPage.switchTab('login')">Sign In</button>
            <button class="auth-tab ${currentTab === 'register' ? 'active' : ''}" onclick="AuthPage.switchTab('register')">Sign Up</button>
          </div>

          <div id="auth-form-container">
            ${currentTab === 'login' ? renderLoginForm() : renderRegisterForm()}
          </div>
        </div>
      </div>
    `;
  }

  function renderLoginForm() {
    return `
      <form id="login-form" onsubmit="AuthPage.handleLogin(event)">
        <div class="form-group">
          <label class="form-label" for="login-email">Email</label>
          <input type="email" class="form-input" id="login-email" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label" for="login-password">Password</label>
          <input type="password" class="form-input" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
        </div>
        <div class="form-error" id="login-error"></div>
        <button type="submit" class="btn btn-primary btn-full" id="login-btn" style="margin-top: 0.5rem; padding: 0.875rem;">
          Sign In
        </button>
      </form>
    `;
  }

  function renderRegisterForm() {
    return `
      <form id="register-form" onsubmit="AuthPage.handleRegister(event)">
        <div class="form-group">
          <label class="form-label" for="reg-username">Username</label>
          <input type="text" class="form-input" id="reg-username" placeholder="johndoe" required minlength="3" autocomplete="username">
        </div>
        <div class="form-group">
          <label class="form-label" for="reg-email">Email</label>
          <input type="email" class="form-input" id="reg-email" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label" for="reg-password">Password</label>
          <input type="password" class="form-input" id="reg-password" placeholder="Min 6 characters" required minlength="6" autocomplete="new-password">
        </div>
        <div class="form-error" id="register-error"></div>
        <button type="submit" class="btn btn-primary btn-full" id="register-btn" style="margin-top: 0.5rem; padding: 0.875rem;">
          Create Account
        </button>
      </form>
    `;
  }

  function switchTab(tab) {
    currentTab = tab;
    const container = document.getElementById('auth-form-container');
    if (container) {
      container.innerHTML = tab === 'login' ? renderLoginForm() : renderRegisterForm();
    }
    // Update tab styles
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.textContent.trim() === (tab === 'login' ? 'Sign In' : 'Sign Up'));
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errorEl.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const data = await API.post('/api/auth/login', { email, password });
      if (data) {
        API.setToken(data.accessToken);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        WS.connect();
        window.location.hash = '#/dashboard';
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const errorEl = document.getElementById('register-error');
    const btn = document.getElementById('register-btn');

    errorEl.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
      const data = await API.post('/api/auth/register', { username, email, password });
      if (data) {
        API.setToken(data.accessToken);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        WS.connect();
        window.location.hash = '#/dashboard';
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Registration failed';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  }

  return { render, switchTab, handleLogin, handleRegister };
})();
