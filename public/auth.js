// auth.js — proteção de páginas e utilitários de autenticação

const Auth = {
  token() {
    return localStorage.getItem('ta_token');
  },

  autenticado() {
    return !!(localStorage.getItem('ta_auth') || this.token());
  },

  usuario() {
    try {
      return JSON.parse(localStorage.getItem('ta_usuario'));
    } catch {
      return null;
    }
  },

  // Redireciona para login se não estiver autenticado
  exigirLogin() {
    if (!this.autenticado()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  // Cabeçalho Authorization para fetch
  headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token()) headers.Authorization = `Bearer ${this.token()}`;
    return headers;
  },

  // Fetch autenticado
  async fetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: { ...this.headers(), ...(options.headers || {}) }
    });
    if (res.status === 401) {
      this.logout();
      return null;
    }
    return res;
  },

  logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
    localStorage.removeItem('ta_token');
    localStorage.removeItem('ta_auth');
    localStorage.removeItem('ta_usuario');
    window.location.href = 'login.html';
  }
};

document.addEventListener('click', (event) => {
  const logout = event.target.closest('[data-logout]');
  if (logout) Auth.logout();
});
