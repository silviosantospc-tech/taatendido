const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.PORT || 3000;

// ── JWT Secret obrigatório ────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERRO CRÍTICO: JWT_SECRET não definido. Defina a variável de ambiente antes de iniciar.');
  process.exit(1);
}

const REGISTRATION_CODE = process.env.REGISTRATION_CODE;
const PUBLIC_REGISTRATION_ENABLED = process.env.PUBLIC_REGISTRATION_ENABLED === 'true';
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);
const retentionDaysRaw = parseInt(process.env.DEFAULT_RETENTION_DAYS || '365', 10);
const DEFAULT_RETENTION_DAYS = Number.isFinite(retentionDaysRaw) ? Math.max(retentionDaysRaw, 30) : 365;
const APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || '';
if (!APP_ENCRYPTION_KEY) {
  console.warn('AVISO: APP_ENCRYPTION_KEY não definida. Dados novos não serão criptografados no banco.');
}

// ── CORS: apenas domínios autorizados ────────────────────
const origensPermitidas = [
  'https://taatendido.com.br',
  'https://www.taatendido.com.br',
  'http://localhost:3000',
  'http://localhost:5500',
];
// Necessário para rate-limit funcionar corretamente atrás do Traefik
app.set('trust proxy', 1);

// ── Segurança: headers HTTP ───────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https://i.pravatar.cc"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origensPermitidas.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

function capturarRawBody(req, res, buf) {
  if (buf?.length) req.rawBody = Buffer.from(buf);
}

app.use(express.json({ limit: '20kb', verify: capturarRawBody }));

// ── Redirecionar HTTP → HTTPS em produção ────────────────
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ── Rate limiting: auth (anti brute-force) ───────────────
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // máximo 10 tentativas por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
});

// ── Rate limiting: geral ──────────────────────────────────
const limiterGeral = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
});

app.use('/api/', limiterGeral);
app.use('/api/auth/login', limiterAuth);
app.use('/api/auth/registro', limiterAuth);

// ── Raiz → landing page ───────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ── Servir o frontend estático ────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Conexão com banco de dados ────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

// ── Middleware de autenticação ────────────────────────────
function cookieValor(req, nome) {
  const cookies = req.headers.cookie || '';
  const item = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(nome + '='));
  return item ? decodeURIComponent(item.slice(nome.length + 1)) : null;
}

