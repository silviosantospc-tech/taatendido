const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'taatendido_secret_2025';

app.use(cors());
app.use(express.json());

// Raiz → landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Servir o frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// Conexão com banco de dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

// ── Health check ─────────────────────────────────────────
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
  `);
  console.log('Banco de dados inicializado com sucesso.');
}

// ── Auth: Registro ────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos.' });
    const existe = await pool.query('SELECT id FROM usuarios WHERE email=$1', [email]);
    if (existe.rows.length) return res.status(409).json({ erro: 'Email já cadastrado.' });
    const senha_hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id, nome, email, papel',
      [nome, email, senha_hash]
    );
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email, papel: rows[0].papel }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, usuario: rows[0] });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Auth: Login ───────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Preencha email e senha.' });
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    const valido = await bcrypt.compare(senha, rows[0].senha_hash);
    if (!valido) return res.status(401).json({ erro: 'Email ou senha incorretos.' });
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email, papel: rows[0].papel }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, usuario: { id: rows[0].id, nome: rows[0].nome, email: rows[0].email, papel: rows[0].papel } });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Auth: Verificar token ─────────────────────────────────
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, email, papel FROM usuarios WHERE id=$1', [req.usuario.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Contatos ──────────────────────────────────────────────
app.get('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contatos ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/contatos', authMiddleware, async (req, res) => {
  try {
    const { nome, telefone, segmento } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO contatos (nome, telefone, segmento) VALUES ($1, $2, $3) RETURNING *',
      [nome, telefone, segmento]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Conversas ─────────────────────────────────────────────
app.get('/api/conversas', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, ct.nome as contato_nome, ct.telefone as contato_telefone
      FROM conversas c
      LEFT JOIN contatos ct ON c.contato_id = ct.id
      ORDER BY c.atualizado_em DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/conversas', authMiddleware, async (req, res) => {
  try {
    const { contato_id, canal } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO conversas (contato_id, canal) VALUES ($1, $2) RETURNING *',
      [contato_id, canal || 'whatsapp']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.patch('/api/conversas/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      'UPDATE conversas SET status=$1, atualizado_em=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Mensagens ─────────────────────────────────────────────
app.get('/api/conversas/:id/mensagens', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mensagens WHERE conversa_id=$1 ORDER BY criado_em ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/conversas/:id/mensagens', authMiddleware, async (req, res) => {
  try {
    const { tipo, conteudo } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO mensagens (conversa_id, tipo, conteudo) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, tipo || 'received', conteudo]
    );
    await pool.query('UPDATE conversas SET atualizado_em=NOW() WHERE id=$1', [req.params.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Respostas rápidas ─────────────────────────────────────
app.get('/api/respostas', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM respostas_rapidas ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/respostas', authMiddleware, async (req, res) => {
  try {
    const { titulo, categoria, mensagem } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO respostas_rapidas (titulo, categoria, mensagem) VALUES ($1, $2, $3) RETURNING *',
      [titulo, categoria, mensagem]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/respostas/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM respostas_rapidas WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Resposta removida.' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
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
