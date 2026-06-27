// ═══════════════════════════════════════════════════════════════
// API Client — Fetch wrapper with JWT token management
// ═══════════════════════════════════════════════════════════════

const API = (() => {
  let accessToken = localStorage.getItem('accessToken') || null;

  function setToken(token) {
    accessToken = token;
    if (token) {
      localStorage.setItem('accessToken', token);
    } else {
      localStorage.removeItem('accessToken');
    }
  }

  function getToken() {
    return accessToken;
  }

  async function request(url, options = {}) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
      ...options,
    };

    if (accessToken) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
      let response = await fetch(url, config);

      // If token expired, try to refresh
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'TOKEN_EXPIRED') {
          const refreshed = await refreshToken();
          if (refreshed) {
            config.headers['Authorization'] = `Bearer ${accessToken}`;
            response = await fetch(url, config);
          } else {
            // Refresh failed — logout
            logout();
            return null;
          }
        } else {
          logout();
          return null;
        }
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Request failed');
      }

      return result;
    } catch (err) {
      if (err.message !== 'Failed to fetch') {
        throw err;
      }
      throw new Error('Network error — please check your connection');
    }
  }

  async function refreshToken() {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) return false;

      const data = await response.json();
      setToken(data.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  function logout() {
    setToken(null);
    localStorage.removeItem('currentUser');
    window.location.hash = '#/login';
  }

  // ── Convenience Methods ────────────────────────────────────

  function get(url) {
    return request(url, { method: 'GET' });
  }

  function post(url, body) {
    return request(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function put(url, body) {
    return request(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  function del(url) {
    return request(url, { method: 'DELETE' });
  }

  return { setToken, getToken, get, post, put, del, logout };
})();
