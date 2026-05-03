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
  },

  mostrarAtalhoAdmin() {
    const usuario = this.usuario();
    const nav = document.querySelector('.nav-list');
    if (!usuario?.super_admin || !nav || nav.querySelector('[href="admin.html"]')) return;

    const link = document.createElement('a');
    link.className = `nav-item ${location.pathname.endsWith('/admin.html') ? 'is-active' : ''}`;
    link.href = 'admin.html';
    link.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4v6c0 5-3.4 7.7-8 9-4.6-1.3-8-4-8-9V7z"/><path d="M9 12l2 2 4-5"/></svg>
      Admin interno
    `;
    nav.appendChild(link);
  }
};

document.addEventListener('click', (event) => {
  const logout = event.target.closest('[data-logout]');
  if (logout) Auth.logout();
});

document.addEventListener('DOMContentLoaded', () => {
  Auth.mostrarAtalhoAdmin();
});
