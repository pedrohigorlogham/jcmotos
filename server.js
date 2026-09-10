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

// Inicializa o cliente do Supabase usando as variáveis seguras do Render
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para salvar e comprimir a imagem em Base64 no Storage do Supabase
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

// Atalho /admin que redireciona para a página painel.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'painel.html'));
});

// Rota para buscar os produtos do catálogo do Supabase
app.get('/api/produtos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar o catálogo.' });
  }
});

// Rota para cadastrar um novo produto (incluindo se é lançamento)
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

// Rota para deletar um produto pelo ID
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

// Rota para buscar as configurações do site (como velocidade do carrossel)
app.get('/api/configuracoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('*');

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações.' });
  }
});

// Rota para atualizar a velocidade do carrossel no painel admin (À prova de falhas)
app.post('/api/configuracoes/carrossel', async (req, res) => {
  try {
    const { velocidade } = req.body;
    if (!velocidade) {
      return res.status(400).json({ error: 'Informe a velocidade.' });
    }

    // 1. Tenta atualizar se o registro já existir
    const { data: updateData, error: updateError } = await supabase
      .from('configuracoes')
      .update({ valor: String(velocidade) })
      .eq('chave', 'velocidade_carrossel')
      .select();

    // 2. Se a linha não existia para atualizar, insere uma nova
    if (!updateData || updateData.length === 0) {
      const { error: insertError } = await supabase
        .from('configuracoes')
        .insert([{ chave: 'velocidade_carrossel', valor: String(velocidade) }]);

      if (insertError) throw insertError;
    } else if (updateError) {
      throw updateError;
    }

    res.json({ message: 'Velocidade do carrossel atualizada com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar velocidade:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração.' });
  }
});

// Rota de login por senha mestra
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
