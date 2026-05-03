function toggleSenha(id, btn) {
  const input = document.getElementById(id);
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.style.color = mostrar ? '#22c55e' : '';
}

document.querySelectorAll('[data-toggle-senha]').forEach((btn) => {
  btn.addEventListener('click', () => toggleSenha(btn.dataset.toggleSenha, btn));
});

document.querySelector('#loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const btn = this.querySelector('button[type="submit"]');
  const email = this.querySelector('input[type="email"]').value;
  const senha = document.getElementById('inputSenhaLogin').value;
  const codigo2fa = document.getElementById('inputCodigo2fa')?.value.trim();

  btn.textContent = 'Entrando...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha, codigo_2fa: codigo2fa }),
    });
    const data = await res.json();

    if (data.requer_2fa) {
      mostrarCampo2fa();
      alert('Informe o codigo de verificacao do aplicativo autenticador.');
      btn.textContent = 'Entrar no painel →';
      btn.disabled = false;
      return;
    }

    if (!res.ok) {
      alert(data.erro || 'Erro ao fazer login.');
      btn.textContent = 'Entrar no painel →';
      btn.disabled = false;
      return;
    }

    localStorage.removeItem('ta_token');
    localStorage.setItem('ta_auth', '1');
    localStorage.setItem('ta_usuario', JSON.stringify(data.usuario));
    window.location.href = data.usuario?.precisa_trocar_senha ? 'trocar-senha.html' : 'painel.html';
  } catch (err) {
    alert('Erro de conexão. Tente novamente.');
    btn.textContent = 'Entrar no painel →';
    btn.disabled = false;
  }
});

function mostrarCampo2fa() {
  if (document.getElementById('inputCodigo2fa')) return;
  const senhaLabel = document.getElementById('inputSenhaLogin').closest('label');
  const label = document.createElement('label');
  label.innerHTML = `
    <span>Codigo 2FA</span>
    <div class="password-field">
      <input id="inputCodigo2fa" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required>
    </div>
  `;
  senhaLabel.after(label);
}
