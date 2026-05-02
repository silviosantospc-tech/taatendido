/* ── Conversas: API + UI ────────────────────────────────── */

let conversaAtiva = null;

const conversationList = document.querySelector('.conversation-list');
const messageArea      = document.querySelector('#messageArea');
const activeContact    = document.querySelector('#activeContact');
const chatStatus       = document.querySelector('#chatStatus');
const messageInput     = document.querySelector('#messageInput');
const composer         = document.querySelector('#composer');
const btnFinalizar     = document.querySelector('#btnFinalizar');
const quickReplies     = document.querySelectorAll('.quick-replies button');

function formatarHora(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatarDataCurta(iso) {
  const d = new Date(iso);
  const agora = new Date();
  const diff = agora - d;
  if (diff < 86400000 && d.getDate() === agora.getDate()) return formatarHora(iso);
  if (diff < 172800000) return 'Ontem';
  return `${d.getDate()}/${d.getMonth()+1}`;
}

function iniciais(nome) {
  return (nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Lista de conversas ─────────────────────────────────── */
async function carregarConversas() {
  try {
    const res = await Auth.fetch('/api/conversas');
    if (!res) return;
    const conversas = await res.json();

    conversationList.innerHTML = '';

    if (!conversas.length) {
      conversationList.innerHTML = '<p style="padding:24px;color:#94a3b8;font-size:0.9rem">Nenhuma conversa ainda.</p>';
      return;
    }

    conversas.forEach((c) => {
      const card = document.createElement('button');
      card.className = 'conversation-card';
      card.type = 'button';
      card.dataset.id = c.id;
      card.dataset.status = c.status;
      card.dataset.contact = c.contato_nome || 'Desconhecido';
      card.innerHTML = `
        <span class="avatar">${esc(iniciais(c.contato_nome))}</span>
        <span class="conversation-main">
          <strong>${esc(c.contato_nome || 'Desconhecido')}</strong>
          <small>${esc(c.contato_telefone || c.canal || 'WhatsApp')}</small>
        </span>
        <span class="conversation-meta">
          <time>${esc(formatarDataCurta(c.atualizado_em))}</time>
        </span>
      `;

      card.addEventListener('click', () => selecionarConversa(c, card));
      conversationList.appendChild(card);
    });

    // Selecionar a primeira automaticamente
    const primeiro = conversationList.querySelector('.conversation-card');
    if (primeiro) primeiro.click();

    filtrarConversas();
  } catch (err) {
    console.error('Erro ao carregar conversas:', err);
  }
}

async function selecionarConversa(conversa, cardEl) {
  conversaAtiva = conversa;

  document.querySelectorAll('.conversation-card').forEach(c => c.classList.remove('is-active'));
  cardEl.classList.add('is-active');

  const nome = conversa.contato_nome || 'Desconhecido';
  const ini  = iniciais(nome);

  // Cabeçalho do chat
  activeContact.textContent = nome;
  const avatar = document.getElementById('activeAvatar');
  if (avatar) avatar.textContent = ini;

  const finalizada = conversa.status === 'finalizada';
  chatStatus.innerHTML = finalizada
    ? `<span class="status-dot" style="background:#cbd5e1;box-shadow:none"></span> Finalizada · WhatsApp`
    : `<span class="status-dot"></span> Em atendimento · WhatsApp`;
  chatStatus.style.color = '';

  if (btnFinalizar) btnFinalizar.textContent = finalizada ? 'Reabrir' : 'Finalizar';

  // Painel de detalhes
  const detailAvatar   = document.getElementById('detailAvatar');
  const detailNome     = document.getElementById('detailNome');
  const detailSegmento = document.getElementById('detailSegmento');
  const detailTelefone = document.getElementById('detailTelefone');
  const detailInfo     = document.getElementById('detailInfo');

  if (detailAvatar)   detailAvatar.textContent   = ini;
  if (detailNome)     detailNome.textContent      = nome;
  if (detailSegmento) { detailSegmento.textContent = conversa.canal || 'WhatsApp'; detailSegmento.style.color = ''; }
  if (detailTelefone) detailTelefone.textContent  = conversa.contato_telefone || '—';
  if (detailInfo)     detailInfo.style.display    = '';

  await carregarMensagens(conversa.id);
}

/* ── Mensagens ──────────────────────────────────────────── */
async function carregarMensagens(conversaId) {
  messageArea.innerHTML = '<p style="padding:24px;color:#94a3b8;font-size:0.9rem">Carregando...</p>';

  try {
    const res = await Auth.fetch(`/api/conversas/${conversaId}/mensagens`);
    if (!res) return;
    const mensagens = await res.json();

    messageArea.innerHTML = '';

    if (!mensagens.length) {
      messageArea.innerHTML = '<p style="padding:24px;color:#94a3b8;font-size:0.9rem">Nenhuma mensagem ainda.</p>';
      return;
    }

    mensagens.forEach(m => {
      const div = document.createElement('div');
      div.className = `message ${m.tipo}`;

      const p = document.createElement('p');
      p.textContent = m.conteudo;
      div.appendChild(p);

      const time = document.createElement('time');
      time.textContent = formatarHora(m.criado_em);
      div.appendChild(time);

      messageArea.appendChild(div);
    });

    messageArea.scrollTop = messageArea.scrollHeight;
  } catch (err) {
    console.error('Erro ao carregar mensagens:', err);
  }
}

/* ── Enviar mensagem ────────────────────────────────────── */
composer?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = messageInput.value.trim();
  if (!texto || !conversaAtiva) return;

  // Exibir imediatamente (feedback otimista)
  const div = document.createElement('div');
  div.className = 'message sent';
  const p = document.createElement('p');
  p.textContent = texto;
  div.appendChild(p);
  const time = document.createElement('time');
  time.textContent = 'Agora';
  div.appendChild(time);
  messageArea.appendChild(div);
  messageArea.scrollTop = messageArea.scrollHeight;
  messageInput.value = '';

  try {
    await Auth.fetch(`/api/conversas/${conversaAtiva.id}/mensagens`, {
      method: 'POST',
      body: JSON.stringify({ tipo: 'sent', conteudo: texto })
    });
  } catch (err) {
    console.error('Erro ao salvar mensagem:', err);
  }
});

/* ── Finalizar / Reabrir ────────────────────────────────── */
btnFinalizar?.addEventListener('click', async () => {
  if (!conversaAtiva) return;

  const finalizada = conversaAtiva.status === 'finalizada';
  const novoStatus = finalizada ? 'em-atendimento' : 'finalizada';

  try {
    const res = await Auth.fetch(`/api/conversas/${conversaAtiva.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: novoStatus })
    });
    if (!res || !res.ok) return;

    conversaAtiva.status = novoStatus;
    const cardAtivo = document.querySelector('.conversation-card.is-active');
    if (cardAtivo) cardAtivo.dataset.status = novoStatus;

    if (novoStatus === 'finalizada') {
      chatStatus.innerHTML = `<span class="status-dot" style="background:#cbd5e1;box-shadow:none"></span> Finalizada · WhatsApp`;
      btnFinalizar.textContent = 'Reabrir';
      showToast('Conversa finalizada!');
    } else {
      chatStatus.innerHTML = `<span class="status-dot"></span> Em atendimento · WhatsApp`;
      btnFinalizar.textContent = 'Finalizar';
      showToast('Conversa reaberta.', 'info');
    }

    filtrarConversas();
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
  }
});

/* ── Respostas rápidas ──────────────────────────────────── */
quickReplies.forEach((btn) => {
  btn.addEventListener('click', () => {
    messageInput.value = btn.dataset.reply;
    messageInput.focus();
  });
});

/* ── Filtro de conversas ────────────────────────────────── */
const conversaChips  = document.querySelectorAll('.filter-row .filter-chip');
const conversaSearch = document.querySelector('#conversaSearch');

function filtrarConversas() {
  const filtroAtivo = document.querySelector('.filter-row .filter-chip.is-active')?.dataset.filter || 'todas';
  const query = conversaSearch?.value.toLowerCase().trim() || '';

  document.querySelectorAll('.conversation-card').forEach((card) => {
    const status  = card.dataset.status || '';
    const nome    = card.dataset.contact?.toLowerCase() || '';
    const preview = card.querySelector('small')?.textContent.toLowerCase() || '';

    const passaFiltro = filtroAtivo === 'todas' || status === filtroAtivo;
    const passaBusca  = !query || nome.includes(query) || preview.includes(query);

    card.style.display = passaFiltro && passaBusca ? '' : 'none';
  });
}

conversaChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    conversaChips.forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    filtrarConversas();
  });
});

conversaSearch?.addEventListener('input', filtrarConversas);

// Iniciar
carregarConversas();
