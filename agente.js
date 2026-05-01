/**
 * agente.js — Agente de IA do TáAtendido
 * Usa Google Gemini 2.5 Flash com cache em memória para reduzir custos
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Endpoint v1alpha suporta modelos mais recentes
const REQUEST_OPTS = { apiVersion: 'v1alpha' };

// ── Cache em memória do prompt do sistema ─────────────────
// Evita reconstruir o prompt a cada mensagem quando nada mudou.
// Quando config ou cardápio mudam, o cache é invalidado automaticamente.
let _promptCache = { hash: null, prompt: null };

function hashObjeto(obj) {
  return JSON.stringify(obj);
}

// ── Monta o cardápio formatado para o cliente ─────────────
function formatarCardapioCliente(produtos) {
  if (!produtos.length) return '';

  const porCategoria = {};
  produtos.forEach(p => {
    const cat = p.categoria || 'Geral';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(p);
  });

  let texto = '';
  Object.entries(porCategoria).forEach(([cat, itens]) => {
    texto += `\n*${cat}*\n`;
    itens.forEach(p => {
      const preco = p.preco ? ` — R$ ${parseFloat(p.preco).toFixed(2).replace('.', ',')}` : '';
      const desc  = p.descricao ? `\n   ${p.descricao}` : '';
      texto += `• ${p.nome}${preco}${desc}\n`;
    });
  });
  return texto.trim();
}

// ── Monta o prompt do sistema ─────────────────────────────
function construirSystemPrompt(config, produtos) {
  const nome     = config.nome_empresa     || 'nossa empresa';
  const seg      = config.segmento         || '';
  const saud     = config.msg_saudacao     || `Olá! Bem-vindo ao ${nome}! Como posso ajudar?`;
  const fora     = config.msg_fora_horario || 'Estamos fora do horário. Em breve retornamos!';
  const semResp  = config.msg_sem_resposta || 'Vou chamar um atendente para te ajudar.';
  const pgto     = config.formas_pagamento || '';
  const entrega  = config.taxa_entrega     || '';
  const tempo    = config.tempo_entrega    || '';
  const horSeg   = config.horario_seg_sex  || 'Segunda a sexta: 08:00 às 18:00';
  const horSab   = config.horario_sabado   || 'Sábado: 08:00 às 12:00';
  const horDom   = config.horario_domingo  || 'Domingo: Fechado';

  // Cardápio interno (formato de prompt — tokens reduzidos)
  let listaPrompt = '';
  if (produtos.length > 0) {
    const porCat = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Geral';
      if (!porCat[cat]) porCat[cat] = [];
      const preco = p.preco ? `R$${parseFloat(p.preco).toFixed(2)}` : '';
      porCat[cat].push(`${p.nome}${preco ? ' ' + preco : ''}${p.descricao ? ' (' + p.descricao + ')' : ''}`);
    });
    listaPrompt = '\nCARDÁPIO:\n';
    Object.entries(porCat).forEach(([cat, itens]) => {
      listaPrompt += `[${cat}] ${itens.join(' | ')}\n`;
    });
  }

  const infos = [
    pgto    ? `Pagamento: ${pgto}`    : '',
    entrega ? `Entrega: ${entrega}`   : '',
    tempo   ? `Tempo: ${tempo}`       : '',
  ].filter(Boolean).join(' | ');

  return `Você é o atendente virtual do(a) ${nome}${seg ? ` (${seg})` : ''} no WhatsApp.

REGRAS:
1. Português do Brasil, simpático e direto. Mensagens curtas como no WhatsApp.
2. Nunca invente informações. Se não souber, use: [ESCALAR]
3. Se o cliente pedir para falar com humano: [ESCALAR]
4. Sem markdown. Texto simples, use emojis com moderação.
5. Não repita a saudação se a conversa já começou.
6. Ao apresentar o cardápio completo, liste todos os itens por categoria com preço.
7. Ao confirmar pedido: repita os itens, valor total e forma de entrega/retirada.

HORÁRIOS: ${horSeg} | ${horSab} | ${horDom}
SAUDAÇÃO: ${saud}
FORA DO HORÁRIO: ${fora}
SEM RESPOSTA: ${semResp}
${infos ? infos + '\n' : ''}${listaPrompt}`;
}

// ── Obtém prompt do cache ou reconstrói ───────────────────
function getPrompt(config, produtos) {
  const hash = hashObjeto({ config, produtos });
  if (_promptCache.hash !== hash) {
    _promptCache = { hash, prompt: construirSystemPrompt(config, produtos) };
  }
  return _promptCache.prompt;
}

/**
 * Responde uma mensagem do cliente usando Gemini
 *
 * @param {object} opts
 * @param {string} opts.mensagem  — mensagem atual do cliente
 * @param {Array}  opts.historico — [{tipo:'received'|'sent', conteudo:string}]
 * @param {object} opts.config    — configurações da empresa
 * @param {Array}  opts.produtos  — lista de produtos disponíveis
 * @returns {Promise<{texto:string, escalar:boolean, cardapio:string|null}>}
 */
async function responder({ mensagem, historico, config, produtos }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY não configurada.');
  }

  const systemPrompt = getPrompt(config, produtos);

  const model = genAI.getGenerativeModel(
    {
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 350,      // limita custo de saída
        temperature: 0.7,
      },
    },
    REQUEST_OPTS
  );

  // Últimas 8 mensagens — reduz tokens de entrada sem perder contexto relevante
  const historicoRecente = historico.slice(-8);
  const history = historicoRecente.map(msg => ({
    role: msg.tipo === 'sent' ? 'model' : 'user',
    parts: [{ text: msg.conteudo }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(mensagem);
  const texto  = result.response.text().trim();

  // Detectar escalada para humano
  const escalar = texto.includes('[ESCALAR]');
  const textoFinal = texto.replace('[ESCALAR]', '').trim();

  // Detectar se o agente enviou o cardápio completo
  // (para futuramente incluir fotos dos produtos via WhatsApp)
  const pedidoCardapio = /card[aá]pio|produtos|itens|opç[oõ]es|tem pra comer|o que voc[eê]s t[eê]m/i.test(mensagem);
  const cardapioFormatado = pedidoCardapio && produtos.length > 0
    ? formatarCardapioCliente(produtos)
    : null;

  return { texto: textoFinal, escalar, cardapio: cardapioFormatado };
}

module.exports = { responder };
