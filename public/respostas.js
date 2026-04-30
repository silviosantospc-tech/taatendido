/* ── Respostas rápidas: API + UI ────────────────────────── */

const replyList = document.querySelector('.reply-list');

function renderResposta(resposta) {
  const card = document.createElement('article');
  card.className = 'reply-card';
  card.dataset.id = resposta.id;
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
      <span class="tag">${resposta.categoria || 'Geral'}</span>
      <button class="reply-delete" aria-label="Excluir resposta" title="Excluir" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px;display:flex;align-items:center">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>
    <h3>${resposta.titulo}</h3>
    <p>${resposta.mensagem}</p>
  `;

  card.querySelector('.reply-delete').addEventListener('click', () => excluirResposta(resposta.id, card));
  return card;
}

async function carregarRespostas() {
  try {
    const res = await Auth.fetch('/api/respostas');
    if (!res) return;
    const respostas = await res.json();

    replyList.innerHTML = '';
    if (!respostas.length) {
      replyList.innerHTML = '<p class="reply-empty">Nenhuma resposta cadastrada ainda.</p>';
      return;
    }
    respostas.forEach(r => replyList.appendChild(renderResposta(r)));
  } catch (err) {
    console.error('Erro ao carregar respostas:', err);
  }
}

async function excluirResposta(id, cardEl) {
  if (!confirm('Excluir esta resposta?')) return;

  try {
    const res = await Auth.fetch(`/api/respostas/${id}`, { method: 'DELETE' });
    if (!res || !res.ok) {
      showToast('Erro ao excluir.', 'warning');
      return;
    }
    cardEl.remove();
    showToast('Resposta removida.');
    if (!replyList.querySelector('.reply-card')) {
      replyList.innerHTML = '<p class="reply-empty">Nenhuma resposta cadastrada ainda.</p>';
    }
  } catch {
    showToast('Erro de conexão.', 'warning');
  }
}

/* ── Busca ──────────────────────────────────────────────── */
const searchRespostas = document.querySelector('#respostasSearch');

function filtrarRespostas() {
  const query = searchRespostas?.value.toLowerCase().trim() || '';
  let visiveis = 0;

  replyList.querySelectorAll('.reply-card').forEach((card) => {
    const titulo = card.querySelector('h3')?.textContent.toLowerCase() || '';
    const texto  = card.querySelector('p')?.textContent.toLowerCase() || '';
    const tag    = card.querySelector('.tag')?.textContent.toLowerCase() || '';
    const bate = !query || titulo.includes(query) || texto.includes(query) || tag.includes(query);
    card.style.display = bate ? '' : 'none';
    if (bate) visiveis++;
  });

  let vazio = replyList.querySelector('.reply-empty');
  if (visiveis === 0 && query) {
    if (!vazio) {
      vazio = document.createElement('p');
      vazio.className = 'reply-empty';
      vazio.textContent = 'Nenhuma resposta encontrada.';
      replyList.appendChild(vazio);
    }
  } else {
    vazio?.remove();
  }
}

searchRespostas?.addEventListener('input', filtrarRespostas);

/* ── Salvar nova resposta ───────────────────────────────── */
const btnSalvarResposta = document.querySelector('#btnSalvarResposta');

btnSalvarResposta?.addEventListener('click', async () => {
  const titulo    = document.querySelector('#inputTituloResposta')?.value.trim();
  const categoria = document.querySelector('#inputCategoria')?.value;
  const mensagem  = document.querySelector('#inputMensagem')?.value.trim();

  if (!titulo || !mensagem) {
    showToast('Preencha o título e a mensagem.', 'warning');
    return;
  }

  btnSalvarResposta.textContent = 'Salvando...';
  btnSalvarResposta.disabled = true;

  try {
    const res = await Auth.fetch('/api/respostas', {
      method: 'POST',
      body: JSON.stringify({ titulo, categoria, mensagem })
    });

    if (!res || !res.ok) {
      showToast('Erro ao salvar resposta.', 'warning');
      return;
    }

    const nova = await res.json();
    const emptyMsg = replyList.querySelector('.reply-empty');
    if (emptyMsg) emptyMsg.remove();
    replyList.prepend(renderResposta(nova));

    document.querySelector('#inputTituloResposta').value = '';
    document.querySelector('#inputMensagem').value = '';
    showToast('Resposta salva na biblioteca!');
  } catch {
    showToast('Erro de conexão.', 'warning');
  } finally {
    btnSalvarResposta.textContent = 'Salvar resposta';
    btnSalvarResposta.disabled = false;
  }
});

// Iniciar
carregarRespostas();
