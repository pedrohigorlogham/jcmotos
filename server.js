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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'painel.html'));
});

// Busca de produtos adaptada
app.get('/api/produtos', async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

    if (page && limit) {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { data, error, count } = await supabase
        .from('produtos')
        .select('*', { count: 'exact' })
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

    if (limit) {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .order('id', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return res.json(data || []);
    }

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

// Salvar produto (tenta com lancamento; se der erro de coluna, salva sem ele)
app.post('/api/produtos', async (req, res) => {
  try {
    const { nome, preco, imagem, lancamento } = req.body;
    if (!nome || !preco || !imagem) {
      return res.status(400).json({ error: 'Preencha todos os campos.' });
    }

    const fotoPublicUrl = await salvarImagemSupabase(imagem);

    // Tenta inserir com o campo lancamento
    const { error } = await supabase
      .from('produtos')
      .insert([{ 
        nome, 
        preco, 
        imagem_url: fotoPublicUrl,
        lancamento: lancamento === true || lancamento === 'true'
      }]);

    // Se o Supabase reclamar que a coluna nao existe, salva apenas os campos padrao
    if (error && error.message && error.message.includes('lancamento')) {
      const { error: errorFallback } = await supabase
        .from('produtos')
        .insert([{ 
          nome, 
          preco, 
          imagem_url: fotoPublicUrl 
        }]);

      if (errorFallback) throw errorFallback;
    } else if (error) {
      throw error;
    }

    res.status(201).json({ message: 'Produto cadastrado com sucesso!' });
  } catch (error) {
    console.error('Erro ao cadastrar produto:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('produtos')
      .delete()
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ message: 'Produto excluído com sucesso!', data });
  } catch (error) {
    console.error('Erro ao excluir:', error);
    res.status(500).json({ error: 'Erro de comunicação ao excluir.' });
  }
});

// Configuracoes seguras (retorna padrao se nao existir a tabela)
app.get('/api/configuracoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('*');

    if (error) return res.json([{ chave: 'velocidade_carrossel', valor: '5000' }]);
    res.json(data || []);
  } catch (error) {
    res.json([{ chave: 'velocidade_carrossel', valor: '5000' }]);
  }
});

app.post('/api/configuracoes/carrossel', async (req, res) => {
  try {
    const { velocidade } = req.body;
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ chave: 'velocidade_carrossel', valor: String(velocidade) }, { onConflict: 'chave' });

    if (error) {
      return res.json({ message: 'Velocidade configurada localmente.' });
    }
    res.json({ message: 'Velocidade atualizada!' });
  } catch (error) {
    res.json({ message: 'Velocidade configurada localmente.' });
  }
});

app.post('/api/login', (req, res) => {
  const { senha } = req.body;
  if (senha !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  res.json({ message: 'Acesso liberado!', autorizado: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
