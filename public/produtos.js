/* ── Produtos / Cardápio ───────────────────────────────── */

let produtos = [];

function formatarPreco(preco) {
  if (!preco && preco !== 0) return '';
  return 'R$ ' + parseFloat(preco).toFixed(2).replace('.', ',');
}

function renderProdutos() {
  const lista = document.getElementById('listaProdutos');
  const contador = document.getElementById('contadorProdutos');

  if (!produtos.length) {
    lista.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;padding:8px 0">Nenhum produto cadastrado ainda. Adicione o primeiro item acima.</p>';
    contador.textContent = '0 produtos';
    return;
  }

  contador.textContent = `${produtos.length} produto${produtos.length !== 1 ? 's' : ''}`;

  // Agrupar por categoria
  const grupos = {};
  produtos.forEach(p => {
    const cat = p.categoria || 'Sem categoria';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(p);
  });

  lista.innerHTML = Object.entries(grupos).map(([cat, itens]) => `
    <div style="margin-bottom:24px">
      <h3 style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:0 0 10px">${cat}</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${itens.map(p => `
          <div class="reply-card" style="display:flex;align-items:center;gap:12px;padding:12px 16px" data-id="${p.id}">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <strong style="font-size:.95rem">${escHtml(p.nome)}</strong>
                ${p.preco ? `<span style="font-size:.875rem;color:var(--primary,#22c55e);font-weight:600">${formatarPreco(p.preco)}</span>` : ''}
                ${!p.disponivel ? '<span class="tag tag-muted" style="font-size:.75rem">Indisponível</span>' : ''}
              </div>
              ${p.descricao ? `<p style="font-size:.85rem;color:var(--text-muted);margin:2px 0 0">${escHtml(p.descricao)}</p>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button
                class="secondary-button"
                style="padding:5px 10px;font-size:.8rem"
                onclick="toggleDisponivel(${p.id}, ${!p.disponivel})"
              >${p.disponivel ? 'Desativar' : 'Ativar'}</button>
              <button
                class="icon-btn"
                style="color:#ef4444;width:32px;height:32px;border-radius:6px;border:1.5px solid #fecaca;background:#fff5f5"
                aria-label="Excluir"
                onclick="excluirProduto(${p.id})"
              >
                <svg viewBox="0 0 24 24" style="width:14px;height:14px" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function carregarProdutos() {
  try {
    const res = await Auth.fetch('/api/produtos');
    if (!res || !res.ok) return;
    produtos = await res.json();
    renderProdutos();
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
  }
}

async function toggleDisponivel(id, disponivel) {
  try {
    const res = await Auth.fetch(`/api/produtos/${id}/disponivel`, {
      method: 'PATCH',
      body: JSON.stringify({ disponivel }),
    });
    if (res && res.ok) {
      const atualizado = await res.json();
      produtos = produtos.map(p => p.id === id ? atualizado : p);
      renderProdutos();
      toast(disponivel ? 'Produto ativado.' : 'Produto desativado.', 'success');
    }
  } catch (err) {
    console.error(err);
    toast('Erro ao atualizar produto.', 'error');
  }
}

async function excluirProduto(id) {
  if (!confirm('Remover este produto do cardápio?')) return;
  try {
    const res = await Auth.fetch(`/api/produtos/${id}`, { method: 'DELETE' });
    if (res && res.ok) {
      produtos = produtos.filter(p => p.id !== id);
      renderProdutos();
      toast('Produto removido.', 'success');
    }
  } catch (err) {
    console.error(err);
    toast('Erro ao remover produto.', 'error');
  }
}

// Formulário de novo produto
document.getElementById('formProduto').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('btnAdicionarProduto');
  btn.disabled = true;

  const nome      = document.getElementById('prodNome').value.trim();
  const categoria = document.getElementById('prodCategoria').value.trim();
  const preco     = document.getElementById('prodPreco').value;
  const descricao = document.getElementById('prodDescricao').value.trim();

  try {
    const res = await Auth.fetch('/api/produtos', {
      method: 'POST',
      body: JSON.stringify({ nome, categoria, preco: preco || null, descricao }),
    });

    if (res && res.ok) {
      const novo = await res.json();
      produtos.push(novo);
      renderProdutos();
      e.target.reset();
      toast('Produto adicionado!', 'success');
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.erro || 'Erro ao adicionar produto.', 'error');
    }
  } catch (err) {
    console.error(err);
    toast('Erro de conexão.', 'error');
  } finally {
    btn.disabled = false;
  }
});

carregarProdutos();
