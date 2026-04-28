function showToast(mensagem, tipo = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;

  const icone = tipo === 'success' ? '✓' : tipo === 'info' ? 'ℹ' : '!';
  toast.innerHTML = `<span class="toast-icon">${icone}</span>${mensagem}`;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  });

  setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 2800);
}
