/* ── Painel: dados reais ─────────────────────────────────── */

// Preencher nome do usuário logado
const usuario = Auth.usuario();
if (usuario) {
  const userMenuNome   = document.querySelector('.user-menu strong');
  const userMenuPapel  = document.querySelector('.user-menu small');
  const userAvatar     = document.querySelector('.user-avatar');

  if (userMenuNome) userMenuNome.textContent = usuario.nome;
  if (userMenuPapel) userMenuPapel.textContent = usuario.papel === 'admin' ? 'Administrador' : 'Atendente';
  if (userAvatar) {
    userAvatar.textContent = (usuario.nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  }
}

// Carregar estatísticas de conversas
async function carregarStats() {
  try {
    const res = await Auth.fetch('/api/conversas');
    if (!res) return;
    const conversas = await res.json();

    const abertas       = conversas.filter(c => c.status === 'aberta').length;
    const emAtendimento = conversas.filter(c => c.status === 'em-atendimento').length;
    const aguardando    = conversas.filter(c => c.status === 'aguardando').length;
    const finalizadas   = conversas.filter(c => c.status === 'finalizada').length;
    const total         = conversas.length;

    // Cards de métricas
    const metricEls = document.querySelectorAll('.metric-card strong');
    if (metricEls[0]) metricEls[0].textContent = total;
    if (metricEls[1]) metricEls[1].textContent = abertas + emAtendimento;
    if (metricEls[2]) metricEls[2].textContent = finalizadas;

    // Remover textos de variação (são fictícios)
    document.querySelectorAll('.metric-card small').forEach(el => el.remove());

    // Funil de status
    const funnelEls = document.querySelectorAll('.funnel-list b');
    if (funnelEls[0]) funnelEls[0].textContent = abertas;
    if (funnelEls[1]) funnelEls[1].textContent = emAtendimento;
    if (funnelEls[2]) funnelEls[2].textContent = aguardando;
    if (funnelEls[3]) funnelEls[3].textContent = finalizadas;

    // Tabela de conversas recentes
    const tbody = document.querySelector('.overview-grid .table-wrap tbody');
    if (!tbody) return;

    if (!conversas.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">Nenhuma conversa ainda.</td></tr>';
      return;
    }

    const statusLabel = {
      'aberta':         { cls: 'tag-blue',  label: 'Aberta' },
      'em-atendimento': { cls: 'tag-green', label: 'Em atendimento' },
      'aguardando':     { cls: 'tag-amber', label: 'Aguardando' },
      'finalizada':     { cls: 'tag-muted', label: 'Finalizado' },
    };

    const recentes = conversas.slice(0, 5);
    tbody.innerHTML = recentes.map(c => {
      const ini = (c.contato_nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
      const { cls, label } = statusLabel[c.status] || { cls: 'tag-blue', label: c.status };
      const tempo = new Date(c.atualizado_em);
      const diff  = Math.floor((new Date() - tempo) / 60000);
      const tempoStr = diff < 1 ? 'agora' : diff < 60 ? `${diff} min` : `${Math.floor(diff/60)}h`;

      return `
        <tr>
          <td><span class="mini-contact"><b>${ini}</b>${c.contato_nome || 'Desconhecido'}</span></td>
          <td>
            <span class="channel-name whatsapp">
              <svg class="ch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              WhatsApp
            </span>
          </td>
          <td><span class="tag ${cls}">${label}</span></td>
          <td class="td-muted">${tempoStr}</td>
          <td><button class="more-btn" aria-label="Mais opções">&#8942;</button></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Erro ao carregar painel:', err);
  }
}

// Preencher seção "Minha conta"
if (usuario) {
  const agentList = document.getElementById('agentList');
  if (agentList) {
    const ini = (usuario.nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    agentList.innerHTML = `
      <div class="agent-row">
        <span class="avatar">${ini}</span>
        <div class="agent-info">
          <strong>${usuario.nome}</strong>
          <small>${usuario.papel === 'admin' ? 'Administrador' : 'Atendente'}</small>
        </div>
        <span class="status-dot"></span>
      </div>
    `;
  }
}

carregarStats();
