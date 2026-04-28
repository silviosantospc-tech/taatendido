// auth.js — proteção de páginas e utilitários de autenticação

const Auth = {
  token() {
    return localStorage.getItem('ta_token');
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
    if (!this.token()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  // Cabeçalho Authorization para fetch
  headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token()}`
    };
  },

  // Fetch autenticado
  async fetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers(), ...(options.headers || {}) }
    });
    if (res.status === 401) {
      this.logout();
      return null;
    }
    return res;
  },

  logout() {
    localStorage.removeItem('ta_token');
    localStorage.removeItem('ta_usuario');
    window.location.href = 'login.html';
  }
};
