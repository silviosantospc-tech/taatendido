/* ── Filtro por status ─────────────────────────────────── */
const chips    = document.querySelectorAll(".filter-row .filter-chip");
const search   = document.querySelector("#contatoSearch");
const rows     = document.querySelectorAll("#contatosTbody tr");
const contador = document.querySelector(".topbar p");

function filtrarContatos() {
  const filtro = document.querySelector(".filter-row .filter-chip.is-active")?.dataset.filter || "todos";
  const query  = search?.value.toLowerCase().trim() || "";
  let visiveis = 0;

  rows.forEach((row) => {
    const status = row.dataset.status || "";
    const nome   = (row.dataset.nome || "").toLowerCase();

    const passaFiltro = filtro === "todos" || status === filtro;
    const passaBusca  = !query || nome.includes(query);

    const visivel = passaFiltro && passaBusca;
    row.style.display = visivel ? "" : "none";
    if (visivel) visiveis++;
  });

  if (contador) {
    contador.textContent = `${visiveis} contato${visiveis !== 1 ? "s" : ""} cadastrado${visiveis !== 1 ? "s" : ""}`;
  }
}

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chips.forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    filtrarContatos();
  });
});

search?.addEventListener("input", filtrarContatos);

/* ── Modal: Novo contato ───────────────────────────────── */
const modal         = document.querySelector("#modalContato");
const btnAbrir      = document.querySelector("#btnNovoContato");
const btnFechar     = document.querySelector("#btnFecharModal");
const btnCancelar   = document.querySelector("#btnCancelar");
const form          = document.querySelector("#formNovoContato");
const tbody         = document.querySelector("#contatosTbody");

const statusMap = {
  "aberta":          { classe: "tag-blue",  label: "Aberta" },
  "em-atendimento":  { classe: "tag-green", label: "Em atendimento" },
  "aguardando":      { classe: "tag-amber", label: "Aguardando" },
  "finalizado":      { classe: "tag-muted", label: "Finalizado" },
};

const cores = ["#2563eb", "#22c55e", "#7c3aed", "#f97316", "#ec4899", "#0ea5e9"];

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

modal?.addEventListener("click", (e) => {
  if (e.target === modal) fecharModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) fecharModal();
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();

  const nome    = document.querySelector("#inputNome").value.trim();
  const tel     = document.querySelector("#inputTelefone").value.trim();
  const origem  = document.querySelector("#inputOrigem").value;
  const status  = document.querySelector("#inputStatus").value;

  if (!nome || !tel) return;

  // Iniciais do avatar
  const iniciais = nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const cor      = cores[tbody.rows.length % cores.length];
  const { classe, label } = statusMap[status] || statusMap["aberta"];

  const agora = new Date();
  const hora  = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;

  const tr = document.createElement("tr");
  tr.dataset.status = status;
  tr.dataset.nome   = nome;
  tr.innerHTML = `
    <td>
      <span class="mini-contact">
        <b style="background:${cor}">${iniciais}</b>
        ${nome}
      </span>
    </td>
    <td class="td-muted">${tel}</td>
    <td class="td-muted">${origem}</td>
    <td><span class="tag ${classe}">${label}</span></td>
    <td class="td-muted">Hoje, ${hora}</td>
    <td><button class="more-btn" aria-label="Mais opções">&#8942;</button></td>
  `;

  tbody.prepend(tr);
  filtrarContatos();
  fecharModal();
});
