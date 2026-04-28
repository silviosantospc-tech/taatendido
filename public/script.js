/* ── Conversas: troca de conversa ──────────────────────── */
const conversationButtons = document.querySelectorAll(".conversation-card");
const activeContact = document.querySelector("#activeContact");
const messageArea = document.querySelector("#messageArea");
const composer = document.querySelector("#composer");
const messageInput = document.querySelector("#messageInput");
const quickReplies = document.querySelectorAll(".quick-replies button");

const sampleMessages = {
  "Pousada Sol Mar": [
    ["received", "Bom dia! Vocês têm quarto disponível para casal neste fim de semana?"],
    ["sent bot", "Bom dia! Temos sim. Você deseja consultar diária, localização ou fazer uma reserva?"],
    ["received", "Quero saber a diária e se tem café da manhã."]
  ],
  "Farmácia Central": [
    ["received", "Boa tarde. Tem protetor solar fator 50?"],
    ["sent bot", "Boa tarde! Vou consultar os produtos disponíveis para você."],
    ["received", "Se tiver, quero saber se entrega no centro."]
  ],
  "Frigorífico Bom Corte": [
    ["received", "Bom dia. Quero fazer um pedido para entrega hoje."],
    ["sent bot", "Bom dia! Pode me informar os cortes e a quantidade desejada?"],
    ["received", "Quero 3kg de alcatra e 2kg de carne moída."]
  ],
  "Mercadinho Popular": [
    ["received", "Vocês aceitam pix na entrega?"],
    ["sent bot", "Aceitamos pix, dinheiro e cartão. Deseja montar um pedido?"],
    ["received", "Sim, quero ver as promoções de hoje."]
  ]
};

function renderMessages(contactName) {
  const messages = sampleMessages[contactName] || [];
  messageArea.innerHTML = "";

  messages.forEach(([type, text], index) => {
    const message = document.createElement("div");
    message.className = `message ${type}`;

    if (type.includes("bot")) {
      const label = document.createElement("span");
      label.textContent = "Bot";
      message.appendChild(label);
    }

    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    message.appendChild(paragraph);

    const time = document.createElement("time");
    time.textContent = index === messages.length - 1 ? "Agora" : "09:39";
    message.appendChild(time);

    messageArea.appendChild(message);
  });

  messageArea.scrollTop = messageArea.scrollHeight;
}

conversationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    conversationButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const contactName = button.dataset.contact;
    activeContact.textContent = contactName;
    renderMessages(contactName);
  });
});

quickReplies.forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.reply;
    messageInput.focus();
  });
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const message = document.createElement("div");
  message.className = "message sent";

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.appendChild(paragraph);

  const time = document.createElement("time");
  time.textContent = "Agora";
  message.appendChild(time);

  messageArea.appendChild(message);
  messageInput.value = "";
  messageArea.scrollTop = messageArea.scrollHeight;
});

/* ── Conversas: filtro por status ──────────────────────── */
const conversaChips = document.querySelectorAll(".filter-row .filter-chip");
const conversaSearch = document.querySelector("#conversaSearch");
const conversaCards = document.querySelectorAll(".conversation-card");

function filtrarConversas() {
  const filtroAtivo = document.querySelector(".filter-row .filter-chip.is-active")?.dataset.filter || "todas";
  const query = conversaSearch?.value.toLowerCase().trim() || "";

  conversaCards.forEach((card) => {
    const status = card.dataset.status || "";
    const nome = card.querySelector("strong")?.textContent.toLowerCase() || "";
    const preview = card.querySelector("small")?.textContent.toLowerCase() || "";

    const passaFiltro = filtroAtivo === "todas" || status === filtroAtivo;
    const passaBusca = !query || nome.includes(query) || preview.includes(query);

    card.style.display = passaFiltro && passaBusca ? "" : "none";
  });
}

conversaChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    conversaChips.forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    filtrarConversas();
  });
});

conversaSearch?.addEventListener("input", filtrarConversas);

/* ── Botão Finalizar ───────────────────────────────────── */
const btnFinalizar  = document.querySelector("#btnFinalizar");
const chatStatus    = document.querySelector("#chatStatus");

btnFinalizar?.addEventListener("click", () => {
  const cardAtivo = document.querySelector(".conversation-card.is-active");
  if (!cardAtivo) return;

  const jaFinalizada = cardAtivo.dataset.status === "finalizada";

  if (jaFinalizada) {
    // Reabrir
    cardAtivo.dataset.status = "em-atendimento";
    cardAtivo.style.opacity  = "";
    chatStatus.innerHTML     = `<span class="status-dot"></span> Em atendimento · WhatsApp`;
    btnFinalizar.textContent = "Finalizar";
    showToast("Conversa reaberta.", "info");
  } else {
    // Finalizar
    cardAtivo.dataset.status = "finalizada";
    cardAtivo.style.opacity  = "0.5";
    chatStatus.innerHTML     = `<span class="status-dot" style="background:#cbd5e1;box-shadow:none"></span> Finalizada · WhatsApp`;
    btnFinalizar.textContent = "Reabrir";
    showToast("Conversa finalizada!");

    // Remove badge de não lido, se houver
    cardAtivo.querySelector(".conversation-meta b")?.remove();
  }

  filtrarConversas();
});
