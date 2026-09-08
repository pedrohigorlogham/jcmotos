import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
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

// Função para salvar a imagem em Base64 no Storage do Supabase
async function salvarImagemSupabase(base64) {
    const partes = String(base64).match(/^data:image\/(jpeg|png|jpg);base64,(.+)$/);
    if (!partes) throw new Error('Envie uma imagem JPG, JPEG ou PNG válida.');

    const extensao = partes[1];
    const base64Dados = partes[2];
    const buffer = Buffer.from(base64Dados, 'base64');
    const nomeArquivo = `capacete-${crypto.randomUUID()}.${extensao}`;

    const { data, error } = await supabase.storage
        .from('Imagens-catalogo')
        .upload(nomeArquivo, buffer, {
            contentType: `image/${extensao}`,
            upsert: false
        });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
        .from('Imagens-catalogo')
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
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar o catálogo.' });
    }
});

// Rota para cadastrar um novo produto com foto
app.post('/api/produtos', async (req, res) => {
    try {
        const { nome, preco, imagem } = req.body;
        if (!nome || !preco || !imagem) {
            return res.status(400).json({ error: 'Preencha todos os campos.' });
        }

        const fotoPublicUrl = await salvarImagemSupabase(imagem);

        const { error } = await supabase
            .from('produtos')
            .insert([{ nome, preco, imagem_url: fotoPublicUrl }]);

        if (error) throw error;
        res.status(201).json({ message: 'Produto cadastrado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ÚNICA ROTA DE LOGIN COMPATÍVEL COM O SEU PAINEL (SENHA MESTRA)
app.post('/api/login', (req, res) => {
    try {
        const { senha } = req.body;

        if (!senha) {
            return res.status(400).json({ error: 'Por favor, digite a senha.' });
        }

        // Compara com a variável do Render
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
