-- =====================================================================
-- CriaDigi · configuração do banco
-- Rode uma vez no SQL Editor do Supabase (pode rodar de novo sem problema).
--
-- Pode ser o MESMO projeto da Sof.ia (Revisor): tudo do CriaDigi usa o
-- prefixo "criadigi_" e não toca nas tabelas, no bucket nem na função
-- da Sof.ia (revisoes, vocabulario, regras, feedbacks, keepalive, artes,
-- quick-api).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Admins ----------------------------------------------------
create table if not exists public.criadigi_admins (
  email text primary key
);

insert into public.criadigi_admins (email) values ('tiago.perrart@digi.ag')
on conflict do nothing;

create or replace function public.criadigi_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.criadigi_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Marca (linha única) ----------------------------------------
create table if not exists public.criadigi_marca (
  id                int primary key default 1 check (id = 1),
  nome              text default 'Digi',
  descricao         text default '',
  sempre            text default '',
  nunca             text default '',
  logo_padrao       uuid,
  logo_posicao      text default 'inf-dir',
  logo_tamanho      int  default 16,
  modelo            text default 'gemini-nano-banana-2.1',
  resolucao         text default '2K',
  max_referencias   int  default 4,
  permitir_texto_ia boolean default false,
  -- limites de uso
  anon_hora         int  default 10,    -- sem login: por navegador, por hora
  anon_dia          int  default 20,    -- sem login: por navegador, por dia
  anon_ip_dia       int  default 100,   -- sem login: teto por rede (IP), por dia
  conta_hora        int  default 30,    -- com login: por conta, por hora
  conta_dia         int  default 100,   -- com login: por conta, por dia
  limite_dia        int  default 1000,  -- teto da plataforma inteira, por dia
  dominios_conta    text default 'digi.ag', -- domínios que contam como conta (vazio = qualquer)
  atualizado_em     timestamptz default now()
);

-- (para quem rodou uma versão anterior deste arquivo)
alter table public.criadigi_marca add column if not exists anon_hora int default 10;
alter table public.criadigi_marca add column if not exists anon_dia int default 20;
alter table public.criadigi_marca add column if not exists anon_ip_dia int default 100;
alter table public.criadigi_marca add column if not exists conta_hora int default 30;
alter table public.criadigi_marca add column if not exists conta_dia int default 100;
alter table public.criadigi_marca add column if not exists limite_dia int default 1000;
alter table public.criadigi_marca add column if not exists dominios_conta text default 'digi.ag';

insert into public.criadigi_marca (id, nome, descricao, sempre, nunca)
values (
  1,
  'Digi',
  'Visual contemporâneo, limpo e enérgico. Fotografia luminosa com pessoas reais em ambientes de trabalho modernos, ou ilustrações flat com formas geométricas simples. Muito respiro, contraste alto e o rosa Digi como cor de destaque.',
  'Usar o rosa Digi como cor de destaque. Manter fundos limpos e bem iluminados. Diversidade de pessoas.',
  'Cores neon fora da paleta, visual de banco de imagens genérico, excesso de elementos, filtros vintage, texto escrito na imagem.'
)
on conflict (id) do nothing;

-- ---------- Cores -----------------------------------------------------
create table if not exists public.criadigi_cores (
  id     uuid primary key default gen_random_uuid(),
  nome   text not null,
  hex    text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  papel  text default 'apoio',
  ordem  int  default 0
);

insert into public.criadigi_cores (nome, hex, papel, ordem)
select * from (values
  ('Rosa Digi',     '#EA0356', 'principal',  1),
  ('Rosa vivo',     '#FF0066', 'secundaria', 2),
  ('Rosa profundo', '#D10752', 'apoio',      3),
  ('Grafite',       '#222323', 'texto',      4),
  ('Névoa',         '#F7F7F8', 'fundo',      5),
  ('Branco',        '#FFFFFF', 'fundo',      6)
) as v(nome, hex, papel, ordem)
where not exists (select 1 from public.criadigi_cores);

-- ---------- Arquivos da marca (logos, fontes, referências) ----------------
create table if not exists public.criadigi_arquivos (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('logo', 'fonte', 'referencia')),
  nome       text not null,
  caminho    text not null,
  variante   text,             -- logo: principal/negativa/icone · fonte: titulo/texto
  peso       int default 400,  -- fontes
  descricao  text,
  ativo      boolean default true,
  criado_em  timestamptz default now()
);

-- ---------- Estilos (presets que o usuário escolhe) ----------------------
create table if not exists public.criadigi_estilos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  instrucao text not null,
  ordem     int default 0,
  ativo     boolean default true
);

