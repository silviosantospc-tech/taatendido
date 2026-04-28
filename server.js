const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ── Health check ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'TáAtendido API', timestamp: new Date().toISOString() });
});

// ── Inicializar tabelas ───────────────────────────────────
async function initDB() {
  await pool.query(`
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

// ── Contatos ──────────────────────────────────────────────
app.get('/api/contatos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contatos ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/contatos', async (req, res) => {
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
app.get('/api/conversas', async (req, res) => {
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

app.post('/api/conversas', async (req, res) => {
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

app.patch('/api/conversas/:id/status', async (req, res) => {
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
app.get('/api/conversas/:id/mensagens', async (req, res) => {
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

app.post('/api/conversas/:id/mensagens', async (req, res) => {
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
app.get('/api/respostas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM respostas_rapidas ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/respostas', async (req, res) => {
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

app.delete('/api/respostas/:id', async (req, res) => {
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
