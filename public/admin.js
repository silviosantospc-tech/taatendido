const els = {
  totalEmpresas: document.getElementById('totalEmpresas'),
  totalAtivas: document.getElementById('totalAtivas'),
  totalUsuarios: document.getElementById('totalUsuarios'),
  totalConversas: document.getElementById('totalConversas'),
  empresasTbody: document.getElementById('empresasTbody'),
  usuariosCard: document.getElementById('usuariosCard'),
  usuariosTitulo: document.getElementById('usuariosTitulo'),
  usuariosTbody: document.getElementById('usuariosTbody'),
  btnAtualizar: document.getElementById('btnAtualizar'),
};

let empresas = [];
let empresaSelecionada = null;

function avisar(mensagem, tipo = 'success') {
  if (window.toast) {
    toast(mensagem, tipo);
  } else {
    alert(mensagem);
  }
}

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatarData(valor) {
  if (!valor) return 'Sem registro';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return 'Sem registro';
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTag(status) {
  const ativo = status === 'ativo';
  return `<span class="${ativo ? 'tag-green' : 'tag-amber'}">${ativo ? 'Ativa' : 'Inativa'}</span>`;
}

function atualizarMetricas() {
  const totalUsuarios = empresas.reduce((soma, empresa) => soma + Number(empresa.usuarios || 0), 0);
  const totalConversas = empresas.reduce((soma, empresa) => soma + Number(empresa.conversas || 0), 0);
  els.totalEmpresas.textContent = empresas.length;
  els.totalAtivas.textContent = empresas.filter(empresa => empresa.status === 'ativo').length;
  els.totalUsuarios.textContent = totalUsuarios;
  els.totalConversas.textContent = totalConversas;
}

function renderizarEmpresas() {
  atualizarMetricas();

  if (!empresas.length) {
    els.empresasTbody.innerHTML = '<tr><td colspan="7" class="td-muted">Nenhuma empresa cadastrada.</td></tr>';
    return;
  }

  els.empresasTbody.innerHTML = empresas.map(empresa => {
    const proximoStatus = empresa.status === 'ativo' ? 'inativo' : 'ativo';
    const textoStatus = empresa.status === 'ativo' ? 'Inativar' : 'Ativar';

    return `
      <tr>
        <td>
          <strong>${escapar(empresa.nome)}</strong>
          <br><span class="td-muted">${escapar(empresa.slug)}</span>
        </td>
        <td>${statusTag(empresa.status)}</td>
        <td>${Number(empresa.usuarios || 0)}</td>
        <td>${Number(empresa.conversas || 0)}</td>
        <td>${Number(empresa.produtos || 0)}</td>
        <td class="td-muted">${formatarData(empresa.ultima_conversa)}</td>
        <td>
          <button class="secondary-button" type="button" data-action="usuarios" data-id="${empresa.id}">Usuários</button>
          <button class="secondary-button" type="button" data-action="status" data-id="${empresa.id}" data-status="${proximoStatus}">${textoStatus}</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function carregarEmpresas() {
  els.empresasTbody.innerHTML = '<tr><td colspan="7" class="td-muted">Carregando empresas...</td></tr>';
  try {
    const res = await Auth.fetch('/api/admin/empresas');
    if (!res) return;

    if (res.status === 403) {
      els.empresasTbody.innerHTML = '<tr><td colspan="7" class="td-muted">Acesso restrito ao administrador interno.</td></tr>';
      avisar('Acesso restrito ao administrador interno.', 'error');
      return;
    }

    if (!res.ok) throw new Error('Falha ao carregar empresas.');
    empresas = await res.json();
    renderizarEmpresas();
  } catch (err) {
    console.error(err);
    els.empresasTbody.innerHTML = '<tr><td colspan="7" class="td-muted">Não foi possível carregar as empresas.</td></tr>';
    avisar('Não foi possível carregar as empresas.', 'error');
  }
}

async function carregarUsuarios(id) {
  empresaSelecionada = empresas.find(empresa => Number(empresa.id) === Number(id));
  if (!empresaSelecionada) return;

  els.usuariosCard.hidden = false;
  els.usuariosTitulo.textContent = `Usuários - ${empresaSelecionada.nome}`;
  els.usuariosTbody.innerHTML = '<tr><td colspan="5" class="td-muted">Carregando usuários...</td></tr>';

  try {
    const res = await Auth.fetch(`/api/admin/empresas/${id}/usuarios`);
    if (!res) return;
    if (!res.ok) throw new Error('Falha ao carregar usuários.');
    const usuarios = await res.json();

    if (!usuarios.length) {
      els.usuariosTbody.innerHTML = '<tr><td colspan="5" class="td-muted">Nenhum usuário nesta empresa.</td></tr>';
      return;
    }

    els.usuariosTbody.innerHTML = usuarios.map(usuario => `
      <tr>
        <td><strong>${escapar(usuario.nome)}</strong></td>
        <td>${escapar(usuario.email)}</td>
        <td>${usuario.papel === 'admin' ? 'Administrador' : 'Atendente'}</td>
        <td class="td-muted">${formatarData(usuario.criado_em)}</td>
        <td><button class="secondary-button" type="button" data-action="senha" data-id="${usuario.id}">Resetar senha</button></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
    els.usuariosTbody.innerHTML = '<tr><td colspan="5" class="td-muted">Não foi possível carregar os usuários.</td></tr>';
    avisar('Não foi possível carregar os usuários.', 'error');
  }
}

async function alterarStatusEmpresa(id, status) {
  const empresa = empresas.find(item => Number(item.id) === Number(id));
  if (!empresa) return;

  const acao = status === 'ativo' ? 'ativar' : 'inativar';
  if (!confirm(`Confirma ${acao} a empresa "${empresa.nome}"?`)) return;

  try {
    const res = await Auth.fetch(`/api/admin/empresas/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao atualizar status.');

    empresa.status = data.status;
    renderizarEmpresas();
    avisar('Status da empresa atualizado.');
  } catch (err) {
    avisar(err.message || 'Não foi possível atualizar o status.', 'error');
  }
}

async function resetarSenhaUsuario(id) {
  const senha = prompt('Digite uma senha temporária com pelo menos 8 caracteres:');
  if (senha === null) return;
  if (senha.length < 8) {
    avisar('A senha temporária precisa ter pelo menos 8 caracteres.', 'error');
    return;
  }

  try {
    const res = await Auth.fetch(`/api/admin/usuarios/${id}/senha`, {
      method: 'PATCH',
      body: JSON.stringify({ senha }),
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao resetar senha.');
    avisar('Senha temporária atualizada.');
  } catch (err) {
    avisar(err.message || 'Não foi possível resetar a senha.', 'error');
  }
}

els.btnAtualizar?.addEventListener('click', carregarEmpresas);

els.empresasTbody?.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-action]');
  if (!botao) return;
  const { action, id, status } = botao.dataset;
  if (action === 'usuarios') carregarUsuarios(id);
  if (action === 'status') alterarStatusEmpresa(id, status);
});

els.usuariosTbody?.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-action="senha"]');
  if (botao) resetarSenhaUsuario(botao.dataset.id);
});

carregarEmpresas();
