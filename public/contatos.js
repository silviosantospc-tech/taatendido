/* ── Contatos: API + UI ─────────────────────────────────── */

const statusMap = {
  "aberta":         { classe: "tag-blue",  label: "Aberta" },
  "em-atendimento": { classe: "tag-green", label: "Em atendimento" },
  "aguardando":     { classe: "tag-amber", label: "Aguardando" },
  "finalizado":     { classe: "tag-muted", label: "Finalizado" },
  "ativo":          { classe: "tag-blue",  label: "Ativo" },
};

const cores = ["#2563eb", "#22c55e", "#7c3aed", "#f97316", "#ec4899", "#0ea5e9"];

const tbody    = document.querySelector("#contatosTbody");
const contador = document.querySelector(".topbar p");

function iniciais(nome) {
  return (nome || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatarData(iso) {
  const d = new Date(iso);
  const agora = new Date();
  if (d.getDate() === agora.getDate()) {
    return `Hoje, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderContato(contato, index) {
  const ini = iniciais(contato.nome);
  const cor = cores[index % cores.length];
  const { classe, label } = statusMap[contato.status] || statusMap["ativo"];

  const tr = document.createElement("tr");
  tr.dataset.status = contato.status || 'ativo';
  tr.dataset.nome   = contato.nome || '';
  tr.innerHTML = `
    <td>
      <span class="mini-contact">
        <b style="background:${cor}">${esc(ini)}</b>
        ${esc(contato.nome)}
      </span>
    </td>
    <td class="td-muted">${esc(contato.telefone || '—')}</td>
    <td class="td-muted">WhatsApp</td>
    <td><span class="tag ${classe}">${esc(label)}</span></td>
    <td class="td-muted">${esc(formatarData(contato.criado_em))}</td>
    <td><button class="more-btn" aria-label="Mais opções">&#8942;</button></td>
  `;
  return tr;
}

async function carregarContatos() {
  try {
    const res = await Auth.fetch('/api/contatos');
    if (!res) return;
    const contatos = await res.json();

    tbody.innerHTML = '';
    contatos.forEach((c, i) => tbody.appendChild(renderContato(c, i)));

    atualizarContador();
    filtrarContatos();
  } catch (err) {
    console.error('Erro ao carregar contatos:', err);
  }
}

function atualizarContador() {
  if (!contador) return;
  const total = tbody.querySelectorAll('tr:not([style*="none"])').length;
  contador.textContent = `${total} contato${total !== 1 ? 's' : ''} cadastrado${total !== 1 ? 's' : ''}`;
}

/* ── Filtro ─────────────────────────────────────────────── */
const chips  = document.querySelectorAll(".filter-row .filter-chip");
const search = document.querySelector("#contatoSearch");

function filtrarContatos() {
  const filtro = document.querySelector(".filter-row .filter-chip.is-active")?.dataset.filter || "todos";
  const query  = search?.value.toLowerCase().trim() || "";

  tbody.querySelectorAll("tr").forEach((row) => {
    const status = row.dataset.status || "";
    const nome   = (row.dataset.nome || "").toLowerCase();
    const passaFiltro = filtro === "todos" || status === filtro;
    const passaBusca  = !query || nome.includes(query);
    row.style.display = passaFiltro && passaBusca ? "" : "none";
  });

  atualizarContador();
}

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chips.forEach(c => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    filtrarContatos();
  });
});

search?.addEventListener("input", filtrarContatos);

/* ── Modal: Novo contato ────────────────────────────────── */
const modal       = document.querySelector("#modalContato");
const btnAbrir    = document.querySelector("#btnNovoContato");
const btnFechar   = document.querySelector("#btnFecharModal");
const btnCancelar = document.querySelector("#btnCancelar");
const form        = document.querySelector("#formNovoContato");

function abrirModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => modal.classList.add("is-open"));
  document.querySelector("#inputNome").focus();
}

function fecharModal() {
  modal.classList.remove("is-open");
  modal.addEventListener("transitionend", () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    form.reset();
  }, { once: true });
}

btnAbrir?.addEventListener("click", abrirModal);
btnFechar?.addEventListener("click", fecharModal);
btnCancelar?.addEventListener("click", fecharModal);
modal?.addEventListener("click", e => { if (e.target === modal) fecharModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) fecharModal(); });

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome     = document.querySelector("#inputNome").value.trim();
  const telefone = document.querySelector("#inputTelefone").value.trim();
  const btnSalvar = form.querySelector('button[type="submit"]');

  if (!nome || !telefone) return;

  btnSalvar.textContent = 'Salvando...';
  btnSalvar.disabled = true;

  try {
    const res = await Auth.fetch('/api/contatos', {
      method: 'POST',
      body: JSON.stringify({ nome, telefone, segmento: 'WhatsApp' })
    });

    if (!res || !res.ok) {
      showToast('Erro ao salvar contato.', 'warning');
      return;
    }

    await carregarContatos();
    fecharModal();
    showToast('Contato cadastrado com sucesso!');
  } catch {
    showToast('Erro de conexão.', 'warning');
  } finally {
    btnSalvar.textContent = 'Salvar contato';
    btnSalvar.disabled = false;
  }
});

// Iniciar
carregarContatos();