function opcoesCookieAuth(req) {
  const seguro = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: seguro,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function criarToken(usuario) {
  return jwt.sign(montarUsuarioToken(usuario), JWT_SECRET, { expiresIn: '7d' });
}

function emitirSessao(req, res, usuario) {
  const token = criarToken(usuario);
  res.cookie('ta_session', token, opcoesCookieAuth(req));
  return token;
}

function limparSessao(req, res) {
  res.clearCookie('ta_session', { ...opcoesCookieAuth(req), maxAge: undefined });
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || cookieValor(req, 'ta_session');
  if (!token) return res.status(401).json({ erro: 'Token não fornecido.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const params = payload.empresa_id ? [payload.id, payload.empresa_id] : [payload.id];
    const whereEmpresa = payload.empresa_id ? 'AND u.empresa_id=$2' : '';
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.papel, u.empresa_id, u.precisa_trocar_senha, u.permissoes, e.status AS empresa_status
      FROM usuarios u
      JOIN empresas e ON e.id = u.empresa_id
      WHERE u.id=$1 ${whereEmpresa}
    `, params);

    if (!rows.length || !rows[0].empresa_id) {
      return res.status(401).json({ erro: 'Usuario sem empresa vinculada.' });
    }

    if (rows[0].empresa_status !== 'ativo' && !emailEhSuperAdmin(rows[0].email)) {
      return res.status(403).json({ erro: 'Empresa inativa. Fale com o suporte.' });
    }

    req.usuario = rows[0];
    const rotasLiberadas = ['/api/auth/me', '/api/auth/trocar-senha', '/api/auth/logout', '/api/auth/2fa/status', '/api/auth/2fa/setup', '/api/auth/2fa/ativar'];
    if (req.usuario.precisa_trocar_senha && !rotasLiberadas.includes(req.path)) {
      return res.status(403).json({
        erro: 'Troca de senha obrigatoria.',
        troca_senha_obrigatoria: true,
      });
    }
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'TáAtendido API', timestamp: new Date().toISOString() });
});

// ── Inicializar tabelas ───────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'ativo',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    INSERT INTO empresas (nome, slug)
    VALUES ('TáAtendido Demo', 'taatendido-demo')
    ON CONFLICT (slug) DO NOTHING;

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      empresa_id INTEGER REFERENCES empresas(id),
      papel TEXT DEFAULT 'atendente',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome TEXT NOT NULL,
      telefone TEXT,
      segmento TEXT,
      status TEXT DEFAULT 'ativo',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      contato_id INTEGER REFERENCES contatos(id),
      status TEXT DEFAULT 'aberta',
      canal TEXT DEFAULT 'whatsapp',
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mensagens (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      conversa_id INTEGER REFERENCES conversas(id),
      tipo TEXT DEFAULT 'received',
      conteudo TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS respostas_rapidas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      titulo TEXT NOT NULL,
      categoria TEXT,
      mensagem TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS empresa_config (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      chave TEXT NOT NULL,
      valor TEXT,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome TEXT NOT NULL,
      descricao TEXT,
      preco NUMERIC(10,2),
      categoria TEXT,
      foto_url TEXT,
      disponivel BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      acao TEXT NOT NULL,
      alvo_tipo TEXT,
      alvo_id TEXT,
      ip TEXT,
      user_agent TEXT,
      detalhes JSONB DEFAULT '{}'::jsonb,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS foto_url TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS precisa_trocar_senha BOOLEAN DEFAULT FALSE;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_alterada_em TIMESTAMP;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativo BOOLEAN DEFAULT FALSE;
    ALTER TABLE contatos ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE contatos ADD COLUMN IF NOT EXISTS telefone_hash TEXT;
    ALTER TABLE conversas ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE respostas_rapidas ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE empresa_config ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);

    UPDATE usuarios SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE contatos SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE conversas SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE mensagens SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE respostas_rapidas SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE empresa_config SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;
    UPDATE produtos SET empresa_id=(SELECT id FROM empresas WHERE slug='taatendido-demo') WHERE empresa_id IS NULL;

    ALTER TABLE usuarios ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE contatos ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE conversas ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE mensagens ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE respostas_rapidas ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE empresa_config ALTER COLUMN empresa_id SET NOT NULL;
    ALTER TABLE produtos ALTER COLUMN empresa_id SET NOT NULL;

    ALTER TABLE empresa_config DROP CONSTRAINT IF EXISTS empresa_config_chave_key;
    CREATE UNIQUE INDEX IF NOT EXISTS empresa_config_empresa_chave_idx ON empresa_config (empresa_id, chave);
    CREATE INDEX IF NOT EXISTS usuarios_empresa_idx ON usuarios (empresa_id);
    CREATE INDEX IF NOT EXISTS contatos_empresa_idx ON contatos (empresa_id);
    CREATE INDEX IF NOT EXISTS contatos_empresa_telefone_hash_idx ON contatos (empresa_id, telefone_hash);
    CREATE INDEX IF NOT EXISTS conversas_empresa_idx ON conversas (empresa_id);
    CREATE INDEX IF NOT EXISTS mensagens_empresa_idx ON mensagens (empresa_id);
    CREATE INDEX IF NOT EXISTS respostas_empresa_idx ON respostas_rapidas (empresa_id);
    CREATE INDEX IF NOT EXISTS produtos_empresa_idx ON produtos (empresa_id);
    CREATE INDEX IF NOT EXISTS auditoria_empresa_idx ON auditoria (empresa_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS auditoria_acao_idx ON auditoria (acao, criado_em DESC);
  `);
  console.log('Banco de dados inicializado com sucesso.');
}

async function aplicarRetencaoDados() {
  const dias = DEFAULT_RETENTION_DAYS;
  try {
    const resultMensagens = await pool.query(
      "DELETE FROM mensagens WHERE criado_em < NOW() - ($1 || ' days')::interval",
      [dias]
    );
    const resultAuditoria = await pool.query(
      "DELETE FROM auditoria WHERE criado_em < NOW() - ($1 || ' days')::interval",
      [Math.max(dias, 365)]
    );
    console.log(`[retencao] mensagens removidas=${resultMensagens.rowCount}; auditoria removida=${resultAuditoria.rowCount}; dias=${dias}`);
  } catch (err) {
    console.error('[retencao]', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────
function erroInterno(res, err) {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarId(id) {
  const n = parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function empresaId(req) {
  return req.usuario?.empresa_id;
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  }
  next();
}

function temPermissao(req, permissao) {
  if (req.usuario?.papel === 'admin' || ehSuperAdmin(req)) return true;
  const permissoes = req.usuario?.permissoes || {};
  return permissoes[permissao] === true;
}

function exigirPermissao(permissao) {
  return (req, res, next) => {
    if (!temPermissao(req, permissao)) {
      return res.status(403).json({ erro: 'Permissao insuficiente.' });
    }
    next();
  };
}

function emailEhSuperAdmin(email) {
  return SUPER_ADMIN_EMAILS.includes(String(email || '').toLowerCase());
}

function ehSuperAdmin(req) {
  return emailEhSuperAdmin(req.usuario?.email);
}

function exigirSuperAdmin(req, res, next) {
  if (!ehSuperAdmin(req)) {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador do sistema.' });
  }
  next();
}

function ipRequisicao(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
}

async function registrarAuditoria(req, acao, alvoTipo = null, alvoId = null, detalhes = {}) {
  try {
    await pool.query(
      `INSERT INTO auditoria (empresa_id, usuario_id, acao, alvo_tipo, alvo_id, ip, user_agent, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.usuario?.empresa_id || detalhes.empresa_id || null,
        req.usuario?.id || detalhes.usuario_id || null,
        acao,
        alvoTipo,
        alvoId ? String(alvoId) : null,
        ipRequisicao(req),
        String(req.get('user-agent') || '').slice(0, 300),
        JSON.stringify(detalhes || {}),
      ]
    );
  } catch (err) {
    console.error('[auditoria]', err.message);
  }
}

function chaveCriptografia() {
  if (!APP_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY).digest();
}

function criptografarTexto(valor) {
  if (!valor) return valor;
  const chave = chaveCriptografia();
  if (!chave) return valor;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cipher.update(String(valor), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

function hashDado(valor) {
  if (!valor) return null;
  return crypto.createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

function descriptografarTexto(valor) {
  if (!valor || !String(valor).startsWith('enc:v1:')) return valor;
  const chave = chaveCriptografia();
  if (!chave) return '[dado criptografado]';
  try {
    const [, , ivB64, tagB64, dadosB64] = String(valor).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dadosB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '[erro ao descriptografar]';
  }
}

function descriptografarLinha(row, campos) {
  const copia = { ...row };
  campos.forEach(campo => { copia[campo] = descriptografarTexto(copia[campo]); });
  return copia;
}

const BASE32_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function gerarBase32(bytes = 20) {
  const buffer = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map(parte => BASE32_ALFABETO[parseInt(parte.padEnd(5, '0'), 2)]).join('');
}

function base32ParaBuffer(secret) {
  const limpo = String(secret || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const char of limpo) {
    const idx = BASE32_ALFABETO.indexOf(char);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) || [];
  return Buffer.from(bytes.map(byte => parseInt(byte, 2)));
}

function gerarTotp(secret, janela = Math.floor(Date.now() / 30000)) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(janela, 4);
  const hmac = crypto.createHmac('sha1', base32ParaBuffer(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binario = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binario % 1000000).padStart(6, '0');
}

function validarTotp(secret, codigo) {
  const informado = String(codigo || '').replace(/\D/g, '');
  if (informado.length !== 6 || !secret) return false;
  const janela = Math.floor(Date.now() / 30000);
  for (let delta = -1; delta <= 1; delta++) {
    if (compararSeguro(gerarTotp(secret, janela + delta), informado)) return true;
  }
  return false;
}

function compararSeguro(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function validarAssinaturaMeta(req) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return false;
  const assinatura = req.get('x-hub-signature-256') || '';
  const esperado = 'sha256=' + crypto
    .createHmac('sha256', segredo)
    .update(req.rawBody || Buffer.from(JSON.stringify(req.body || {})))
    .digest('hex');
  return compararSeguro(assinatura, esperado);
}

function validarAssinaturaTwilio(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const assinatura = req.get('x-twilio-signature') || '';
  if (!authToken || !assinatura) return false;

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = Object.keys(req.body || {})
    .sort()
    .map(chave => chave + req.body[chave])
    .join('');
  const esperado = crypto.createHmac('sha1', authToken).update(url + params).digest('base64');
  return compararSeguro(assinatura, esperado);
}

function gerarSlug(texto) {
  return String(texto || 'empresa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'empresa';
}

async function criarEmpresa(nomeEmpresa) {
  const nome = String(nomeEmpresa || 'Minha empresa').trim().slice(0, 200) || 'Minha empresa';
  const base = gerarSlug(nome);

  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      const { rows } = await pool.query(
        'INSERT INTO empresas (nome, slug) VALUES ($1, $2) RETURNING id, nome, slug',
        [nome, slug]
      );
      return rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err;
    }
  }

  const slug = `${base}-${Date.now()}`;
  const { rows } = await pool.query(
    'INSERT INTO empresas (nome, slug) VALUES ($1, $2) RETURNING id, nome, slug',
    [nome, slug]
  );
  return rows[0];
}

function montarUsuarioToken(usuario) {
  return {
    id: usuario.id,
    email: usuario.email,
    papel: usuario.papel,
    empresa_id: usuario.empresa_id,
  };
}

function montarUsuarioPublico(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    empresa_id: usuario.empresa_id,
    empresa_nome: usuario.empresa_nome,
    super_admin: emailEhSuperAdmin(usuario.email),
    precisa_trocar_senha: usuario.precisa_trocar_senha === true,
    mfa_ativo: usuario.mfa_ativo === true,
    permissoes: usuario.permissoes || {},
  };
}

// Hash dummy pré-gerado para evitar timing attack no login
// (mesmo custo que o hash real, sem revelar se o email existe)
const DUMMY_HASH = '$2b$12$KIXBc5P2nkxJ7nCc5S8Np.kULaXexPBiT5F5L5R3JwK6NxH1zGxSe';

// ── Auth: Registro ────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nome, email, senha, empresa_nome, codigo_convite } = req.body;

    if (!PUBLIC_REGISTRATION_ENABLED && !REGISTRATION_CODE) {
      return res.status(403).json({ erro: 'Cadastro publico fechado. Solicite um convite.' });
    }

    if (REGISTRATION_CODE && codigo_convite !== REGISTRATION_CODE) {
      return res.status(403).json({ erro: 'Codigo de convite invalido.' });
    }

    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'Preencha todos os campos.' });

    if (!validarEmail(email))
      return res.status(400).json({ erro: 'Email inválido.' });

    if (senha.length < 6)
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });

    if (nome.length > 100 || email.length > 150)
      return res.status(400).json({ erro: 'Dados inválidos.' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email=$1', [email.toLowerCase()]);
    if (existe.rows.length) return res.status(409).json({ erro: 'Email já cadastrado.' });

    const empresa = await criarEmpresa(empresa_nome || nome);
    const senha_hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, empresa_id, papel, senha_alterada_em)
       VALUES ($1, $2, $3, $4, 'admin', NOW())
       RETURNING id, nome, email, papel, empresa_id, precisa_trocar_senha, permissoes, mfa_ativo`,
      [nome.trim(), email.toLowerCase(), senha_hash, empresa.id]
    );

    rows[0].empresa_nome = empresa.nome;
    const token = emitirSessao(req, res, rows[0]);
    await registrarAuditoria({ ...req, usuario: rows[0] }, 'auth.registro', 'usuario', rows[0].id, { empresa_id: empresa.id });
    res.status(201).json({ token, usuario: montarUsuarioPublico(rows[0]) });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Auth: Login ───────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha, codigo_2fa } = req.body;

    if (!email || !senha)
      return res.status(400).json({ erro: 'Preencha email e senha.' });

    if (!validarEmail(email))
      return res.status(400).json({ erro: 'Email inválido.' });

    const { rows } = await pool.query(`
      SELECT u.*, e.nome AS empresa_nome, e.status AS empresa_status
      FROM usuarios u
      JOIN empresas e ON e.id = u.empresa_id
      WHERE u.email=$1
    `, [email.toLowerCase()]);

    // Mesmo tempo de resposta se o usuário não existir (evita user enumeration)
    const hash = rows.length ? rows[0].senha_hash : DUMMY_HASH;
    const valido = await bcrypt.compare(senha, hash);

    if (!rows.length || !valido) {
      await registrarAuditoria(req, 'auth.login_falha', 'usuario', null, { email: String(email || '').toLowerCase() });
      return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    }

    if (rows[0].empresa_status === 'inativo' && !emailEhSuperAdmin(rows[0].email)) {
      await registrarAuditoria({ ...req, usuario: rows[0] }, 'auth.login_empresa_inativa', 'empresa', rows[0].empresa_id);
      return res.status(403).json({ erro: 'Empresa inativa. Fale com o suporte.' });
    }

    if (emailEhSuperAdmin(rows[0].email) && rows[0].mfa_ativo) {
      if (!codigo_2fa) {
        return res.status(401).json({ requer_2fa: true, erro: 'Informe o codigo de verificacao.' });
      }
      if (!validarTotp(descriptografarTexto(rows[0].mfa_secret), codigo_2fa)) {
        await registrarAuditoria({ ...req, usuario: rows[0] }, 'auth.2fa_falha', 'usuario', rows[0].id);
        return res.status(401).json({ erro: 'Codigo de verificacao invalido.' });
      }
    }

    const token = emitirSessao(req, res, rows[0]);
    await registrarAuditoria({ ...req, usuario: rows[0] }, 'auth.login_sucesso', 'usuario', rows[0].id);
    res.json({ token, usuario: montarUsuarioPublico(rows[0]) });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Auth: Verificar token ─────────────────────────────────
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nome, u.email, u.papel, u.empresa_id, u.precisa_trocar_senha, u.permissoes, u.mfa_ativo, e.nome AS empresa_nome
      FROM usuarios u
      JOIN empresas e ON e.id = u.empresa_id
      WHERE u.id=$1 AND u.empresa_id=$2
    `, [req.usuario.id, empresaId(req)]);
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(montarUsuarioPublico(rows[0]));
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/auth/trocar-senha', authMiddleware, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!nova_senha || nova_senha.length < 8) {
      return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 8 caracteres.' });
    }

    const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id=$1 AND empresa_id=$2', [req.usuario.id, empresaId(req)]);
    if (!rows.length) return res.status(404).json({ erro: 'Usuario nao encontrado.' });

    if (senha_atual) {
      const atualOk = await bcrypt.compare(senha_atual, rows[0].senha_hash);
      if (!atualOk) return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const senha_hash = await bcrypt.hash(nova_senha, 12);
    await pool.query(
      'UPDATE usuarios SET senha_hash=$1, precisa_trocar_senha=FALSE, senha_alterada_em=NOW() WHERE id=$2 AND empresa_id=$3',
      [senha_hash, req.usuario.id, empresaId(req)]
    );
    await registrarAuditoria(req, 'auth.senha_alterada', 'usuario', req.usuario.id);
    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

app.get('/api/auth/2fa/status', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT mfa_ativo FROM usuarios WHERE id=$1', [req.usuario.id]);
    res.json({ mfa_ativo: rows[0]?.mfa_ativo === true });
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/auth/2fa/setup', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const secret = gerarBase32();
    await pool.query('UPDATE usuarios SET mfa_secret=$1, mfa_ativo=FALSE WHERE id=$2', [criptografarTexto(secret), req.usuario.id]);
    await registrarAuditoria(req, 'auth.2fa_setup', 'usuario', req.usuario.id);
    const label = encodeURIComponent(`TáAtendido:${req.usuario.email}`);
    const issuer = encodeURIComponent('TáAtendido');
    res.json({
      secret,
      otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    });
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/auth/2fa/ativar', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const { codigo } = req.body;
    const { rows } = await pool.query('SELECT mfa_secret FROM usuarios WHERE id=$1', [req.usuario.id]);
    const secret = descriptografarTexto(rows[0]?.mfa_secret);
    if (!secret) return res.status(400).json({ erro: 'Configure o 2FA primeiro.' });
    if (!validarTotp(secret, codigo)) return res.status(400).json({ erro: 'Codigo invalido.' });
    await pool.query('UPDATE usuarios SET mfa_ativo=TRUE WHERE id=$1', [req.usuario.id]);
    await registrarAuditoria(req, 'auth.2fa_ativado', 'usuario', req.usuario.id);
    res.json({ mensagem: '2FA ativado.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Contatos ──────────────────────────────────────────────
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || cookieValor(req, 'ta_session');
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      await registrarAuditoria({ ...req, usuario: payload }, 'auth.logout', 'usuario', payload.id);
    }
  } catch {}
  limparSessao(req, res);
  res.json({ mensagem: 'Sessao encerrada.' });
});

app.get('/api/admin/empresas', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        e.id,
        e.nome,
        e.slug,
        e.status,
        e.criado_em,
        COUNT(DISTINCT u.id)::int AS usuarios,
        COUNT(DISTINCT c.id)::int AS conversas,
        COUNT(DISTINCT p.id)::int AS produtos,
        MAX(c.atualizado_em) AS ultima_conversa
      FROM empresas e
      LEFT JOIN usuarios u ON u.empresa_id = e.id
      LEFT JOIN conversas c ON c.empresa_id = e.id
      LEFT JOIN produtos p ON p.empresa_id = e.id
      GROUP BY e.id
      ORDER BY e.criado_em DESC
    `);
    res.json(rows.map(row => descriptografarLinha(row, ['conteudo'])));
  } catch (err) {
    erroInterno(res, err);
  }
});

app.get('/api/admin/empresas/:id/usuarios', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID invalido.' });

    const { rows } = await pool.query(
      `SELECT id, nome, email, papel, criado_em, precisa_trocar_senha, permissoes, mfa_ativo
       FROM usuarios
       WHERE empresa_id=$1
       ORDER BY criado_em DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/admin/empresas/:id/status', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID invalido.' });

    const status = req.body.status;
    if (!['ativo', 'inativo'].includes(status)) {
      return res.status(400).json({ erro: 'Status invalido.' });
    }

    const { rows } = await pool.query(
      'UPDATE empresas SET status=$1 WHERE id=$2 RETURNING id, nome, slug, status, criado_em',
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Empresa nao encontrada.' });
    await registrarAuditoria(req, 'admin.empresa_status', 'empresa', id, { status });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/admin/usuarios/:id/senha', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID invalido.' });

    const { senha } = req.body;
    if (!senha || senha.length < 8) {
      return res.status(400).json({ erro: 'A senha temporaria deve ter pelo menos 8 caracteres.' });
    }

    const senha_hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
      'UPDATE usuarios SET senha_hash=$1, precisa_trocar_senha=TRUE WHERE id=$2 RETURNING id, nome, email, papel, empresa_id',
      [senha_hash, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    await registrarAuditoria(req, 'admin.usuario_reset_senha', 'usuario', id);
    res.json({ mensagem: 'Senha atualizada.', usuario: rows[0] });
  } catch (err) {
    erroInterno(res, err);
  }
});

app.get('/api/admin/auditoria', authMiddleware, exigirSuperAdmin, async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 100, 300);
    const { rows } = await pool.query(`
      SELECT a.*, u.email AS usuario_email, e.nome AS empresa_nome
      FROM auditoria a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN empresas e ON e.id = a.empresa_id
      ORDER BY a.criado_em DESC
      LIMIT $1
    `, [limite]);
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.get('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 200, 500);
    const { rows } = await pool.query(
      'SELECT * FROM contatos WHERE empresa_id=$1 ORDER BY criado_em DESC LIMIT $2',
      [empresaId(req), limite]
    );
    res.json(rows.map(row => descriptografarLinha(row, ['telefone'])));
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const { nome, telefone, segmento } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    const { rows } = await pool.query(
      'INSERT INTO contatos (empresa_id, nome, telefone, telefone_hash, segmento) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [empresaId(req), nome.trim(), criptografarTexto(telefone?.trim()), hashDado(telefone), segmento?.trim()]
    );
    await registrarAuditoria(req, 'contato.criado', 'contato', rows[0].id);
    res.status(201).json(descriptografarLinha(rows[0], ['telefone']));
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Conversas ─────────────────────────────────────────────
app.get('/api/conversas', authMiddleware, async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 100, 300);
    const { rows } = await pool.query(`
      SELECT c.*, ct.nome as contato_nome, ct.telefone as contato_telefone
      FROM conversas c
      LEFT JOIN contatos ct ON c.contato_id = ct.id AND ct.empresa_id = c.empresa_id
      WHERE c.empresa_id=$1
      ORDER BY c.atualizado_em DESC
      LIMIT $2
    `, [empresaId(req), limite]);
    res.json(rows.map(row => descriptografarLinha(row, ['contato_telefone'])));
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/conversas', authMiddleware, async (req, res) => {
  try {
    const { contato_id, canal } = req.body;
    if (!contato_id) return res.status(400).json({ erro: 'contato_id é obrigatório.' });
    const contato = await pool.query(
      'SELECT id FROM contatos WHERE id=$1 AND empresa_id=$2',
      [contato_id, empresaId(req)]
    );
    if (!contato.rows.length) return res.status(404).json({ erro: 'Contato nao encontrado.' });

    const { rows } = await pool.query(
      'INSERT INTO conversas (empresa_id, contato_id, canal) VALUES ($1, $2, $3) RETURNING *',
      [empresaId(req), contato_id, canal || 'whatsapp']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/conversas/:id/status', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const { status } = req.body;
    const statusValidos = ['aberta', 'em-atendimento', 'aguardando', 'finalizada'];
    if (!statusValidos.includes(status))
      return res.status(400).json({ erro: 'Status inválido.' });

    const { rows } = await pool.query(
      'UPDATE conversas SET status=$1, atualizado_em=NOW() WHERE id=$2 AND empresa_id=$3 RETURNING *',
      [status, id, empresaId(req)]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Conversa não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Mensagens ─────────────────────────────────────────────
app.get('/api/conversas/:id/mensagens', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const limite = Math.min(parseInt(req.query.limite) || 200, 500);
    const { rows } = await pool.query(
      'SELECT * FROM mensagens WHERE conversa_id=$1 AND empresa_id=$2 ORDER BY criado_em ASC LIMIT $3',
      [id, empresaId(req), limite]
    );
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/conversas/:id/mensagens', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const { tipo, conteudo } = req.body;
    if (!conteudo?.trim()) return res.status(400).json({ erro: 'Conteúdo é obrigatório.' });
    if (conteudo.length > 5000) return res.status(400).json({ erro: 'Mensagem muito longa.' });

    const tiposValidos = ['received', 'sent'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'received';

    const conversa = await pool.query(
      'SELECT id FROM conversas WHERE id=$1 AND empresa_id=$2',
      [id, empresaId(req)]
    );
    if (!conversa.rows.length) return res.status(404).json({ erro: 'Conversa nao encontrada.' });

    const { rows } = await pool.query(
      'INSERT INTO mensagens (empresa_id, conversa_id, tipo, conteudo) VALUES ($1, $2, $3, $4) RETURNING *',
      [empresaId(req), id, tipoFinal, criptografarTexto(conteudo.trim())]
    );
    await pool.query('UPDATE conversas SET atualizado_em=NOW() WHERE id=$1 AND empresa_id=$2', [id, empresaId(req)]);
    res.status(201).json(descriptografarLinha(rows[0], ['conteudo']));
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Respostas rápidas ─────────────────────────────────────
app.get('/api/respostas', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM respostas_rapidas WHERE empresa_id=$1 ORDER BY criado_em DESC',
      [empresaId(req)]
    );
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/respostas', authMiddleware, exigirPermissao('respostas.gerenciar'), async (req, res) => {
  try {
    const { titulo, categoria, mensagem } = req.body;
    if (!titulo || !mensagem) return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
    const { rows } = await pool.query(
      'INSERT INTO respostas_rapidas (empresa_id, titulo, categoria, mensagem) VALUES ($1, $2, $3, $4) RETURNING *',
      [empresaId(req), titulo.trim(), categoria?.trim(), mensagem.trim()]
    );
    await registrarAuditoria(req, 'resposta.criada', 'resposta', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.delete('/api/respostas/:id', authMiddleware, exigirPermissao('respostas.gerenciar'), async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const result = await pool.query('DELETE FROM respostas_rapidas WHERE id=$1 AND empresa_id=$2', [id, empresaId(req)]);
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Resposta não encontrada.' });
    await registrarAuditoria(req, 'resposta.removida', 'resposta', id);
    res.json({ mensagem: 'Resposta removida.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Empresa: configuração ─────────────────────────────────
app.get('/api/empresa/config', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT chave, valor FROM empresa_config WHERE empresa_id=$1',
      [empresaId(req)]
    );
    const config = {};
    rows.forEach(r => { config[r.chave] = r.valor; });
    res.json(config);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/empresa/config', authMiddleware, exigirPermissao('empresa.configurar'), async (req, res) => {
  try {
    const permitidas = [
      'nome_empresa','segmento','whatsapp','email',
      'msg_saudacao','msg_fora_horario','msg_sem_resposta',
      'horario_seg_sex','horario_sabado','horario_domingo',
      'auto_saudacao','auto_fora_horario','auto_escalar',
      'formas_pagamento','taxa_entrega','tempo_entrega',
      'whatsapp_phone_id',
    ];
    const entries = Object.entries(req.body).filter(([k]) => permitidas.includes(k));
    if (!entries.length) return res.status(400).json({ erro: 'Nenhum campo válido enviado.' });

    for (const [chave, valor] of entries) {
      await pool.query(`
        INSERT INTO empresa_config (empresa_id, chave, valor, atualizado_em)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (empresa_id, chave) DO UPDATE SET valor=$3, atualizado_em=NOW()
      `, [empresaId(req), chave, String(valor).slice(0, 1000)]);
    }
    if (req.body.nome_empresa) {
      await pool.query(
        'UPDATE empresas SET nome=$1 WHERE id=$2',
        [String(req.body.nome_empresa).trim().slice(0, 200), empresaId(req)]
      );
    }
    await registrarAuditoria(req, 'empresa.config_atualizada', 'empresa', empresaId(req), { campos: entries.map(([chave]) => chave) });
    res.json({ mensagem: 'Configurações salvas.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Upload de fotos ───────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer usa memória — sharp processa e salva em disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato invalido. Use JPG ou PNG.'), ok);
  },
});

function detectarImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  return null;
}

app.post('/api/upload/foto', authMiddleware, exigirPermissao('produtos.gerenciar'), upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
  try {
    const imagem = detectarImagem(req.file.buffer);
    if (!imagem || imagem.mime !== req.file.mimetype) {
      return res.status(400).json({ erro: 'Arquivo de imagem invalido.' });
    }

    // Garante que o diretório existe (pode ter sido apagado)
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });

    const nome    = crypto.randomBytes(12).toString('hex') + '.jpg';
    const destino = path.join(UPLOADS_DIR, nome);

    const foto = await Jimp.read(req.file.buffer);
    foto.scaleToFit(1600, 1600).quality(82);
    await foto.writeAsync(destino);
    await registrarAuditoria(req, 'upload.foto', 'arquivo', nome, { mimetype: req.file.mimetype, bytes: req.file.size });
    res.json({ url: `/uploads/${nome}` });
  } catch (err) {
    console.error('[upload/foto]', err);
    res.status(500).json({ erro: 'Erro ao salvar imagem.' });
  }
});

// ── Produtos ──────────────────────────────────────────────
app.get('/api/produtos', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM produtos WHERE empresa_id=$1 ORDER BY categoria, nome',
      [empresaId(req)]
    );
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/produtos', authMiddleware, exigirPermissao('produtos.gerenciar'), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, foto_url } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    const precoNum = preco ? parseFloat(preco) : null;
    if (preco && isNaN(precoNum)) return res.status(400).json({ erro: 'Preço inválido.' });
    const fotoFinal = foto_url?.startsWith('/uploads/') ? foto_url : null;
    const { rows } = await pool.query(
      'INSERT INTO produtos (empresa_id, nome, descricao, preco, categoria, foto_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [empresaId(req), nome.trim().slice(0, 200), descricao?.trim().slice(0, 500), precoNum, categoria?.trim().slice(0, 100), fotoFinal]
    );
    await registrarAuditoria(req, 'produto.criado', 'produto', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/produtos/:id', authMiddleware, exigirPermissao('produtos.gerenciar'), async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const { nome, descricao, preco, categoria } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    const precoNum = preco ? parseFloat(preco) : null;
    if (preco && isNaN(precoNum)) return res.status(400).json({ erro: 'Preço inválido.' });
    const { rows } = await pool.query(
      'UPDATE produtos SET nome=$1, descricao=$2, preco=$3, categoria=$4 WHERE id=$5 AND empresa_id=$6 RETURNING *',
      [nome.trim().slice(0, 200), descricao?.trim().slice(0, 500), precoNum, categoria?.trim().slice(0, 100), id, empresaId(req)]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    await registrarAuditoria(req, 'produto.atualizado', 'produto', id);
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/produtos/:id/foto', authMiddleware, exigirPermissao('produtos.gerenciar'), async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const { foto_url } = req.body;
    const fotoFinal = foto_url?.startsWith('/uploads/') ? foto_url : null;
    const { rows } = await pool.query(
      'UPDATE produtos SET foto_url=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *',
      [fotoFinal, id, empresaId(req)]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    await registrarAuditoria(req, 'produto.foto_atualizada', 'produto', id);
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/produtos/:id/disponivel', authMiddleware, exigirPermissao('produtos.gerenciar'), async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const { disponivel } = req.body;
    const { rows } = await pool.query(
      'UPDATE produtos SET disponivel=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *',
      [!!disponivel, id, empresaId(req)]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    await registrarAuditoria(req, 'produto.disponibilidade', 'produto', id, { disponivel: !!disponivel });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.delete('/api/produtos/:id', authMiddleware, exigirPermissao('produtos.gerenciar'), async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const result = await pool.query('DELETE FROM produtos WHERE id=$1 AND empresa_id=$2', [id, empresaId(req)]);
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
    await registrarAuditoria(req, 'produto.removido', 'produto', id);
    res.json({ mensagem: 'Produto removido.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Agente IA ─────────────────────────────────────────────
const agente = require('./agente');

app.post('/api/agente/responder', authMiddleware, async (req, res) => {
  try {
    const { conversa_id, mensagem } = req.body;
    if (!mensagem?.trim()) return res.status(400).json({ erro: 'Mensagem é obrigatória.' });
    if (mensagem.length > 2000) return res.status(400).json({ erro: 'Mensagem muito longa.' });

    const id = validarId(conversa_id);
    if (!id) return res.status(400).json({ erro: 'conversa_id inválido.' });

    // Buscar histórico da conversa (últimas 20 mensagens)
    const conversa = await pool.query(
      'SELECT id FROM conversas WHERE id=$1 AND empresa_id=$2',
      [id, empresaId(req)]
    );
    if (!conversa.rows.length) return res.status(404).json({ erro: 'Conversa nao encontrada.' });

    const { rows: historico } = await pool.query(
      'SELECT tipo, conteudo FROM mensagens WHERE conversa_id=$1 AND empresa_id=$2 ORDER BY criado_em DESC LIMIT 20',
      [id, empresaId(req)]
    );

    // Buscar config da empresa
    const { rows: configRows } = await pool.query(
      'SELECT chave, valor FROM empresa_config WHERE empresa_id=$1',
      [empresaId(req)]
    );
    const config = {};
    configRows.forEach(r => { config[r.chave] = r.valor; });

    // Buscar produtos disponíveis
    const { rows: produtos } = await pool.query(
      'SELECT nome, descricao, preco, categoria FROM produtos WHERE empresa_id=$1 AND disponivel=TRUE ORDER BY categoria, nome',
      [empresaId(req)]
    );

    const resposta = await agente.responder({
      mensagem: mensagem.trim(),
      historico: historico.map(row => descriptografarLinha(row, ['conteudo'])).reverse(),
      config,
      produtos,
    });

    res.json(resposta);
  } catch (err) {
    console.error('[agente/responder]', err?.message || err);
    res.status(500).json({ erro: 'Erro no agente: ' + (err?.message || 'desconhecido') });
  }
});

app.post('/api/agente/testar', authMiddleware, async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem?.trim()) return res.status(400).json({ erro: 'Mensagem é obrigatória.' });

    const { rows: configRows } = await pool.query(
      'SELECT chave, valor FROM empresa_config WHERE empresa_id=$1',
      [empresaId(req)]
    );
    const config = {};
    configRows.forEach(r => { config[r.chave] = r.valor; });

    const { rows: produtos } = await pool.query(
      'SELECT nome, descricao, preco, categoria FROM produtos WHERE empresa_id=$1 AND disponivel=TRUE ORDER BY categoria, nome',
      [empresaId(req)]
    );

    const resposta = await agente.responder({
      mensagem: mensagem.trim(),
      historico: [],
      config,
      produtos,
    });

    res.json(resposta);
  } catch (err) {
    console.error('[agente/testar]', err?.message || err);
    res.status(500).json({ erro: 'Erro no agente: ' + (err?.message || 'desconhecido') });
  }
});

// ── WhatsApp ──────────────────────────────────────────────
const WA_TOKEN        = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID     = process.env.WHATSAPP_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Verificação do webhook (Meta chama ao cadastrar o URL)
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('[whatsapp] Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Receber mensagens do WhatsApp
app.post('/api/whatsapp/webhook', async (req, res) => {
  res.sendStatus(200); // responde imediatamente para a Meta não reenviar

  try {
    if (!validarAssinaturaMeta(req)) {
      console.warn('[whatsapp/webhook] Assinatura invalida ou WHATSAPP_APP_SECRET ausente.');
      return;
    }

    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.[0]) return; // pode ser atualização de status

    const msg      = value.messages[0];
    const telefone = msg.from;                                   // ex: 5511999998888
    const nome     = value.contacts?.[0]?.profile?.name || 'Cliente';
    const phoneNumberId = value.metadata?.phone_number_id;

    // Por enquanto processa apenas mensagens de texto
    if (msg.type !== 'text') {
      await enviarWhatsApp(telefone, 'Desculpe, ainda não consigo processar ' +
        (msg.type === 'image' ? 'imagens' : 'esse tipo de mensagem') + '. Como posso ajudar?', phoneNumberId);
      return;
    }

    const texto = msg.text.body.trim();
    if (!texto) return;

    console.log(`[whatsapp] ${nome} (${telefone}): ${texto.substring(0, 60)}`);
    await processarMensagemWA({ telefone, nome, texto, phoneNumberId });

  } catch (err) {
    console.error('[whatsapp/webhook]', err.message);
  }
});

// ── Lógica central: DB + IA (usada por Meta e Twilio) ────
async function empresaPadraoId() {
  const { rows } = await pool.query("SELECT id FROM empresas WHERE slug='taatendido-demo' LIMIT 1");
  return rows[0]?.id;
}

async function resolverEmpresaWebhook({ phoneNumberId } = {}) {
  if (process.env.TENANT_EMPRESA_ID) {
    const id = validarId(process.env.TENANT_EMPRESA_ID);
    if (id) return id;
  }

  if (phoneNumberId) {
    const { rows } = await pool.query(`
      SELECT empresa_id
      FROM empresa_config
      WHERE chave='whatsapp_phone_id' AND valor=$1
      LIMIT 1
    `, [String(phoneNumberId)]);
    if (rows.length) return rows[0].empresa_id;
  }

  if (process.env.NODE_ENV !== 'production') return empresaPadraoId();
  return null;
}

async function processarMensagem({ empresa_id, telefone, nome, texto, canal }) {
  if (!empresa_id) throw new Error('Empresa nao identificada para o atendimento.');
  // 1. Buscar ou criar contato
  let { rows: [contato] } = await pool.query(
    'SELECT id FROM contatos WHERE empresa_id=$1 AND (telefone_hash=$2 OR telefone=$3) LIMIT 1',
    [empresa_id, hashDado(telefone), telefone]
  );
  if (!contato) {
    const ins = await pool.query(
      'INSERT INTO contatos (empresa_id, nome, telefone, telefone_hash) VALUES ($1,$2,$3,$4) RETURNING id',
      [empresa_id, nome, criptografarTexto(telefone), hashDado(telefone)]
    );
    contato = ins.rows[0];
  }

  // 2. Buscar ou criar conversa aberta no canal
  let { rows: [conversa] } = await pool.query(
    `SELECT id FROM conversas
     WHERE empresa_id=$1 AND contato_id=$2 AND status='aberta' AND canal=$3
     ORDER BY criado_em DESC LIMIT 1`,
    [empresa_id, contato.id, canal]
  );
  if (!conversa) {
    const ins = await pool.query(
      `INSERT INTO conversas (empresa_id, contato_id, status, canal) VALUES ($1,$2,'aberta',$3) RETURNING id`,
      [empresa_id, contato.id, canal]
    );
    conversa = ins.rows[0];
  }

  // 3. Salvar mensagem recebida
  await pool.query(
    'INSERT INTO mensagens (empresa_id, conversa_id, tipo, conteudo) VALUES ($1,$2,$3,$4)',
    [empresa_id, conversa.id, 'received', criptografarTexto(texto)]
  );

  // 4. Buscar histórico
  const { rows: historico } = await pool.query(
    'SELECT tipo, conteudo FROM mensagens WHERE empresa_id=$1 AND conversa_id=$2 ORDER BY criado_em ASC',
    [empresa_id, conversa.id]
  );
  const historicoClaro = historico.map(row => descriptografarLinha(row, ['conteudo']));

  // 5. Buscar config e produtos
  const { rows: configRows } = await pool.query(
    'SELECT chave, valor FROM empresa_config WHERE empresa_id=$1',
    [empresa_id]
  );
  const config = {};
  configRows.forEach(r => { config[r.chave] = r.valor; });

  const { rows: produtos } = await pool.query(
    'SELECT nome, descricao, preco, categoria FROM produtos WHERE empresa_id=$1 AND disponivel=TRUE ORDER BY categoria, nome',
    [empresa_id]
  );

  // 6. Chamar IA
  const resposta = await agente.responder({ mensagem: texto, historico: historicoClaro, config, produtos });

  // 7. Salvar resposta
  await pool.query(
    'INSERT INTO mensagens (empresa_id, conversa_id, tipo, conteudo) VALUES ($1,$2,$3,$4)',
    [empresa_id, conversa.id, 'sent', criptografarTexto(resposta.texto)]
  );

  // 8. Atualizar status da conversa
  if (resposta.escalar) {
    await pool.query(
      `UPDATE conversas SET status='escalada', atualizado_em=NOW() WHERE id=$1 AND empresa_id=$2`, [conversa.id, empresa_id]
    );
  } else {
    await pool.query('UPDATE conversas SET atualizado_em=NOW() WHERE id=$1 AND empresa_id=$2', [conversa.id, empresa_id]);
  }

  return resposta;
}

async function processarMensagemWA({ telefone, nome, texto, phoneNumberId }) {
  const empresa_id = await resolverEmpresaWebhook({ phoneNumberId });
  const resposta = await processarMensagem({ empresa_id, telefone, nome, texto, canal: 'whatsapp' });

  // 8. Enviar resposta ao cliente
  await enviarWhatsApp(telefone, resposta.texto, phoneNumberId);

  if (resposta.escalar) console.log('[whatsapp] Conversa escalada para humano.');
}

async function enviarWhatsApp(telefone, texto, phoneNumberId = WA_PHONE_ID) {
  if (!WA_TOKEN || !phoneNumberId) {
    console.warn('[whatsapp] WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurados.');
    return;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: telefone,
          type: 'text',
          text: { body: texto },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[whatsapp] Erro ao enviar:', JSON.stringify(err));
    }
  } catch (err) {
    console.error('[whatsapp] Falha na requisição:', err.message);
  }
}

// ── Twilio WhatsApp Sandbox ───────────────────────────────
app.post('/api/twilio/webhook', express.urlencoded({ extended: false, verify: capturarRawBody }), async (req, res) => {
  const xmlVazio = '<Response></Response>';

  try {
    if (!validarAssinaturaTwilio(req)) {
      console.warn('[twilio] Assinatura invalida ou TWILIO_AUTH_TOKEN ausente.');
      res.set('Content-Type', 'text/xml');
      return res.send(xmlVazio);
    }

    // Twilio envia From no formato "whatsapp:+5582991734542"
    const from  = (req.body.From  || '').replace('whatsapp:', '').replace('+', '');
    const texto = (req.body.Body  || '').trim();
    const nome  = req.body.ProfileName || 'Cliente';

    if (!from || !texto) {
      res.set('Content-Type', 'text/xml');
      return res.send(xmlVazio);
    }

    console.log(`[twilio] ${nome} (${from}): ${texto.substring(0, 60)}`);

    const empresa_id = await resolverEmpresaWebhook();
    const resposta = await processarMensagem({ empresa_id, telefone: from, nome, texto, canal: 'twilio' });

    // Escapa caracteres XML na resposta da IA
    const textoXml = resposta.texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${textoXml}</Message></Response>`);

  } catch (err) {
    console.error('[twilio]', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Desculpe, tive um problema. Tente novamente.</Message></Response>`);
  }
});

// ── Rota não encontrada ───────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ── Iniciar servidor ──────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`TáAtendido API rodando na porta ${PORT}`);
  if (process.env.DATABASE_URL) {
    try {
      await initDB();
      await aplicarRetencaoDados();
      setInterval(aplicarRetencaoDados, 24 * 60 * 60 * 1000);
    } catch (err) {
      console.error('Erro ao inicializar banco:', err.message);
    }
  } else {
    console.warn('DATABASE_URL não definida. Banco de dados não conectado.');
  }
});
