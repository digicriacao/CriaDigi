# CriaDigi

Gerador de imagens da Digi. Toda imagem segue o manual de marca cadastrado no painel admin: paleta, estilo visual, regras de "sempre" e "nunca" e imagens de referência. Depois de gerar, a pessoa recorta, redimensiona, ajusta, coloca textos com as fontes oficiais e aplica a logo.

Endereço final: **https://digicriacao.github.io/criadigi/**

| | Sem login | Com login (conta @digi.ag) |
|---|---|---|
| Gerar e editar | ✓ | ✓ |
| Artes salvas em "Minhas criações" | ✗ (baixe na hora) | ✓ |
| Limite padrão | 10 por hora, 20 por dia | 30 por hora, 100 por dia |

Os limites e o domínio que conta como conta são ajustáveis em **Admin → IA e limites**.

---

## Como funciona

```
Navegador (GitHub Pages)            Supabase (o mesmo da Sof.ia)          Google Gemini
──────────────────────────          ─────────────────────────────         ─────────────
index.html  → cria e edita     →    função criadigi-gerar            →    Nano Banana
            → entrar/criar conta     • junta o manual de marca              (gera a imagem)
admin.html  → manual da marca        • guarda a chave do Gemini
                                     • aplica os limites
                                     • salva a arte se houver login
GitHub Actions (keep-alive)    →    consulta o banco a cada 3 dias
```

**A chave do Gemini nunca fica no site.** Ela fica nos Secrets do Supabase.

**Por que a marca fica sempre certa:** a IA recebe paleta, estilo, regras e referências em todo pedido e é instruída a **não escrever textos nem logos**. Textos e logo entram pelo editor, com as fontes e os arquivos oficiais.

---

## Usando o mesmo Supabase da Sof.ia

Pode, e é o recomendado: um projeto só, uma chave do Gemini só, um keep-alive cuidando dos dois.

Tudo do CriaDigi tem o prefixo `criadigi`, então nada encosta na Sof.ia:

| | Sof.ia (já existe, não mexer) | CriaDigi (novo) |
|---|---|---|
| Tabelas | `revisoes`, `vocabulario`, `regras`, `feedbacks`, `keepalive` | `criadigi_marca`, `criadigi_cores`, `criadigi_arquivos`, `criadigi_estilos`, `criadigi_geracoes`, `criadigi_uso`, `criadigi_admins` |
| Storage | `artes` | `criadigi-marca`, `criadigi-geracoes` |
| Funções | `quick-api` | `criadigi-gerar`, `criadigi-usuarios` |
| Secrets | `GEMINI_API_KEY` e outras | usa a mesma `GEMINI_API_KEY` |

O login (Authentication) passa a ser usado pelo CriaDigi. A Sof.ia não usa o login do Supabase (o admin dela é por senha no código), então ligar as contas não muda nada nela.

> Os arquivos das funções estão sem acentos de propósito: o editor do Supabase quebra o deploy com acentos (o mesmo problema que apareceu no `revisar.ts` da Sof.ia). Os textos com acento aparecem normalmente na tela, porque estão escritos em código (`é`).

---

## Instalação (uma vez só)

### 1. Banco de dados

1. No projeto da Sof.ia no Supabase, abra **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `supabase/setup.sql` e clique em **Run**.
   Isso cria as tabelas, a segurança e as pastas de arquivos do CriaDigi, cadastra as cores Digi e 4 estilos, e define **tiago.perrart@digi.ag** como admin.

### 2. Login (Authentication)

1. **Authentication** → **Sign In / Providers** → **Email**:
   - **Allow new users to sign up:** ligado (as pessoas criam a própria conta pelo botão Entrar).
   - **Confirm email:** escolha uma opção.
     - **Desligado (recomendado para começar):** a conta funciona na hora. O e-mail embutido do Supabase envia poucos e-mails por hora, então, com ele ligado, várias pessoas criando conta ao mesmo tempo ficam sem receber a confirmação.
     - **Ligado:** mais seguro (garante que a pessoa é dona do e-mail). Para o time todo, configure um SMTP próprio em **Authentication → Emails → SMTP Settings**.
