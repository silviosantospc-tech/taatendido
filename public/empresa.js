/* ── Configurações da empresa ──────────────────────────── */

const campos = [
  'nome_empresa','segmento','whatsapp','email',
  'msg_saudacao','msg_fora_horario','msg_sem_resposta',
  'horario_seg_sex','horario_sabado','horario_domingo',
  'formas_pagamento','taxa_entrega','tempo_entrega',
];
const checkboxes = ['auto_saudacao','auto_fora_horario','auto_escalar'];

async function carregarConfig() {
  try {
    const res = await Auth.fetch('/api/empresa/config');
    if (!res || !res.ok) return;
    const config = await res.json();

    campos.forEach(chave => {
      const el = document.getElementById(chave);
      if (el && config[chave] !== undefined) el.value = config[chave];
    });

    checkboxes.forEach(chave => {
      const el = document.getElementById(chave);
      if (el) el.checked = config[chave] === 'true';
    });
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

async function salvarConfig() {
  const btn = document.getElementById('btnSalvar');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    const payload = {};
    campos.forEach(chave => {
      const el = document.getElementById(chave);
      if (el) payload[chave] = el.value;
    });
    checkboxes.forEach(chave => {
      const el = document.getElementById(chave);
      if (el) payload[chave] = String(el.checked);
    });

    const res = await Auth.fetch('/api/empresa/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (res && res.ok) {
      toast('Configurações salvas com sucesso!', 'success');
    } else {
      toast('Erro ao salvar. Tente novamente.', 'error');
    }
  } catch (err) {
    console.error(err);
    toast('Erro ao salvar. Tente novamente.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6"></path></svg> Salvar';
  }
}

// Testar agente
const btnTestar = document.getElementById('btnTestarAgente');
const secaoTestar = document.getElementById('secaoTestar');

btnTestar.addEventListener('click', () => {
  const visivel = secaoTestar.style.display !== 'none';
  secaoTestar.style.display = visivel ? 'none' : 'block';
  btnTestar.textContent = visivel ? 'Testar agente IA' : 'Fechar teste';
  if (!visivel) secaoTestar.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('btnEnviarTeste').addEventListener('click', async () => {
  const input = document.getElementById('inputTeste');
  const output = document.getElementById('respostaTeste');
  const mensagem = input.value.trim();

  if (!mensagem) return;

  output.textContent = 'Aguardando resposta do agente…';
  document.getElementById('btnEnviarTeste').disabled = true;

  try {
    const res = await Auth.fetch('/api/agente/testar', {
      method: 'POST',
      body: JSON.stringify({ mensagem }),
    });

    if (res && res.ok) {
      const data = await res.json();
      output.textContent = data.texto;
      if (data.escalar) {
        output.textContent += '\n\n⚠️ O agente sinalizou para escalar para um atendente humano.';
      }
    } else {
      const data = await res?.json().catch(() => ({}));
      output.textContent = '❌ ' + (data?.erro || 'Erro ao obter resposta do agente.');
    }
  } catch (err) {
    console.error(err);
    output.textContent = 'Erro de conexão.';
  } finally {
    document.getElementById('btnEnviarTeste').disabled = false;
  }
});

document.getElementById('inputTeste').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnEnviarTeste').click();
});

document.getElementById('btnSalvar').addEventListener('click', salvarConfig);

// Carregar ao abrir
carregarConfig();
