function toggleSenha(id, btn) {
  const input = document.getElementById(id);
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.style.color = mostrar ? '#22c55e' : '';
}

document.querySelectorAll('[data-toggle-senha]').forEach((btn) => {
  btn.addEventListener('click', () => toggleSenha(btn.dataset.toggleSenha, btn));
});

document.querySelector('#registroForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const btn = this.querySelector('button[type="submit"]');
  const erroMsg = document.getElementById('erroMsg');
  const nome = document.getElementById('inputNome').value.trim();
  const empresa_nome = document.getElementById('inputEmpresa').value.trim();
  const email = document.getElementById('inputEmail').value.trim();
  const senha = document.getElementById('inputSenha').value;
  const confirmar = document.getElementById('inputConfirmar').value;
  const codigo_convite = document.getElementById('inputConvite').value.trim();

  erroMsg.style.display = 'none';

  if (senha !== confirmar) {
    erroMsg.textContent = 'As senhas não coincidem.';
    erroMsg.style.display = 'block';
    return;
  }

  if (senha.length < 6) {
    erroMsg.textContent = 'A senha deve ter pelo menos 6 caracteres.';
    erroMsg.style.display = 'block';
    return;
  }

  btn.textContent = 'Criando conta...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/registro', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, empresa_nome, email, senha, codigo_convite }),
    });
    const data = await res.json();

    if (!res.ok) {
      erroMsg.textContent = data.erro || 'Erro ao criar conta.';
      erroMsg.style.display = 'block';
      btn.textContent = 'Criar conta grátis →';
      btn.disabled = false;
      return;
    }

    localStorage.removeItem('ta_token');
    localStorage.setItem('ta_auth', '1');
    localStorage.setItem('ta_usuario', JSON.stringify(data.usuario));
    window.location.href = 'painel.html';
  } catch (err) {
    erroMsg.textContent = 'Erro de conexão. Tente novamente.';
    erroMsg.style.display = 'block';
    btn.textContent = 'Criar conta grátis →';
    btn.disabled = false;
  }
});
