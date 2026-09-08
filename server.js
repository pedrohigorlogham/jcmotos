import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Inicializa o Express
const app = express();

// IMPORTANTE: Se o seu painel envia fotos grandes em Base64, precisamos aumentar o limite do Express
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(process.cwd()));


// Inicializa o cliente do Supabase usando as variáveis seguras do Render
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para salvar a imagem em Base64 direto no Supabase Storage
async function salvarImagemSupabase(base64) {
    const partes = String(base64).match(/^data:image\/(jpeg|png|jpg);base64,(.+)$/);
    if (!partes) throw new Error('Envie uma imagem JPG, JPEG ou PNG válida.');

    const extensao = partes[1];
    const base64Dados = partes[2];
    const buffer = Buffer.from(base64Dados, 'base64');

    // Gera um nome único para a foto não ser sobrescrita
    const nomeArquivo = `capacete-${crypto.randomUUID()}.${extensao}`;

    // Faz o upload para o bucket 'imagens-catalogo' que criamos
    const { data, error } = await supabase.storage
        .from('imagens-catalogo')
        .upload(nomeArquivo, buffer, {
            contentType: `image/${extensao}`,
            upsert: false
        });

    if (error) throw error;

    // Pega a URL pública permanente da foto
    const { data: publicUrlData } = supabase.storage
        .from('imagens-catalogo')
        .getPublicUrl(nomeArquivo);

    return publicUrlData.publicUrl;
}

// ==========================================
// ROTAS DO CATÁLOGO (DEFINITIVAS NO BANCO)
// ==========================================

// 1. Rota para BUSCAR os produtos do catálogo
app.get('/api/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('produtos')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Retorna a lista de produtos diretamente do banco de dados
        res.json(data);
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ error: 'Erro ao buscar o catálogo.' });
    }
});

// 2. Rota para ADICIONAR um novo produto no catálogo
app.post('/api/produtos', async (req, res) => {
    try {
        const { nome, preco, imagem } = req.body; // 'imagem' deve ser o texto em Base64 vindo do seu formulário

        if (!nome || !preco || !imagem) {
            return res.status(400).json({ error: 'Preencha todos os campos e envie a imagem.' });
        }

        // Envia a foto para o Storage do Supabase e pega o link permanente
        const fotoPublicUrl = await salvarImagemSupabase(imagem);

        // Salva as informações do produto e o link da foto na tabela 'produtos'
        const { data, error } = await supabase
            .from('produtos')
            .insert([{ nome, preco, imagem_url: fotoPublicUrl }]);

        if (error) throw error;

        res.status(201).json({ message: 'Produto cadastrado com sucesso e salvo permanentemente!' });
    } catch (error) {
        console.error('Erro ao salvar produto:', error);
        res.status(500).json({ error: error.message || 'Erro ao cadastrar produto.' });
    }
});

// Mantive as outras funções do seu servidor caso precise usar para logins futuros
function criarHashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(senha, salt, 64, (erro, chave) => {
            if (erro) reject(erro);
            else resolve({ salt, hash: chave.toString('hex') });
        });
    });
}

// Inicia o servidor na porta padrão do Render ou na 3000 local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
