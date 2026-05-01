/* ── Produtos / Cardápio ───────────────────────────────── */

let produtos = [];

function formatarPreco(preco) {
  if (!preco && preco !== 0) return '';
  return 'R$ ' + parseFloat(preco).toFixed(2).replace('.', ',');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const grupos = {};
  produtos.forEach(p => {
    const cat = p.categoria || 'Sem categoria';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(p);
  });

  lista.innerHTML = Object.entries(grupos).map(([cat, itens]) => `
    <div style="margin-bottom:24px">
      <h3 style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:0 0 10px">${escHtml(cat)}</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${itens.map(p => `
          <div class="reply-card" style="display:flex;align-items:center;gap:12px;padding:12px 16px" data-id="${p.id}">
            ${p.foto_url
              ? `<img src="${escHtml(p.foto_url)}" alt="${escHtml(p.nome)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1.5px solid var(--border)">`
              : `<div style="width:56px;height:56px;border-radius:8px;background:var(--surface-2,#f1f5f9);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <svg viewBox="0 0 24 24" style="width:22px;height:22px;color:var(--text-muted)" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>`
            }
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <strong style="font-size:.95rem">${escHtml(p.nome)}</strong>
                ${p.preco ? `<span style="font-size:.875rem;color:var(--primary,#22c55e);font-weight:600">${formatarPreco(p.preco)}</span>` : ''}
                ${!p.disponivel ? '<span class="tag tag-muted" style="font-size:.75rem">Indisponível</span>' : ''}
              </div>
              ${p.descricao ? `<p style="font-size:.85rem;color:var(--text-muted);margin:2px 0 0">${escHtml(p.descricao)}</p>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <label style="cursor:pointer;font-size:.8rem" title="Trocar foto">
                <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="trocarFoto(event, ${p.id})">
                <span class="secondary-button" style="padding:5px 10px;font-size:.8rem;display:inline-flex;align-items:center;gap:4px">
                  <svg viewBox="0 0 24 24" style="width:12px;height:12px" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  Foto
                </span>
              </label>
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

// Upload de foto para um produto já existente
async function trocarFoto(event, id) {
  const file = event.target.files[0];
  if (!file) return;

  const form = new FormData();
  form.append('foto', file);

  try {
    const token = localStorage.getItem('ta_token');
    const upRes = await fetch('/api/upload/foto', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!upRes.ok) { toast('Erro ao enviar foto.', 'error'); return; }
    const { url } = await upRes.json();

    // Salva a URL no produto (via PATCH)
    const pRes = await Auth.fetch(`/api/produtos/${id}/foto`, {
      method: 'PATCH',
      body: JSON.stringify({ foto_url: url }),
    });

    if (pRes && pRes.ok) {
      const atualizado = await pRes.json();
      produtos = produtos.map(p => p.id === id ? atualizado : p);
      renderProdutos();
      toast('Foto atualizada!', 'success');
    }
  } catch (err) {
    console.error(err);
    toast('Erro ao atualizar foto.', 'error');
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

// Prévia da foto no formulário
document.getElementById('prodFoto').addEventListener('change', e => {
  const file = e.target.files[0];
  const preview = document.getElementById('previewFoto');
  const img = document.getElementById('imgPreview');
  if (file) {
    img.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
});

// Formulário de novo produto
document.getElementById('formProduto').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('btnAdicionarProduto');
  btn.disabled = true;
  btn.textContent = 'Adicionando…';

  const nome      = document.getElementById('prodNome').value.trim();
  const categoria = document.getElementById('prodCategoria').value.trim();
  const preco     = document.getElementById('prodPreco').value;
  const descricao = document.getElementById('prodDescricao').value.trim();
  const fotoFile  = document.getElementById('prodFoto').files[0];

  try {
    // 1. Fazer upload da foto se houver
    let foto_url = null;
    if (fotoFile) {
      const form = new FormData();
      form.append('foto', fotoFile);
      const token = localStorage.getItem('ta_token');
      const upRes = await fetch('/api/upload/foto', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (upRes.ok) {
        const data = await upRes.json();
        foto_url = data.url;
      }
    }

    // 2. Criar o produto com a URL da foto
    const res = await Auth.fetch('/api/produtos', {
      method: 'POST',
      body: JSON.stringify({ nome, categoria, preco: preco || null, descricao, foto_url }),
    });

    if (res && res.ok) {
      const novo = await res.json();
      produtos.push(novo);
      renderProdutos();
      e.target.reset();
      document.getElementById('previewFoto').style.display = 'none';
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
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Adicionar';
  }
});

carregarProdutos();
