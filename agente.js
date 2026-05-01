/**
 * agente.js — Agente de IA do TáAtendido
 * Usa Google Gemini (gemini-1.5-flash) para responder clientes no WhatsApp
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Constrói o prompt de sistema com as informações do negócio
 */
function construirSystemPrompt(config, produtos) {
  const nome    = config.nome_empresa    || 'nossa empresa';
  const seg     = config.segmento        || '';
  const wapp    = config.whatsapp        || '';
  const saud    = config.msg_saudacao    || `Olá! Bem-vindo ao atendimento do ${nome}. Como posso ajudar?`;
  const fora    = config.msg_fora_horario|| 'Estamos fora do horário de atendimento. Em breve retornamos.';
  const semResp = config.msg_sem_resposta|| 'Vou chamar um atendente para te ajudar melhor.';
  const pgto    = config.formas_pagamento|| '';
  const entrega = config.taxa_entrega    || '';
  const tempo   = config.tempo_entrega   || '';
  const horSemana = config.horario_seg_sex || 'Segunda a sexta: 08:00 às 18:00';
  const horSab    = config.horario_sabado  || 'Sábado: 08:00 às 12:00';
  const horDom    = config.horario_domingo || 'Domingo: Fechado';

  let cardapio = '';
  if (produtos.length > 0) {
    const porCategoria = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Geral';
      if (!porCategoria[cat]) porCategoria[cat] = [];
      const preco = p.preco ? `R$ ${parseFloat(p.preco).toFixed(2).replace('.', ',')}` : '';
      const linha = preco ? `• ${p.nome} — ${preco}` : `• ${p.nome}`;
      const desc  = p.descricao ? ` (${p.descricao})` : '';
      porCategoria[cat].push(linha + desc);
    });

    cardapio = '\n\nCARDÁPIO / PRODUTOS DISPONÍVEIS:\n';
    Object.entries(porCategoria).forEach(([cat, itens]) => {
      cardapio += `\n${cat}:\n${itens.join('\n')}`;
    });
  }

  const infoPgto   = pgto     ? `\nFormas de pagamento aceitas: ${pgto}`           : '';
  const infoEntrega = entrega ? `\nTaxa de entrega: ${entrega}`                    : '';
  const infoTempo   = tempo   ? `\nTempo médio de entrega: ${tempo}`               : '';

  return `Você é o atendente virtual do(a) ${nome}${seg ? ` (${seg})` : ''}.

Seu papel é atender clientes pelo WhatsApp de forma simpática, objetiva e eficiente.

REGRAS IMPORTANTES:
1. Responda sempre em português do Brasil, de forma amigável e direta.
2. Nunca invente informações. Se não souber, diga que vai chamar um atendente.
3. Se o cliente quiser falar com humano, responda com: [ESCALAR]
4. Mensagens curtas e naturais — como num WhatsApp de verdade.
5. Não use markdown (negrito, itálico, asteriscos). Texto simples apenas.
6. Não repita a saudação se a conversa já começou.

HORÁRIOS DE ATENDIMENTO:
${horSemana}
${horSab}
${horDom}

MENSAGEM DE SAUDAÇÃO (use na primeira mensagem): ${saud}
MENSAGEM FORA DO HORÁRIO: ${fora}
QUANDO NÃO SOUBER: ${semResp}
${infoPgto}${infoEntrega}${infoTempo}${cardapio}

Quando o cliente fizer um pedido, confirme os itens, o valor total e a forma de entrega/retirada.`;
}

/**
 * Responde uma mensagem do cliente usando Gemini
 *
 * @param {object} opts
 * @param {string}   opts.mensagem  — mensagem atual do cliente
 * @param {Array}    opts.historico — [{tipo:'received'|'sent', conteudo:string}]
 * @param {object}   opts.config    — configurações da empresa
 * @param {Array}    opts.produtos  — lista de produtos
 * @returns {Promise<{texto:string, escalar:boolean}>}
 */
async function responder({ mensagem, historico, config, produtos }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY não configurada.');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: construirSystemPrompt(config, produtos),
  });

  // Converter histórico para o formato Gemini
  const history = historico.map(msg => ({
    role: msg.tipo === 'sent' ? 'model' : 'user',
    parts: [{ text: msg.conteudo }],
  }));

  const chat = model.startChat({ history });

  const result = await chat.sendMessage(mensagem);
  const texto  = result.response.text().trim();

  // Verificar se o agente quer escalar para humano
  const escalar = texto.includes('[ESCALAR]');
  const textoFinal = texto.replace('[ESCALAR]', '').trim();

  return { texto: textoFinal, escalar };
}

module.exports = { responder };
