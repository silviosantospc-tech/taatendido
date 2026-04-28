/* ── Busca em respostas rápidas ────────────────────────── */
const searchRespostas = document.querySelector('#respostasSearch');
const replyCards      = document.querySelectorAll('.reply-card');
const replyList       = document.querySelector('.reply-list');

function filtrarRespostas() {
  const query = searchRespostas?.value.toLowerCase().trim() || '';
  let visiveis = 0;

  replyCards.forEach((card) => {
    const titulo = card.querySelector('h3')?.textContent.toLowerCase() || '';
    const texto  = card.querySelector('p')?.textContent.toLowerCase() || '';
    const tag    = card.querySelector('.tag')?.textContent.toLowerCase() || '';

    const bate = !query || titulo.includes(query) || texto.includes(query) || tag.includes(query);
    card.style.display = bate ? '' : 'none';
    if (bate) visiveis++;
  });

  // Estado vazio
  let vazio = replyList?.querySelector('.reply-empty');
  if (visiveis === 0 && query) {
    if (!vazio) {
      vazio = document.createElement('p');
      vazio.className = 'reply-empty';
      vazio.textContent = 'Nenhuma resposta encontrada.';
      replyList?.appendChild(vazio);
    }
  } else {
    vazio?.remove();
  }
}

searchRespostas?.addEventListener('input', filtrarRespostas);

/* ── Salvar nova resposta ──────────────────────────────── */
const btnSalvarResposta = document.querySelector('#btnSalvarResposta');

btnSalvarResposta?.addEventListener('click', () => {
  const titulo    = document.querySelector('#inputTituloResposta')?.value.trim();
  const categoria = document.querySelector('#inputCategoria')?.value;
  const mensagem  = document.querySelector('#inputMensagem')?.value.trim();

  if (!titulo || !mensagem) {
    showToast('Preencha o título e a mensagem.', 'warning');
    return;
  }

  // Adiciona card à biblioteca
  const card = document.createElement('article');
  card.className = 'reply-card';
  card.innerHTML = `
    <span class="tag">${categoria}</span>
    <h3>${titulo}</h3>
    <p>${mensagem}</p>
  `;

  const emptyMsg = replyList?.querySelector('.reply-empty');
  if (emptyMsg) emptyMsg.remove();
  replyList?.appendChild(card);

  // Limpa o form
  document.querySelector('#inputTituloResposta').value = '';
  document.querySelector('#inputMensagem').value = '';

  showToast('Resposta salva na biblioteca!');
});
