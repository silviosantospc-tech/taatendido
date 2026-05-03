document.getElementById('trocarSenhaForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nova = document.getElementById('novaSenha').value;
  const confirmar = document.getElementById('confirmarSenha').value;
  const botao = event.currentTarget.querySelector('button[type="submit"]');

  if (nova.length < 8) {
    alert('A senha precisa ter pelo menos 8 caracteres.');
    return;
  }
  if (nova !== confirmar) {
    alert('As senhas nao coincidem.');
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Salvando...';

  try {
    const res = await Auth.fetch('/api/auth/trocar-senha', {
      method: 'POST',
      body: JSON.stringify({ nova_senha: nova }),
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao trocar senha.');

    const me = await Auth.fetch('/api/auth/me');
    if (me?.ok) {
      const usuario = await me.json();
      localStorage.setItem('ta_usuario', JSON.stringify(usuario));
    }
    window.location.href = 'painel.html';
  } catch (err) {
    alert(err.message || 'Erro ao trocar senha.');
    botao.disabled = false;
    botao.textContent = 'Salvar nova senha';
  }
});
