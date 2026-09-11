import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(process.cwd()));

// Inicializa o cliente do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para salvar e comprimir a imagem em Base64 no Storage
async function salvarImagemSupabase(base64) {
  const partes = String(base64).match(/^data:image\/(jpeg|png|jpg|webp);base64,(.+)$/i);
  if (!partes) throw new Error('Envie uma imagem JPG, JPEG, PNG ou WEBP válida.');

  const base64Dados = partes[2];
  const bufferOriginal = Buffer.from(base64Dados, 'base64');

  const bufferComprimido = await sharp(bufferOriginal)
    .resize({ width: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const nomeArquivo = `capacete-${crypto.randomUUID()}.webp`;

  const { data, error } = await supabase.storage
    .from('imagens-catalago')
    .upload(nomeArquivo, bufferComprimido, {
      contentType: 'image/webp',
      upsert: false
    });

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from('imagens-catalago')
    .getPublicUrl(nomeArquivo);

  return publicUrlData.publicUrl;
}

// Atalho /admin para o painel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'painel.html'));
});

// Rota de busca de produtos (com suporte a paginação E busca completa)
app.get('/api/produtos', async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

    // Se houver paginação explícita
    if (page && limit) {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { data, error, count } = await supabase
        .from('produtos')
        .select('*', { count: 'exact' })
        .order('lancamento', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return res.json({
        produtos: data || [],
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });
    }

    // Se houver apenas limite
    if (limit) {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .order('lancamento', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return res.json(data || []);
    }

    // Busca padrão: Retorna TODOS os produtos sem limitação
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    res.json(data || []);

  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar o catálogo.' });
  }
});

// Cadastrar novo produto
app.post('/api/produtos', async (req, res) => {
  try {
    const { nome, preco, imagem, lancamento } = req.body;
    if (!nome || !preco || !imagem) {
      return res.status(400).json({ error: 'Preencha todos os campos.' });
    }

    const fotoPublicUrl = await salvarImagemSupabase(imagem);

    const { error } = await supabase
      .from('produtos')
      .insert([{ 
        nome, 
        preco, 
        imagem_url: fotoPublicUrl,
        lancamento: lancamento === true || lancamento === 'true'
      }]);

    if (error) throw error;
    res.status(201).json({ message: 'Produto cadastrado com sucesso!' });
  } catch (error) {
    console.error('Erro ao cadastrar produto:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deletar produto por ID
app.delete('/api/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('produtos')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro retornado do Supabase na deleção:', error);
      return res.status(400).json({ error: error.message || 'Erro ao excluir o produto.' });
    }

    res.json({ message: 'Produto excluído com sucesso!', data });
  } catch (error) {
    console.error('Erro no servidor ao tentar deletar:', error);
    res.status(500).json({ error: 'Erro de comunicação no servidor ao excluir.' });
  }
});

// Configurações
app.get('/api/configuracoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('*');

    if (error) {
      console.error('Erro Supabase configuracoes:', error);
      return res.json([]);
    }
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.json([]);
  }
});

// Atualizar carrossel
app.post('/api/configuracoes/carrossel', async (req, res) => {
  try {
    const { velocidade } = req.body;
    if (!velocidade) {
      return res.status(400).json({ error: 'Informe a velocidade.' });
    }

    const { error } = await supabase
      .from('configuracoes')
      .upsert(
        { chave: 'velocidade_carrossel', valor: String(velocidade) },
        { onConflict: 'chave' }
      );

    if (error) {
      console.error('Erro ao salvar no Supabase:', error);
      throw error;
    }

    res.json({ message: 'Velocidade do carrossel atualizada com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar velocidade:', error);
    res.status(500).json({ error: error.message || 'Erro ao salvar configuração.' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  try {
    const { senha } = req.body;

    if (!senha) {
      return res.status(400).json({ error: 'Por favor, digite a senha.' });
    }

    if (senha !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Senha incorreta. Tente novamente.' });
    }

    res.json({ message: 'Acesso liberado!', autorizado: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