2. **Authentication** → **URL Configuration**:
   - **Site URL:** `https://digicriacao.github.io/criadigi/`
   - **Redirect URLs:** adicione `https://digicriacao.github.io/criadigi/` (é para onde vão os links de confirmação e de "esqueci minha senha").
3. Crie a sua conta: **Authentication** → **Users** → **Add user** → **Create new user**, com o e-mail `tiago.perrart@digi.ag`, uma senha de **8 caracteres ou mais** e **Auto Confirm User** marcado. Você também pode criar pela própria CriaDigi, no botão **Entrar** → **Criar conta**.

> Não coloque senhas em nenhum arquivo do projeto. O repositório é público.

### 3. Chave do Gemini

A Sof.ia já tem a `GEMINI_API_KEY` nos Secrets, e o CriaDigi usa a mesma. Só confira duas coisas no [Google AI Studio](https://aistudio.google.com/apikey):
- o projeto da chave está com **faturamento ativo** (a geração de imagens exige);
- o orçamento comporta as imagens. Você controla o volume em **Admin → IA e limites**.

### 4. Funções

Em **Edge Functions** → **Deploy a new function** → **Via Editor**:

1. Nome: **`criadigi-gerar`**. Cole o conteúdo de `supabase/functions/criadigi-gerar/index.ts` e clique em **Deploy**.
   Depois, em `criadigi-gerar` → **Details**, **desligue "Enforce JWT verification"** e salve. É isso que permite gerar sem login.
2. Nome: **`criadigi-usuarios`**. Cole `supabase/functions/criadigi-usuarios/index.ts` e clique em **Deploy**.
   Se o painel admin mostrar "Invalid JWT" na tela Contas, desligue a verificação nesta também; a função confere sozinha se quem chama é admin.

### 5. Ligar o site ao Supabase

Abra `assets/js/config.js` e preencha com os mesmos valores que estão no `index.html` da Sof.ia (Supabase → **Project Settings** → **API**):

```js
window.CRIADIGI_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_KEY: "a anon key (eyJhbGci...) ou publishable key",
};
```

Esses dois valores são públicos por natureza. **Nunca** coloque aqui a `service_role`/`secret key` nem a chave do Gemini.

### 6. GitHub Pages

1. Na organização **digicriacao**, crie o repositório **`criadigi`** (público).
2. Envie **todos** os arquivos desta pasta, mantendo a estrutura. Confira se a pasta **`.github`** subiu: como começa com ponto, alguns computadores a escondem.
3. Copie para a raiz o **`logo-rosa.png`** do repositório do Pauta (é a logo do cabeçalho).
4. **Settings** → **Pages** → Source: **Deploy from a branch** → Branch **main** / **/ (root)** → **Save**.
5. Em 1 ou 2 minutos o site estará em `https://digicriacao.github.io/criadigi/`.

### 7. Keep-alive (impede o Supabase de pausar)

O repositório da Sof.ia já pinga este projeto a cada 3 dias. O do CriaDigi faz o mesmo, como reforço: se um dos dois parar, o outro mantém o projeto ativo.

1. No repositório `criadigi`: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crie dois, com os mesmos valores do `config.js`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. Teste: aba **Actions** → **Supabase Keep-Alive** → **Run workflow**. Em segundos aparece um ✓ verde.

O GitHub desliga tarefas agendadas de repositórios sem commits há 60 dias. O keep-alive cuida disso sozinho: se o último commit tiver mais de 50 dias, ele faz um commit vazio.

### 8. Primeiro acesso

1. Abra o site, clique em **Entrar** e entre com sua conta. Como admin, o menu da conta mostra **Painel admin** (também há um link **Admin** no rodapé).
2. Cadastre o material da marca nesta ordem:
   - **Logos:** principal (fundo claro) e negativa (fundo escuro), em PNG transparente ou SVG.
   - **Tipografia:** os arquivos das fontes, um por peso, indicando qual é de título e qual é de texto.
   - **Referências:** de 4 a 10 peças aprovadas, sem texto, que representem o estilo.
   - **Identidade:** revise a descrição e as regras. A prévia mostra o que a IA recebe.
   - **IA e limites:** confira os limites e o domínio `digi.ag`.

---

## Testar antes de configurar

Com `config.js` vazio, a plataforma abre em **modo demonstração**: tudo funciona no navegador (login simulado, admin, editor, limites), mas as imagens são exemplos abstratos com a paleta. Na demonstração, qualquer senha funciona e o admin é `admin@demo.local`.

```bash
cd criadigi
python3 -m http.server 8000
# abra http://localhost:8000
```

---

## O que tem na plataforma

**Criar (index.html)**
- Prompt com ideias prontas, estilos do admin, 7 formatos (Feed quadrado e retrato, Story/Reels, Banner, LinkedIn, Topo de e-mail, Cartaz A4) e 1, 2 ou 4 variações.
- Opção de partir de uma foto ou rascunho, recriada no padrão da marca.
- Botão **Entrar**: entrar, criar conta e "esqueci minha senha". Com login, "Minhas criações" guarda tudo o que a pessoa gera.
- Botões para Sof.ia, Otimizador, Digi Réguas e Pauta, e tema claro/escuro.

**Editor**
- Recortar (proporção livre ou travada), resize em pixels, girar e espelhar.
- Brilho, contraste, saturação, temperatura, filtro da marca e degradê para texto.
- Textos com fontes e cores da marca, arrastáveis; logo padrão aplicada sozinha.
- **Refinar com IA** mantendo textos e logo; desfazer/refazer; exportar em PNG, JPG ou WebP.

**Admin (admin.html, link no rodapé)**
- Identidade, paleta, tipografia, logos, referências e estilos.
- **Contas:** lista quem tem conta, quantas artes salvou, define admins, troca senhas e remove contas.
- **IA e limites:** modelo, resolução e todos os limites de uso.

---

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "Não foi possível falar com o servidor" | As funções não foram publicadas ou estão com outro nome. Os nomes são `criadigi-gerar` e `criadigi-usuarios`. |
| Erro 401 ao gerar sem login | Desligue "Enforce JWT verification" em `criadigi-gerar`. |
| Deploy da função falha com "Unexpected eof" | Cole o arquivo inteiro de novo, sem editar; ele precisa continuar sem acentos. |
| "Manual de marca não encontrado" | Rode o `setup.sql`. |
| "A chave do Gemini é inválida" / "faturamento" | Confira a `GEMINI_API_KEY` e o Billing no Google AI Studio. |
| "Confirme seu e-mail" e o e-mail não chega | Desligue "Confirm email" (passo 2) ou configure um SMTP. Para liberar alguém na hora: Authentication → Users → a pessoa → **Confirm user**. |
| Link de "esqueci minha senha" abre página errada | Confira Site URL e Redirect URLs (passo 2.2). |
| Conta criada, mas as artes não salvam | O e-mail não é do domínio configurado (padrão `digi.ag`). Ajuste em Admin → IA e limites. |
| Painel admin não aparece no menu | O e-mail precisa estar como admin (Admin → Contas, ou a tabela `criadigi_admins`). |
| Keep-alive com ✗ vermelho | Confira os dois segredos do passo 7. Se o projeto já pausou, clique em **Restore** no Supabase. |

---

## Estrutura

```
criadigi/
├── .github/workflows/
│   └── keepalive.yml                  mantém o Supabase ativo (a cada 3 dias)
├── index.html                         criação + editor (login opcional)
├── admin.html                         manual de marca (só admins)
├── logo-rosa.png                      (copiar do repositório do Pauta)
├── assets/
│   ├── css/styles.css                 identidade Digi, tema claro e escuro
│   └── js/
│       ├── config.js                  URL e chave pública do Supabase
│       ├── core.js                    dados, login, cabeçalho, rodapé, demonstração
│       ├── editor.js                  editor de imagem (canvas)
│       ├── app.js                     tela de criação
│       └── admin.js                   painel admin
└── supabase/
    ├── setup.sql                      banco, segurança e storage
    └── functions/
        ├── criadigi-gerar/index.ts    chama o Gemini com o manual da marca
        └── criadigi-usuarios/index.ts gestão de contas (só admin)
```
