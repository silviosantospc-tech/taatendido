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

const app = express();
const PORT = process.env.PORT || 3000;

// ── JWT Secret obrigatório ────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERRO CRÍTICO: JWT_SECRET não definido. Defina a variável de ambiente antes de iniciar.');
  process.exit(1);
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
      scriptSrc:  ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc:    ["'self'", "fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "i.pravatar.cc"],
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
}));

app.use(express.json({ limit: '20kb' }));

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
  ssl: false,
});

// ── Middleware de autenticação ────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token não fornecido.' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
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
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      papel TEXT DEFAULT 'atendente',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      telefone TEXT,
      segmento TEXT,
      status TEXT DEFAULT 'ativo',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversas (
      id SERIAL PRIMARY KEY,
      contato_id INTEGER REFERENCES contatos(id),
      status TEXT DEFAULT 'aberta',
      canal TEXT DEFAULT 'whatsapp',
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mensagens (
      id SERIAL PRIMARY KEY,
      conversa_id INTEGER REFERENCES conversas(id),
      tipo TEXT DEFAULT 'received',
      conteudo TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS respostas_rapidas (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      categoria TEXT,
      mensagem TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS empresa_config (
      id SERIAL PRIMARY KEY,
      chave TEXT UNIQUE NOT NULL,
      valor TEXT,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco NUMERIC(10,2),
      categoria TEXT,
      foto_url TEXT,
      disponivel BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE produtos ADD COLUMN IF NOT EXISTS foto_url TEXT;
  `);
  console.log('Banco de dados inicializado com sucesso.');
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

// Hash dummy pré-gerado para evitar timing attack no login
// (mesmo custo que o hash real, sem revelar se o email existe)
const DUMMY_HASH = '$2b$12$KIXBc5P2nkxJ7nCc5S8Np.kULaXexPBiT5F5L5R3JwK6NxH1zGxSe';

// ── Auth: Registro ────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;

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

    const senha_hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id, nome, email, papel',
      [nome.trim(), email.toLowerCase(), senha_hash]
    );

    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email, papel: rows[0].papel },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, usuario: rows[0] });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Auth: Login ───────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha)
      return res.status(400).json({ erro: 'Preencha email e senha.' });

    if (!validarEmail(email))
      return res.status(400).json({ erro: 'Email inválido.' });

    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email.toLowerCase()]);

    // Mesmo tempo de resposta se o usuário não existir (evita user enumeration)
    const hash = rows.length ? rows[0].senha_hash : DUMMY_HASH;
    const valido = await bcrypt.compare(senha, hash);

    if (!rows.length || !valido)
      return res.status(401).json({ erro: 'Email ou senha incorretos.' });

    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email, papel: rows[0].papel },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, usuario: { id: rows[0].id, nome: rows[0].nome, email: rows[0].email, papel: rows[0].papel } });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Auth: Verificar token ─────────────────────────────────
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, email, papel FROM usuarios WHERE id=$1', [req.usuario.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Contatos ──────────────────────────────────────────────
app.get('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 200, 500);
    const { rows } = await pool.query('SELECT * FROM contatos ORDER BY criado_em DESC LIMIT $1', [limite]);
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const { nome, telefone, segmento } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    const { rows } = await pool.query(
      'INSERT INTO contatos (nome, telefone, segmento) VALUES ($1, $2, $3) RETURNING *',
      [nome.trim(), telefone?.trim(), segmento?.trim()]
    );
    res.status(201).json(rows[0]);
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
      LEFT JOIN contatos ct ON c.contato_id = ct.id
      ORDER BY c.atualizado_em DESC
      LIMIT $1
    `, [limite]);
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/conversas', authMiddleware, async (req, res) => {
  try {
    const { contato_id, canal } = req.body;
    if (!contato_id) return res.status(400).json({ erro: 'contato_id é obrigatório.' });
    const { rows } = await pool.query(
      'INSERT INTO conversas (contato_id, canal) VALUES ($1, $2) RETURNING *',
      [contato_id, canal || 'whatsapp']
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
      'UPDATE conversas SET status=$1, atualizado_em=NOW() WHERE id=$2 RETURNING *',
      [status, id]
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
      'SELECT * FROM mensagens WHERE conversa_id=$1 ORDER BY criado_em ASC LIMIT $2',
      [id, limite]
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

    const { rows } = await pool.query(
      'INSERT INTO mensagens (conversa_id, tipo, conteudo) VALUES ($1, $2, $3) RETURNING *',
      [id, tipoFinal, conteudo.trim()]
    );
    await pool.query('UPDATE conversas SET atualizado_em=NOW() WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Respostas rápidas ─────────────────────────────────────
app.get('/api/respostas', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM respostas_rapidas ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/respostas', authMiddleware, async (req, res) => {
  try {
    const { titulo, categoria, mensagem } = req.body;
    if (!titulo || !mensagem) return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
    const { rows } = await pool.query(
      'INSERT INTO respostas_rapidas (titulo, categoria, mensagem) VALUES ($1, $2, $3) RETURNING *',
      [titulo.trim(), categoria?.trim(), mensagem.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.delete('/api/respostas/:id', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const result = await pool.query('DELETE FROM respostas_rapidas WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Resposta não encontrada.' });
    res.json({ mensagem: 'Resposta removida.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Empresa: configuração ─────────────────────────────────
app.get('/api/empresa/config', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT chave, valor FROM empresa_config');
    const config = {};
    rows.forEach(r => { config[r.chave] = r.valor; });
    res.json(config);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/empresa/config', authMiddleware, async (req, res) => {
  try {
    const permitidas = [
      'nome_empresa','segmento','whatsapp','email',
      'msg_saudacao','msg_fora_horario','msg_sem_resposta',
      'horario_seg_sex','horario_sabado','horario_domingo',
      'auto_saudacao','auto_fora_horario','auto_escalar',
      'formas_pagamento','taxa_entrega','tempo_entrega',
    ];
    const entries = Object.entries(req.body).filter(([k]) => permitidas.includes(k));
    if (!entries.length) return res.status(400).json({ erro: 'Nenhum campo válido enviado.' });

    for (const [chave, valor] of entries) {
      await pool.query(`
        INSERT INTO empresa_config (chave, valor, atualizado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (chave) DO UPDATE SET valor=$2, atualizado_em=NOW()
      `, [chave, String(valor).slice(0, 1000)]);
    }
    res.json({ mensagem: 'Configurações salvas.' });
  } catch (err) {
    erroInterno(res, err);
  }
});

// ── Upload de fotos ───────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const nome = crypto.randomBytes(12).toString('hex') + ext;
      cb(null, nome);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato inválido. Use JPG, PNG ou WebP.'), ok);
  },
});

app.post('/api/upload/foto', authMiddleware, upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// ── Produtos ──────────────────────────────────────────────
app.get('/api/produtos', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY categoria, nome');
    res.json(rows);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.post('/api/produtos', authMiddleware, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, foto_url } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    const precoNum = preco ? parseFloat(preco) : null;
    if (preco && isNaN(precoNum)) return res.status(400).json({ erro: 'Preço inválido.' });
    const fotoFinal = foto_url?.startsWith('/uploads/') ? foto_url : null;
    const { rows } = await pool.query(
      'INSERT INTO produtos (nome, descricao, preco, categoria, foto_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nome.trim().slice(0, 200), descricao?.trim().slice(0, 500), precoNum, categoria?.trim().slice(0, 100), fotoFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/produtos/:id/foto', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const { foto_url } = req.body;
    const fotoFinal = foto_url?.startsWith('/uploads/') ? foto_url : null;
    const { rows } = await pool.query(
      'UPDATE produtos SET foto_url=$1 WHERE id=$2 RETURNING *',
      [fotoFinal, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.patch('/api/produtos/:id/disponivel', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const { disponivel } = req.body;
    const { rows } = await pool.query(
      'UPDATE produtos SET disponivel=$1 WHERE id=$2 RETURNING *',
      [!!disponivel, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    erroInterno(res, err);
  }
});

app.delete('/api/produtos/:id', authMiddleware, async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const result = await pool.query('DELETE FROM produtos WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
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
    const { rows: historico } = await pool.query(
      'SELECT tipo, conteudo FROM mensagens WHERE conversa_id=$1 ORDER BY criado_em DESC LIMIT 20',
      [id]
    );

    // Buscar config da empresa
    const { rows: configRows } = await pool.query('SELECT chave, valor FROM empresa_config');
    const config = {};
    configRows.forEach(r => { config[r.chave] = r.valor; });

    // Buscar produtos disponíveis
    const { rows: produtos } = await pool.query(
      'SELECT nome, descricao, preco, categoria FROM produtos WHERE disponivel=TRUE ORDER BY categoria, nome'
    );

    const resposta = await agente.responder({
      mensagem: mensagem.trim(),
      historico: historico.reverse(),
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

    const { rows: configRows } = await pool.query('SELECT chave, valor FROM empresa_config');
    const config = {};
    configRows.forEach(r => { config[r.chave] = r.valor; });

    const { rows: produtos } = await pool.query(
      'SELECT nome, descricao, preco, categoria FROM produtos WHERE disponivel=TRUE ORDER BY categoria, nome'
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
    } catch (err) {
      console.error('Erro ao inicializar banco:', err.message);
    }
  } else {
    console.warn('DATABASE_URL não definida. Banco de dados não conectado.');
  }
});