insert into public.criadigi_estilos (nome, instrucao, ordem)
select * from (values
  ('Fotografia', 'Fotografia editorial realista, luz natural suave, profundidade de campo rasa, cores fiéis à paleta da marca.', 1),
  ('Ilustração flat', 'Ilustração vetorial flat, formas geométricas simples, sem texturas, contornos limpos, usando apenas as cores da paleta.', 2),
  ('3D suave', 'Render 3D minimalista com materiais foscos e cantos arredondados, iluminação de estúdio suave, fundo limpo nas cores da paleta.', 3),
  ('Abstrato', 'Composição abstrata com formas orgânicas e gradientes suaves entre as cores da paleta, ideal como fundo para texto.', 4)
) as v(nome, instrucao, ordem)
where not exists (select 1 from public.criadigi_estilos);

-- ---------- Artes salvas (só de quem está logado) --------------------------
create table if not exists public.criadigi_geracoes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references auth.users on delete cascade,
  email     text,
  prompt    text,
  estilo    text,
  formato   text,
  caminho   text not null,
  modelo    text,
  criado_em timestamptz default now()
);
create index if not exists criadigi_geracoes_user_idx on public.criadigi_geracoes (user_id, criado_em desc);

-- ---------- Registro de uso (limites; vale para todos, com ou sem login) ----
create table if not exists public.criadigi_uso (
  id        bigint generated always as identity primary key,
  user_id   uuid,
  cliente   text,   -- hash do id aleatório do navegador
  origem    text,   -- hash do IP (o endereço em si não é guardado)
  criado_em timestamptz default now()
);
create index if not exists criadigi_uso_user_idx    on public.criadigi_uso (user_id, criado_em desc);
create index if not exists criadigi_uso_cliente_idx on public.criadigi_uso (cliente, criado_em desc);
create index if not exists criadigi_uso_origem_idx  on public.criadigi_uso (origem, criado_em desc);
create index if not exists criadigi_uso_data_idx    on public.criadigi_uso (criado_em desc);

-- ---------- Segurança (RLS) ---------------------------------------------
alter table public.criadigi_admins   enable row level security;
alter table public.criadigi_marca    enable row level security;
alter table public.criadigi_cores    enable row level security;
alter table public.criadigi_arquivos enable row level security;
alter table public.criadigi_estilos  enable row level security;
alter table public.criadigi_geracoes enable row level security;
alter table public.criadigi_uso      enable row level security;  -- sem policies: só a função lê e grava

-- manual de marca: qualquer visitante lê, só admin altera
do $$
declare t text;
begin
  foreach t in array array['criadigi_marca','criadigi_cores','criadigi_arquivos','criadigi_estilos'] loop
    execute format('drop policy if exists "leitura publica" on public.%I', t);
    execute format('create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists "admin edita" on public.%I', t);
    execute format('create policy "admin edita" on public.%I for all to authenticated using (public.criadigi_is_admin()) with check (public.criadigi_is_admin())', t);
  end loop;
end $$;

drop policy if exists "admin lê admins" on public.criadigi_admins;
create policy "admin lê admins" on public.criadigi_admins for select to authenticated
  using (public.criadigi_is_admin() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "admin edita admins" on public.criadigi_admins;
create policy "admin edita admins" on public.criadigi_admins for all to authenticated
  using (public.criadigi_is_admin()) with check (public.criadigi_is_admin());

-- artes salvas: cada pessoa vê e apaga as suas
drop policy if exists "vê as próprias" on public.criadigi_geracoes;
create policy "vê as próprias" on public.criadigi_geracoes for select to authenticated
  using (user_id = auth.uid() or public.criadigi_is_admin());
drop policy if exists "apaga as próprias" on public.criadigi_geracoes;
create policy "apaga as próprias" on public.criadigi_geracoes for delete to authenticated
  using (user_id = auth.uid() or public.criadigi_is_admin());

-- ---------- Storage -----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('criadigi-marca', 'criadigi-marca', true), ('criadigi-geracoes', 'criadigi-geracoes', true)
on conflict (id) do nothing;

drop policy if exists "criadigi admin envia marca" on storage.objects;
create policy "criadigi admin envia marca" on storage.objects for insert to authenticated
  with check (bucket_id = 'criadigi-marca' and public.criadigi_is_admin());
drop policy if exists "criadigi admin altera marca" on storage.objects;
create policy "criadigi admin altera marca" on storage.objects for update to authenticated
  using (bucket_id = 'criadigi-marca' and public.criadigi_is_admin());
drop policy if exists "criadigi admin apaga marca" on storage.objects;
create policy "criadigi admin apaga marca" on storage.objects for delete to authenticated
  using (bucket_id = 'criadigi-marca' and public.criadigi_is_admin());
drop policy if exists "criadigi apaga as proprias artes" on storage.objects;
create policy "criadigi apaga as proprias artes" on storage.objects for delete to authenticated
  using (bucket_id = 'criadigi-geracoes' and (storage.foldername(name))[1] = auth.uid()::text);
