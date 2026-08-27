import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();

const diretorioDados = path.join(process.cwd(), 'data');
const arquivoAdmin = path.join(diretorioDados, 'admin.json');
const arquivoProdutos = path.join(diretorioDados, 'catalogo-produtos.json');
const diretorioUploads = path.join(process.cwd(), 'uploads');

async function lerJson(caminho, padrao) {
  try {
    return JSON.parse(await fs.readFile(caminho, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return padrao;
    throw error;
  }
}

async function salvarJson(caminho, dados) {
  await fs.mkdir(diretorioDados, { recursive: true });
  await fs.writeFile(caminho, JSON.stringify(dados, null, 2), 'utf8');
}

async function salvarImagem(base64) {
  const partes = String(base64).match(/^data:image\/(jpeg|jpg);base64,(.+)$/i);
  if (!partes) throw new Error('Envie uma imagem JPG ou JPEG válida.');
  const imagem = Buffer.from(partes[2], 'base64');
  if (!imagem.length || imagem.length > 12 * 1024 * 1024) throw new Error('A imagem deve ter até 12 MB.');
  await fs.mkdir(diretorioUploads, { recursive: true });
  const nome = `capacete-${crypto.randomUUID()}.jpg`;
  await fs.writeFile(path.join(diretorioUploads, nome), imagem);
  return `uploads/${nome}`;
}

function criarHashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, salt, 64, (erro, chave) => {
      if (erro) reject(erro);
      else resolve({ salt, hash: chave.toString('hex') });
    });
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(item => {
    const [nome, ...valor] = item.trim().split('=');
    return [nome, decodeURIComponent(valor.join('='))];
  }));
}

function assinarSessao(hash) {
  const dados = Buffer.from(JSON.stringify({ admin: true, exp: Date.now() + 1000 * 60 * 60 * 8 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', hash).update(dados).digest('base64url');
  return `${dados}.${assinatura}`;
}

function sessaoValida(token, hash) {
  if (!token) return false;
  const [dados, assinatura] = token.split('.');
  if (!dados || !assinatura) return false;
  const esperada = crypto.createHmac('sha256', hash).update(dados).digest('base64url');
  if (assinatura.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return false;
  try { return JSON.parse(Buffer.from(dados, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

async function exigirAdmin(req, res, next) {
  const admin = await lerJson(arquivoAdmin, null);
  if (!admin || !sessaoValida(cookies(req).jc_admin, admin.hash)) {
    return res.status(401).json({ error: 'Acesso de administrador necessário.' });
  }
  next();
}

// Aceita acesso local e um futuro endereço público, sem depender de serviços externos.
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/data', (req, res) => res.sendStatus(404));
app.use(express.static(process.cwd()));

app.get('/admin', (req, res) => res.sendFile(path.join(process.cwd(), 'painel.html')));

// AUTENTICAÇÃO DO PAINEL: a senha é criada pelo dono no primeiro acesso.
app.get('/api/admin/session', async (req, res) => {
  const admin = await lerJson(arquivoAdmin, null);
  res.json({ configurado: Boolean(admin), autenticado: Boolean(admin && sessaoValida(cookies(req).jc_admin, admin.hash)) });
});

app.post('/api/admin/setup', async (req, res) => {
  const { senha } = req.body;
  const existente = await lerJson(arquivoAdmin, null);
  if (existente) return res.status(409).json({ error: 'O acesso de administrador já foi configurado.' });
  if (typeof senha !== 'string' || senha.length < 4) return res.status(400).json({ error: 'Use uma senha com pelo menos 4 caracteres.' });
  const admin = await criarHashSenha(senha);
  await salvarJson(arquivoAdmin, admin);
  res.cookie('jc_admin', assinarSessao(admin.hash), { httpOnly: true, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 8 });
  res.status(201).json({ message: 'Acesso de administrador configurado.' });
});

app.post('/api/admin/login', async (req, res) => {
  const { senha } = req.body;
  const admin = await lerJson(arquivoAdmin, null);
  if (!admin) return res.status(400).json({ error: 'Configure o primeiro acesso antes de entrar.' });
  const tentativa = await criarHashSenha(senha || '', admin.salt);
  if (!crypto.timingSafeEqual(Buffer.from(tentativa.hash), Buffer.from(admin.hash))) return res.status(401).json({ error: 'Senha incorreta.' });
  res.cookie('jc_admin', assinarSessao(admin.hash), { httpOnly: true, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 8 });
  res.json({ message: 'Login efetuado.' });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('jc_admin');
  res.json({ message: 'Sessão encerrada.' });
});

// CATÁLOGO LOCAL: imagens ficam em /uploads e os dados em /data (não público).
app.get('/api/capacetes', async (req, res) => {
  res.json(await lerJson(arquivoProdutos, []));
});

app.post('/api/capacetes', exigirAdmin, async (req, res) => {
  try {
    const { marca, modelo, tamanho, preco, descricao, url_imagem } = req.body;
    if (![marca, modelo, tamanho, preco, url_imagem].every(valor => String(valor || '').trim())) return res.status(400).json({ error: 'Preencha marca, modelo, tamanho, preço e imagem.' });
    const produto = { id: crypto.randomUUID(), marca: String(marca).trim(), modelo: String(modelo).trim(), tamanho: String(tamanho).trim(), preco: Number(preco), descricao: String(descricao || '').trim(), url_imagem: await salvarImagem(url_imagem), criado_em: new Date().toISOString() };
    if (!Number.isFinite(produto.preco) || produto.preco < 0) return res.status(400).json({ error: 'Informe um preço válido.' });
    const produtos = await lerJson(arquivoProdutos, []);
    produtos.unshift(produto);
    await salvarJson(arquivoProdutos, produtos);
    res.status(201).json(produto);
  } catch (error) { res.status(400).json({ error: error.message || 'Não foi possível salvar o produto.' }); }
});

app.put('/api/capacetes/:id', exigirAdmin, async (req, res) => {
  try {
    const produtos = await lerJson(arquivoProdutos, []);
    const indice = produtos.findIndex(produto => produto.id === req.params.id);
    if (indice < 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    const atual = produtos[indice];
    const { marca, modelo, tamanho, preco, descricao, url_imagem } = req.body;
    if (url_imagem) atual.url_imagem = await salvarImagem(url_imagem);
    Object.assign(atual, { marca: String(marca).trim(), modelo: String(modelo).trim(), tamanho: String(tamanho).trim(), preco: Number(preco), descricao: String(descricao || '').trim() });
    if (!Number.isFinite(atual.preco) || atual.preco < 0) return res.status(400).json({ error: 'Informe um preço válido.' });
    await salvarJson(arquivoProdutos, produtos);
    res.json(atual);
  } catch (error) { res.status(400).json({ error: error.message || 'Não foi possível atualizar o produto.' }); }
});

app.delete('/api/capacetes/:id', exigirAdmin, async (req, res) => {
  const produtos = await lerJson(arquivoProdutos, []);
  const produto = produtos.find(item => item.id === req.params.id);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado.' });
  await salvarJson(arquivoProdutos, produtos.filter(item => item.id !== req.params.id));
  if (produto.url_imagem.startsWith('uploads/')) await fs.unlink(path.join(process.cwd(), produto.url_imagem)).catch(() => {});
  res.json({ message: 'Excluído!' });
});

app.listen(3000, () => console.log('Servidor ativo na porta 3000! 🚀'));
