/* =====================================================================
   CriaDigi · núcleo compartilhado (dados, sessão, cabeçalho, utilidades)
   ===================================================================== */
(function () {
  "use strict";

  const cfg = window.CRIADIGI_CONFIG || {};
  const DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY;
  const sb = DEMO ? null : window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  // ---------------------------------------------------------------- formatos
  // formatos padrão (o admin edita a lista; ela substitui esta na hora de carregar)
  const FORMATOS_PADRAO = [
    { nome: "Feed quadrado", largura: 1080, altura: 1080 },
    { nome: "Feed retrato", largura: 1080, altura: 1350 },
    { nome: "Story / Reels", largura: 1080, altura: 1920 },
    { nome: "Banner / Slide", largura: 1920, altura: 1080 },
    { nome: "Post LinkedIn", largura: 1200, altura: 628 },
    { nome: "Topo de e-mail", largura: 1200, altura: 400 },
    { nome: "Cartaz A4", largura: 1240, altura: 1754 },
  ].map((f, i) => ({ id: "padrao-" + (i + 1), ordem: i + 1, ativo: true, ...f }));

  // proporções que o Gemini aceita; o formato usa a mais próxima e o editor recorta no tamanho exato
  const PROPORCOES_IA = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
  function proporcaoIA(w, h) {
    const alvo = Math.log(w / h);
    let melhor = "1:1", dif = Infinity;
    for (const p of PROPORCOES_IA) {
      const [a, b] = p.split(":").map(Number);
      const d = Math.abs(Math.log(a / b) - alvo);
      if (d < dif) { dif = d; melhor = p; }
    }
    return melhor;
  }
  // lista usada pela tela de criação (só os ativos, na ordem do admin)
  const FORMATOS = [];
  function aplicarFormatos(lista) {
    const ativos = (lista && lista.length ? lista : FORMATOS_PADRAO)
      .filter((f) => f.ativo !== false)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      .map((f) => ({ id: String(f.id), nome: f.nome, w: Number(f.largura), h: Number(f.altura), prop: proporcaoIA(f.largura, f.altura) }));
    FORMATOS.splice(0, FORMATOS.length, ...(ativos.length ? ativos : aplicarFormatosPadrao()));
  }
  function aplicarFormatosPadrao() {
    return FORMATOS_PADRAO.map((f) => ({ id: f.id, nome: f.nome, w: f.largura, h: f.altura, prop: proporcaoIA(f.largura, f.altura) }));
  }
  aplicarFormatos(FORMATOS_PADRAO);

  const PAPEIS_COR = {
    principal: "Principal",
    secundaria: "Secundária",
    apoio: "Apoio",
    fundo: "Fundo",
    texto: "Texto",
  };

  const MODELOS = [
    { id: "gemini-nano-banana-2.1", nome: "Nano Banana 2.1 · equilíbrio (recomendado)" },
    { id: "gemini-3-pro-image", nome: "Nano Banana Pro · máxima qualidade e fidelidade de marca" },
    { id: "gemini-3.1-flash-lite-image", nome: "Nano Banana 2 Lite · mais rápido e barato (só 1K)" },
  ];

  // ---------------------------------------------------------------- utilidades
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(msg, tipo = "info", ms = 4200) {
    let box = $("#toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts";
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = "toast toast-" + tipo;
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, ms);
  }

  function arquivoParaDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function carregarImagem(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (!String(src).startsWith("data:") && !String(src).startsWith("blob:")) img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Não foi possível abrir a imagem."));
      img.src = src;
    });
  }

  // reduz uma imagem (para enviar como base ao Gemini sem pesar demais)
  async function reduzirParaBase64(src, max = 1536) {
    const img = await carregarImagem(src);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.9);
    return { data: url.split(",")[1], mime: "image/jpeg" };
  }

  // carrega as fontes da marca no navegador (para o editor usar no canvas)
  const fontesCarregadas = new Set();
  async function carregarFontes(arquivos) {
    const fontes = (arquivos || []).filter((a) => a.tipo === "fonte" && a.ativo !== false);
    await Promise.all(fontes.map(async (f) => {
      const chave = f.nome + "|" + f.peso + "|" + f.url;
      if (fontesCarregadas.has(chave)) return;
      try {
        const face = new FontFace(f.nome, `url("${f.url}")`, { weight: String(f.peso || 400) });
        await face.load();
        document.fonts.add(face);
        fontesCarregadas.add(chave);
      } catch (e) {
        console.warn("Fonte não carregou:", f.nome, e);
      }
    }));
  }

  // lê o erro devolvido por uma Edge Function
  async function erroDaFuncao(error) {
    try {
      const ctx = error && error.context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j && j.erro) return j.erro;
      }
    } catch (_) { /* segue */ }
    const m = String(error?.message || error || "Erro desconhecido");
    if (/Failed to send a request|Failed to fetch/i.test(m)) {
      return "Não foi possível falar com o servidor. Confira se as funções foram publicadas no Supabase.";
    }
    return m;
  }

  // ================================================================ MODO DEMO
  const DEMO_KEY = "criadigi-demo-v2";
  function demoPadrao() {
    return {
      marca: {
        id: 1, nome: "Digi",
        descricao: "Visual contemporâneo, limpo e enérgico. Fotografia luminosa com pessoas reais em ambientes de trabalho modernos, ou ilustrações flat com formas geométricas simples. Muito respiro, contraste alto e o rosa Digi como cor de destaque.",
        sempre: "Usar o rosa Digi como cor de destaque. Manter fundos limpos e bem iluminados. Diversidade de pessoas.",
        nunca: "Cores neon fora da paleta, visual de banco de imagens genérico, excesso de elementos, filtros vintage, texto escrito na imagem.",
        logo_padrao: null, logo_posicao: "inf-dir", logo_tamanho: 16,
        modelo: "gemini-nano-banana-2.1", resolucao: "2K", max_referencias: 4,
        permitir_texto_ia: false,
        anon_hora: 10, anon_dia: 20, anon_ip_dia: 100, conta_hora: 30, conta_dia: 100, limite_dia: 1000, dominios_conta: "",
      },
      cores: [
        { id: uid(), nome: "Rosa Digi", hex: "#EA0356", papel: "principal", ordem: 1 },
        { id: uid(), nome: "Rosa vivo", hex: "#FF0066", papel: "secundaria", ordem: 2 },
        { id: uid(), nome: "Rosa profundo", hex: "#D10752", papel: "apoio", ordem: 3 },
        { id: uid(), nome: "Grafite", hex: "#222323", papel: "texto", ordem: 4 },
        { id: uid(), nome: "Névoa", hex: "#F7F7F8", papel: "fundo", ordem: 5 },
        { id: uid(), nome: "Branco", hex: "#FFFFFF", papel: "fundo", ordem: 6 },
      ],
      arquivos: [],
      estilos: [
        { id: uid(), nome: "Fotografia", instrucao: "Fotografia editorial realista, luz natural suave, profundidade de campo rasa, cores fiéis à paleta da marca.", ordem: 1, ativo: true },
        { id: uid(), nome: "Ilustração flat", instrucao: "Ilustração vetorial flat, formas geométricas simples, sem texturas, contornos limpos, usando apenas as cores da paleta.", ordem: 2, ativo: true },
        { id: uid(), nome: "3D suave", instrucao: "Render 3D minimalista com materiais foscos e cantos arredondados, iluminação de estúdio suave, fundo limpo nas cores da paleta.", ordem: 3, ativo: true },
        { id: uid(), nome: "Abstrato", instrucao: "Composição abstrata com formas orgânicas e gradientes suaves entre as cores da paleta, ideal como fundo para texto.", ordem: 4, ativo: true },
      ],
      geracoes: [],
      usuarios: [{ id: "demo-admin", email: "admin@demo.local", admin: true, criado_em: new Date().toISOString() }],
      // na demonstração, qualquer senha funciona
    };
  }
  let demoCache = null;
  function demo() {
    if (demoCache) return demoCache;
    try { demoCache = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (_) { demoCache = null; }
    if (!demoCache || !demoCache.marca) demoCache = demoPadrao();
    return demoCache;
  }
  function demoSalvar() {
    const d = demo();
    for (let i = 0; i < 30; i++) {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); return; } catch (_) {
        if (d.geracoes.length) d.geracoes.pop(); else { toast("Armazenamento do navegador cheio no modo demonstração.", "erro"); return; }
      }
    }
  }

  // gera uma imagem de exemplo com a paleta (substitui a IA no modo demo)
  function demoImagem(prop, estiloNome, semente, cores) {
    const [a, b] = prop.split(":").map(Number);
    const k = 1024 / Math.max(a, b);
    const W = Math.round(a * k), H = Math.round(b * k);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    let s = semente >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pal = cores.length ? cores.map((c) => c.hex) : ["#EA0356", "#FF0066", "#222323", "#F7F7F8"];
    const claro = pal.filter((h) => lum(h) > 0.75);
    const fortes = pal.filter((h) => lum(h) <= 0.75);
    const fundo = claro[Math.floor(rnd() * claro.length)] || "#F7F7F8";
    const pick = () => fortes[Math.floor(rnd() * fortes.length)] || pal[0];
    x.fillStyle = fundo; x.fillRect(0, 0, W, H);
    const est = (estiloNome || "").toLowerCase();
    if (est.includes("flat")) {
      for (let i = 0; i < 9; i++) {
        x.fillStyle = pick(); x.globalAlpha = 0.9;
        const r = (0.08 + rnd() * 0.22) * Math.min(W, H);
        const px = rnd() * W, py = rnd() * H;
        if (i % 3 === 0) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
        else if (i % 3 === 1) { x.save(); x.translate(px, py); x.rotate(rnd() * Math.PI); x.fillRect(-r, -r / 2, r * 2, r); x.restore(); }
        else { x.beginPath(); x.moveTo(px, py - r); x.lineTo(px + r, py + r); x.lineTo(px - r, py + r); x.closePath(); x.fill(); }
      }
    } else if (est.includes("3d")) {
      for (let i = 0; i < 6; i++) {
        const r = (0.1 + rnd() * 0.18) * Math.min(W, H);
        const px = rnd() * W, py = rnd() * H, cor = pick();
        const g = x.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.35, cor); g.addColorStop(1, escurecer(cor, 0.45));
        x.globalAlpha = 1; x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
    } else if (est.includes("abstr")) {
      for (let i = 0; i < 5; i++) {
        x.globalAlpha = 0.55; x.fillStyle = pick(); x.beginPath();
        const y0 = rnd() * H; x.moveTo(0, y0);
        for (let px = 0; px <= W; px += W / 8) x.lineTo(px, y0 + Math.sin(px / W * Math.PI * 2 + i) * H * 0.12);
        x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
      }
    } else {
      x.filter = "blur(" + Math.round(Math.min(W, H) * 0.06) + "px)";
      for (let i = 0; i < 7; i++) {
        x.globalAlpha = 0.7; x.fillStyle = pick(); x.beginPath();
        x.arc(rnd() * W, rnd() * H, (0.12 + rnd() * 0.25) * Math.min(W, H), 0, Math.PI * 2); x.fill();
      }
      x.filter = "none";
    }
    x.globalAlpha = 1;
    return c.toDataURL("image/jpeg", 0.85);
  }
  // demonstração: "ajuste" = a mesma imagem com um leve tom da paleta
  async function demoRefinar(base, cores, i) {
    const img = await carregarImagem(`data:${base.mime || "image/jpeg"};base64,${base.data}`);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const pal = cores.length ? cores : [{ hex: "#EA0356" }];
    x.globalCompositeOperation = "soft-light";
    x.globalAlpha = 0.35;
    x.fillStyle = pal[(i + 1) % pal.length].hex;
    x.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  }
  // demonstração: "foto tratada" = a foto enquadrada na proporção, sobre a cor escolhida
  async function demoFoto(foto, prop, cor) {
    const img = await carregarImagem(`data:${foto.mime || "image/jpeg"};base64,${foto.data}`);
    const [a, b] = String(prop || "1:1").split(":").map(Number);
    const k = 900 / Math.max(a, b);
    const c = document.createElement("canvas");
    c.width = Math.round(a * k); c.height = Math.round(b * k);
    const x = c.getContext("2d");
    x.fillStyle = cor || "#F7F7F8";
    x.fillRect(0, 0, c.width, c.height);
    const esc = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight) * 0.92;
    const w = img.naturalWidth * esc, h = img.naturalHeight * esc;
    x.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.9);
  }

  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }
  function escurecer(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0");
    return "#" + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
  }
  function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ================================================================ navegador
  // Id aleatório deste navegador: serve para os limites de uso sem login.
  const CLIENTE_KEY = "criadigi-cliente";
  function uuid4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function clienteId() {
    let id = null;
    try { id = localStorage.getItem(CLIENTE_KEY); } catch (_) { /* sem armazenamento */ }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = uuid4();
      try { localStorage.setItem(CLIENTE_KEY, id); } catch (_) { /* sem armazenamento */ }
    }
    return id;
  }

  // nomes no Supabase (prefixados para conviver com a Sof.ia no mesmo projeto)
  const T = {
    marca: "criadigi_marca", cores: "criadigi_cores", arquivos: "criadigi_arquivos",
    estilos: "criadigi_estilos", geracoes: "criadigi_geracoes", formatos: "criadigi_formatos",
    templates: "criadigi_templates",
  };
  const B = { marca: "criadigi-marca", geracoes: "criadigi-geracoes" };
  const F = { gerar: "criadigi-gerar", usuarios: "criadigi-usuarios" };

  // domínios que contam como conta (ex.: "digi.ag"); vazio = qualquer e-mail
  function dominiosDe(marca) {
    return String(marca?.dominios_conta || "").toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^@/, "")).filter(Boolean);
  }
  function emailPermitido(email, marca) {
    const ds = dominiosDe(marca);
    const e = String(email || "").toLowerCase();
    return !ds.length || ds.some((d) => e.endsWith("@" + d));
  }

  // ---- modo demonstração: sessão e uso simulados no navegador
  const DEMO_SESSAO = "criadigi-demo-sessao";
  const DEMO_USO = "criadigi-demo-uso";
  function demoSessao() {
    let email = null;
    try { email = localStorage.getItem(DEMO_SESSAO); } catch (_) { /* sem armazenamento */ }
    const u = email && demo().usuarios.find((x) => x.email === email);
    return u ? { email: u.email, id: u.id, admin: !!u.admin } : null;
  }
  function demoLimite(marca, conta, quantidade) {
    let uso = [];
    try { uso = JSON.parse(localStorage.getItem(DEMO_USO) || "[]"); } catch (_) { uso = []; }
    const agora = Date.now();
    const meus = uso.filter((u) => u.quem === (conta ? conta.id : "anon"));
    const h = meus.filter((u) => agora - u.t < 3600_000).length;
    const d = meus.filter((u) => agora - u.t < 86400_000).length;
    const [limH, limD] = conta ? [marca.conta_hora, marca.conta_dia] : [marca.anon_hora, marca.anon_dia];
    const extra = conta ? " Tente mais tarde." : " Entre com sua conta para gerar mais e salvar suas artes.";
    if (h + quantidade > limH) throw new Error((limH - h > 0 ? `Você pode gerar só mais ${limH - h} imagem(ns) nesta hora. Diminua as variações.` : `Limite de ${limH} imagens por hora atingido.`) + extra);
    if (d + quantidade > limD) throw new Error((limD - d > 0 ? `Você pode gerar só mais ${limD - d} imagem(ns) nas próximas 24 horas.` : `Limite de ${limD} imagens por dia atingido.`) + extra);
    for (let i = 0; i < quantidade; i++) uso.push({ t: agora, quem: conta ? conta.id : "anon" });
    try { localStorage.setItem(DEMO_USO, JSON.stringify(uso.filter((u) => agora - u.t < 86400_000))); } catch (_) { /* sem armazenamento */ }
    return limH - h - quantidade;
  }

  // ================================================================ API
  const API = {
    demo: DEMO,
    FORMATOS, PAPEIS_COR, MODELOS,
    emailPermitido, dominiosDe,

    async sessao() {
      if (DEMO) return demoSessao();
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) return null;
      const { data: ok } = await sb.rpc("criadigi_is_admin");
      return { email: s.user.email, id: s.user.id, admin: !!ok };
    },

    async entrar(email, senha) {
      email = email.trim().toLowerCase();
      if (DEMO) {
        if (!demo().usuarios.some((u) => u.email === email)) throw new Error("E-mail ou senha incorretos. (Na demonstração, crie uma conta ou use admin@demo.local.)");
        localStorage.setItem(DEMO_SESSAO, email); return;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) {
        if (/Invalid login/i.test(error.message)) throw new Error("E-mail ou senha incorretos.");
        if (/Email not confirmed/i.test(error.message)) throw new Error("Confirme seu e-mail pelo link que enviamos antes de entrar.");
        throw error;
      }
    },

    // devolve true se a conta já entrou; false se precisa confirmar pelo e-mail
    async criarConta(email, senha) {
      email = email.trim().toLowerCase();
      if (DEMO) {
        const d = demo();
        if (d.usuarios.some((u) => u.email === email)) throw new Error("Esse e-mail já tem conta. Use Entrar.");
        d.usuarios.push({ id: uid(), email, admin: false, criado_em: new Date().toISOString() });
        demoSalvar(); localStorage.setItem(DEMO_SESSAO, email);
        return true;
      }
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) {
        if (/already registered/i.test(error.message)) throw new Error("Esse e-mail já tem conta. Use Entrar.");
        if (/Signups not allowed/i.test(error.message)) throw new Error("A criação de contas está desligada. Fale com o admin.");
        throw error;
      }
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
        throw new Error("Esse e-mail já tem conta. Use Entrar.");
      }
      return !!data.session;
    },

    async recuperarSenha(email) {
      if (DEMO) return;
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
    },

    async sair() {
      if (DEMO) { localStorage.removeItem(DEMO_SESSAO); return; }
      await sb.auth.signOut();
    },

    async trocarSenha(nova) {
      if (DEMO) return;
      const { error } = await sb.auth.updateUser({ password: nova });
      if (error) throw error;
    },

    async marca() {
      if (DEMO) {
        const d = demo();
        if (!d.formatos) { d.formatos = FORMATOS_PADRAO.map((f) => ({ ...f, id: uid() })); demoSalvar(); }
        const formatos = [...d.formatos].sort((a, b) => a.ordem - b.ordem);
        aplicarFormatos(formatos);
        return {
          marca: { ...d.marca },
          cores: [...d.cores].sort((a, b) => a.ordem - b.ordem),
          arquivos: d.arquivos.map((a) => ({ ...a })),
          estilos: [...d.estilos].sort((a, b) => a.ordem - b.ordem),
          formatos,
        };
      }
      const [m, c, a, e, fm] = await Promise.all([
        sb.from(T.marca).select("*").eq("id", 1).single(),
        sb.from(T.cores).select("*").order("ordem"),
        sb.from(T.arquivos).select("*").order("criado_em"),
        sb.from(T.estilos).select("*").order("ordem"),
        sb.from(T.formatos).select("*").order("ordem"),
      ]);
      for (const r of [m, c, a, e]) if (r.error) throw r.error;
      const formatos = fm.error ? [] : fm.data;   // se a tabela ainda não existir, usa os padrões
      aplicarFormatos(formatos);
      const arquivos = a.data.map((x) => ({ ...x, url: sb.storage.from(B.marca).getPublicUrl(x.caminho).data.publicUrl }));
      return { marca: m.data, cores: c.data, arquivos, estilos: e.data, formatos };
    },

    async salvarMarca(patch) {
      if (DEMO) { Object.assign(demo().marca, patch); demoSalvar(); return; }
      const { error } = await sb.from(T.marca).update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", 1);
      if (error) throw error;
    },

    async salvarCor(cor) {
      if (DEMO) {
        const d = demo();
        if (cor.id) Object.assign(d.cores.find((c) => c.id === cor.id) || {}, cor);
        else d.cores.push({ ...cor, id: uid() });
        demoSalvar(); return;
      }
      const { error } = cor.id
        ? await sb.from(T.cores).update(cor).eq("id", cor.id)
        : await sb.from(T.cores).insert(cor);
      if (error) throw error;
    },

    async apagarCor(id) {
      if (DEMO) { const d = demo(); d.cores = d.cores.filter((c) => c.id !== id); demoSalvar(); return; }
      const { error } = await sb.from(T.cores).delete().eq("id", id);
      if (error) throw error;
    },

    async enviarArquivo(file, meta) {
      if (DEMO) {
        const url = await arquivoParaDataURL(file);
        const row = { id: uid(), ativo: true, peso: 400, ...meta, caminho: file.name, url, criado_em: new Date().toISOString() };
        demo().arquivos.push(row); demoSalvar(); return row;
      }
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const caminho = `${meta.tipo}/${uid()}.${ext}`;
      const tipoMime = file.type || ({ woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", svg: "image/svg+xml" }[ext]) || "application/octet-stream";
      const up = await sb.storage.from(B.marca).upload(caminho, file, { contentType: tipoMime, upsert: false });
      if (up.error) throw up.error;
      const { data, error } = await sb.from(T.arquivos).insert({ ...meta, caminho }).select("*").single();
      if (error) throw error;
      return data;
    },

    async salvarArquivo(id, patch) {
      if (DEMO) { Object.assign(demo().arquivos.find((a) => a.id === id) || {}, patch); demoSalvar(); return; }
      const { error } = await sb.from(T.arquivos).update(patch).eq("id", id);
      if (error) throw error;
    },

    async apagarArquivo(arq) {
      if (DEMO) { const d = demo(); d.arquivos = d.arquivos.filter((a) => a.id !== arq.id); if (d.marca.logo_padrao === arq.id) d.marca.logo_padrao = null; demoSalvar(); return; }
      await sb.storage.from(B.marca).remove([arq.caminho]);
      const { error } = await sb.from(T.arquivos).delete().eq("id", arq.id);
      if (error) throw error;
    },

    async salvarEstilo(e) {
      if (DEMO) {
        const d = demo();
        if (e.id) Object.assign(d.estilos.find((x) => x.id === e.id) || {}, e);
        else d.estilos.push({ ativo: true, ...e, id: uid() });
        demoSalvar(); return;
      }
      const { error } = e.id
        ? await sb.from(T.estilos).update(e).eq("id", e.id)
        : await sb.from(T.estilos).insert(e);
      if (error) throw error;
    },

    async salvarFormato(f) {
      if (DEMO) {
        const d = demo();
        if (f.id) Object.assign(d.formatos.find((x) => x.id === f.id) || {}, f);
        else d.formatos.push({ ativo: true, ...f, id: uid() });
        demoSalvar(); return;
      }
      const { error } = f.id
        ? await sb.from(T.formatos).update(f).eq("id", f.id)
        : await sb.from(T.formatos).insert(f);
      if (error) throw error;
    },

    async apagarFormato(id) {
      if (DEMO) { const d = demo(); d.formatos = d.formatos.filter((x) => x.id !== id); demoSalvar(); return; }
      const { error } = await sb.from(T.formatos).delete().eq("id", id);
      if (error) throw error;
    },

    async apagarEstilo(id) {
      if (DEMO) { const d = demo(); d.estilos = d.estilos.filter((x) => x.id !== id); demoSalvar(); return; }
      const { error } = await sb.from(T.estilos).delete().eq("id", id);
      if (error) throw error;
    },

    // params (modo "criar"): { prompt, historico, estilo_id, estilo_nome, proporcao, formato, quantidade, base, base_tipo, fotos }
    // params (modo "foto"):  { modo: "foto", foto, tratamento, cor, instrucao, proporcao }
    // resposta: { imagens: [{id, url}], erros, salvo, restante_hora }
    async gerar(params) {
      if (DEMO) {
        const d = demo();
        const s = demoSessao();
        const conta = s && emailPermitido(s.email, d.marca) ? s : null;
        const qtd = params.modo === "foto" ? 1 : params.quantidade;
        const restante = demoLimite(d.marca, conta, qtd);
        await espera(1000 + Math.random() * 800);
        const imagens = [];
        for (let i = 0; i < qtd; i++) {
          let url;
          if (params.modo === "foto") url = await demoFoto(params.foto, params.proporcao, params.cor);
          else if (params.base && params.base_tipo === "refinar") url = await demoRefinar(params.base, d.cores, i);
          else url = demoImagem(params.proporcao, params.estilo_nome, hash(params.prompt + Date.now() + i), d.cores);
          const id = uid();
          if (conta && params.modo !== "foto") d.geracoes.unshift({ id, user_id: conta.id, url, prompt: params.prompt, formato: params.formato, estilo: params.estilo_nome, criado_em: new Date().toISOString() });
          imagens.push({ id, url });
        }
        d.geracoes = d.geracoes.slice(0, 16);
        demoSalvar();
        return { imagens, erros: [], salvo: !!conta && params.modo !== "foto", restante_hora: restante };
      }
      const { data, error } = await sb.functions.invoke(F.gerar, { body: { ...params, cliente: clienteId() } });
      if (error) throw new Error(await erroDaFuncao(error));
      if (data?.erro) throw new Error(data.erro);
      return data;
    },

    // ---------------------------------------------------------------- templates
    async templates({ todos = false } = {}) {
      if (DEMO) {
        const lista = (demo().templates || []).map((t) => ({ ...t, campos: JSON.parse(JSON.stringify(t.campos || [])) }));
        return lista.filter((t) => todos || t.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      }
      let q = sb.from(T.templates).select("*").order("ordem").order("criado_em");
      if (!todos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];   // tabela ainda não criada
        throw error;
      }
      const url = (c) => (c ? sb.storage.from(B.marca).getPublicUrl(c).data.publicUrl : null);
      return data.map((t) => ({ ...t, base_url: url(t.base_caminho), sobre_url: url(t.sobre_caminho) }));
    },

    // envia a arte de fundo ou a camada de cima; devolve { caminho, url }
    async enviarArteTemplate(file) {
      if (DEMO) return { caminho: "demo/" + file.name, url: await arquivoParaDataURL(file) };
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const caminho = `templates/${uid()}.${ext}`;
      const up = await sb.storage.from(B.marca).upload(caminho, file, { contentType: file.type || "image/png", upsert: false });
      if (up.error) throw up.error;
      return { caminho, url: sb.storage.from(B.marca).getPublicUrl(caminho).data.publicUrl };
    },

    async salvarTemplate(t) {
      const linha = {
        nome: t.nome, categoria: t.categoria || "Geral", base_caminho: t.base_caminho, sobre_caminho: t.sobre_caminho || null,
        largura: t.largura, altura: t.altura, campos: t.campos || [], ativo: t.ativo !== false, ordem: t.ordem || 0,
      };
      if (DEMO) {
        const d = demo();
        d.templates = d.templates || [];
        const extra = { base_url: t.base_url, sobre_url: t.sobre_url || null };
        if (t.id) { Object.assign(d.templates.find((x) => x.id === t.id) || {}, linha, extra); demoSalvar(); return t.id; }
        const id = uid();
        d.templates.push({ ...linha, ...extra, id, criado_em: new Date().toISOString() });
        demoSalvar(); return id;
      }
      if (t.id) {
        const { error } = await sb.from(T.templates).update(linha).eq("id", t.id);
        if (error) throw error;
        return t.id;
      }
      const { data, error } = await sb.from(T.templates).insert(linha).select("id").single();
      if (error) throw error;
      return data.id;
    },

    async apagarTemplate(t) {
      if (DEMO) { const d = demo(); d.templates = (d.templates || []).filter((x) => x.id !== t.id); demoSalvar(); return; }
      const arquivos = [t.base_caminho, t.sobre_caminho].filter(Boolean);
      if (arquivos.length) await sb.storage.from(B.marca).remove(arquivos);
      const { error } = await sb.from(T.templates).delete().eq("id", t.id);
      if (error) throw error;
    },

    async removerArteTemplate(caminho) {
      if (DEMO || !caminho) return;
      await sb.storage.from(B.marca).remove([caminho]);
    },

    // artes salvas da conta conectada
    async historico(limite = 60) {
      if (DEMO) {
        const s = demoSessao();
        return s ? demo().geracoes.filter((g) => g.user_id === s.id).map((g) => ({ ...g })) : [];
      }
      const { data: ses } = await sb.auth.getSession();
      if (!ses.session) return [];
      const { data, error } = await sb.from(T.geracoes).select("*")
        .eq("user_id", ses.session.user.id).order("criado_em", { ascending: false }).limit(limite);
      if (error) throw error;
      return data.map((g) => ({ ...g, url: sb.storage.from(B.geracoes).getPublicUrl(g.caminho).data.publicUrl }));
    },

    async apagarGeracao(g) {
      if (DEMO) { const d = demo(); d.geracoes = d.geracoes.filter((x) => x.id !== g.id); demoSalvar(); return; }
      await sb.storage.from(B.geracoes).remove([g.caminho]);
      const { error } = await sb.from(T.geracoes).delete().eq("id", g.id);
      if (error) throw error;
    },

    async usuarios(acao, dados = {}) {
      if (DEMO) {
        const d = demo();
        if (acao === "listar") return { usuarios: d.usuarios.map((u) => ({ ...u, artes: d.geracoes.filter((g) => g.user_id === u.id).length })) };
        if (acao === "criar") {
          if (d.usuarios.some((u) => u.email === dados.email)) throw new Error("Esse e-mail já tem conta.");
          d.usuarios.push({ id: uid(), email: dados.email, admin: !!dados.admin, criado_em: new Date().toISOString() });
        }
        if (acao === "remover") d.usuarios = d.usuarios.filter((u) => u.id !== dados.id);
        if (acao === "admin") { const u = d.usuarios.find((x) => x.email === dados.email); if (u) u.admin = !!dados.valor; }
        demoSalvar();
        return { ok: true };
      }
      const { data, error } = await sb.functions.invoke(F.usuarios, { body: { acao, ...dados } });
      if (error) throw new Error(await erroDaFuncao(error));
      if (data?.erro) throw new Error(data.erro);
      return data;
    },

    aoMudarSessao(fn) {
      if (!DEMO) sb.auth.onAuthStateChange((ev) => fn(ev));
    },

    resetarDemo() { [DEMO_KEY, DEMO_SESSAO, DEMO_USO].forEach((k) => localStorage.removeItem(k)); demoCache = null; },
  };

  // ================================================================ tema claro/escuro
  // O tema é aplicado já no <head> (script inline) para não piscar; aqui só alternamos.
  const TEMA_KEY = "criadigi-tema";
  function temaAtual() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function definirTema(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(TEMA_KEY, t); } catch (_) { /* navegador sem armazenamento */ }
    const b = $("#botao-tema");
    if (b) {
      b.innerHTML = t === "dark" ? ICONE_SOL : ICONE_LUA;
      b.setAttribute("aria-label", t === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro");
      b.title = b.getAttribute("aria-label");
    }
  }
  const ICONE_LUA = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="currentColor"/></svg>';
  const ICONE_SOL = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ================================================================ cabeçalho
  const LINKS = [
    { nome: "Sof.ia", url: "https://digicriacao.github.io/revisor/" },
    { nome: "Otimizador", url: "https://digicriacao.github.io/otimizador/" },
    { nome: "Digi Réguas", url: "https://reguas.digi.ag/" },
    { nome: "Pauta", url: "https://digicriacao.github.io/pauta/" },
  ];
  const ICONE_PESSOA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // opcoes: { pagina: "criar" | "admin", sessao, aoMinhasCriacoes }
  function montarCabecalho({ pagina, sessao, aoMinhasCriacoes }) {
    const h = $("#topo");
    if (!h) return;
    const contaHtml = sessao ? `
      <details class="menu-conta">
        <summary class="botao-ferramenta botao-conta" title="${esc(sessao.email)}">
          <span class="avatar">${esc((sessao.email || "?")[0].toUpperCase())}</span>
          <span class="conta-nome">${esc(sessao.email.split("@")[0])}</span>
        </summary>
        <div class="menu-pop">
          <div class="menu-email">${esc(sessao.email)}</div>
          ${pagina === "criar" ? `<button type="button" data-acao="minhas">Minhas criações</button>` : `<a href="./">Voltar a criar</a>`}
          ${sessao.admin && pagina !== "admin" ? `<a href="admin.html">Painel admin</a>` : ""}
          ${DEMO ? "" : `<button type="button" data-acao="senha">Trocar senha</button>`}
          <button type="button" data-acao="sair">Sair</button>
          ${DEMO ? `<button type="button" data-acao="reset-demo">Limpar dados da demonstração</button>` : ""}
        </div>
      </details>`
      : `<button type="button" class="botao-ferramenta botao-entrar" data-acao="entrar">${ICONE_PESSOA}<span>Entrar</span></button>`;
    h.innerHTML = `
      <div class="topo-in">
        <a class="marca-topo" href="./" aria-label="CriaDigi, início">
          <img src="logo-rosa.png" alt="Digi" class="logo" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
          <span class="logo-texto">digi</span>
          <span class="divisor" aria-hidden="true"></span>
          <span class="produto">Cria<b>Digi</b>${pagina === "admin" ? "<em>Admin</em>" : ""}</span>
        </a>
        <nav class="ferramentas" aria-label="Outras ferramentas Digi">
          ${LINKS.map((l) => `<a class="botao-ferramenta" href="${l.url}">${l.nome}</a>`).join("")}
          <button type="button" class="botao-ferramenta botao-tema" id="botao-tema"></button>
        </nav>
        <div class="conta">${contaHtml}</div>
      </div>
      ${DEMO ? `<div class="faixa-demo">Modo demonstração: as imagens são exemplos gerados no navegador e qualquer senha funciona. Preencha <code>assets/js/config.js</code> para ligar ao Supabase e ao Gemini.</div>` : ""}`;
    definirTema(temaAtual());
    $("#botao-tema").addEventListener("click", () => definirTema(temaAtual() === "dark" ? "light" : "dark"));
    h.onclick = async (ev) => {
      const b = ev.target.closest("[data-acao]");
      if (!b) return;
      const menu = b.closest("details"); if (menu) menu.open = false;
      if (b.dataset.acao === "entrar") abrirLogin();
      if (b.dataset.acao === "minhas" && aoMinhasCriacoes) aoMinhasCriacoes();
      if (b.dataset.acao === "sair") { await API.sair(); location.reload(); }
      if (b.dataset.acao === "reset-demo") {
        if (confirm("Apagar tudo o que foi cadastrado e gerado na demonstração?")) { API.resetarDemo(); location.reload(); }
      }
      if (b.dataset.acao === "senha") abrirNovaSenha(false);
    };
    // fecha o menu da conta ao clicar fora
    document.addEventListener("click", (ev) => {
      const d = $(".menu-conta", h);
      if (d && d.open && !d.contains(ev.target)) d.open = false;
    });
    const medir = () => document.documentElement.style.setProperty("--topo", h.offsetHeight + "px");
    medir();
    window.addEventListener("resize", medir);
    montarRodape(pagina);
  }

  function montarRodape(pagina) {
    let f = $("#rodape");
    if (!f) {
      f = document.createElement("footer");
      f.id = "rodape";
      f.className = "rodape";
      document.body.appendChild(f);
    }
    f.innerHTML = `<span>CriaDigi · Digi</span>${pagina === "admin" ? "" : `<a href="admin.html" class="link-admin">Admin</a>`}`;
  }

  // ================================================================ janela de login
  let dominiosConta = [];   // preenchido pela página depois de carregar a marca
  function definirDominios(marca) { dominiosConta = dominiosDe(marca); }

  function janela(html, { largura = 400 } = {}) {
    const d = document.createElement("dialog");
    d.className = "janela";
    d.style.maxWidth = largura + "px";
    d.innerHTML = `<button type="button" class="janela-fechar" aria-label="Fechar">×</button>${html}`;
    document.body.appendChild(d);
    d.querySelector(".janela-fechar").addEventListener("click", () => d.close());
    d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
    d.showModal();
    return d;
  }

  // modo: "entrar" | "criar" | "esqueci"
  function abrirLogin(modo = "entrar", { aoEntrar } = {}) {
    const dicaDominio = dominiosConta.length
      ? `Use seu e-mail ${dominiosConta.map((d) => "@" + d).join(" ou ")}.` : "";
    const d = janela(`
      <span class="selo">CriaDigi</span>
      <h2 class="janela-titulo"></h2>
      <p class="janela-sub"></p>
      <div class="segmentado segmentado-largo" role="tablist">
        <button type="button" data-modo="entrar">Entrar</button>
        <button type="button" data-modo="criar">Criar conta</button>
      </div>
      <form class="janela-form" novalidate>
        <label>E-mail<input type="email" name="email" required autocomplete="username" placeholder="voce@digi.ag"></label>
        <label class="campo-senha">Senha<input type="password" name="senha" minlength="8" autocomplete="current-password"></label>
        <p class="aviso-form" role="alert" hidden></p>
        <button class="btn btn-primario btn-largo" type="submit"></button>
        <button type="button" class="link-sutil" data-modo="esqueci">Esqueci minha senha</button>
      </form>`);
    const f = $("form", d);
    const aviso = $(".aviso-form", d);
    const mostrar = (msg, tipo = "erro") => { aviso.textContent = msg; aviso.className = "aviso-form " + tipo; aviso.hidden = !msg; };
    const aplicar = (m) => {
      modo = m;
      $$("[data-modo]", $(".segmentado", d)).forEach((b) => b.classList.toggle("on", b.dataset.modo === m));
      $(".segmentado", d).hidden = m === "esqueci";
      $(".campo-senha", d).hidden = m === "esqueci";
      $('[data-modo="esqueci"]', f).hidden = m !== "entrar";
      f.senha.autocomplete = m === "criar" ? "new-password" : "current-password";
      $(".janela-titulo", d).textContent = { entrar: "Entre na sua conta", criar: "Crie sua conta", esqueci: "Recuperar senha" }[m];
      $(".janela-sub", d).textContent = {
        entrar: "Com login, suas artes ficam salvas em Minhas criações e o limite de uso é maior.",
        criar: `Salve suas artes e gere mais imagens por dia. ${dicaDominio}`,
        esqueci: "Enviaremos um link para você criar uma nova senha.",
      }[m];
      $('button[type="submit"]', f).textContent = { entrar: "Entrar", criar: "Criar conta", esqueci: "Enviar link" }[m];
      mostrar("");
    };
    d.addEventListener("click", (ev) => { const b = ev.target.closest("[data-modo]"); if (b) aplicar(b.dataset.modo); });
    aplicar(modo);
    setTimeout(() => f.email.focus(), 30);

    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = f.email.value.trim();
      const senha = f.senha.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return mostrar("Informe um e-mail válido.");
      if (modo !== "esqueci" && senha.length < 8) return mostrar("A senha precisa ter pelo menos 8 caracteres.");
      if (modo === "criar" && dominiosConta.length && !dominiosConta.some((dm) => email.toLowerCase().endsWith("@" + dm))) {
        return mostrar(`As contas são para e-mails ${dominiosConta.map((x) => "@" + x).join(" ou ")}. Sem conta, você ainda pode usar a CriaDigi, só não salva as artes.`);
      }
      const btn = $('button[type="submit"]', f);
      const textoBtn = btn.textContent;
      btn.disabled = true; btn.textContent = "Aguarde…";
      try {
        if (modo === "entrar") {
          await API.entrar(email, senha);
          d.close();
          if (aoEntrar) aoEntrar(); else location.reload();
          return;
        }
        if (modo === "criar") {
          const entrou = await API.criarConta(email, senha);
          if (entrou) { d.close(); if (aoEntrar) aoEntrar(); else location.reload(); return; }
          mostrar("Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme e depois entre aqui.", "ok");
        }
        if (modo === "esqueci") {
          await API.recuperarSenha(email);
          mostrar("Se esse e-mail tiver conta, o link de recuperação chega em alguns minutos.", "ok");
        }
      } catch (e) {
        mostrar(e.message);
      }
      btn.disabled = false; btn.textContent = textoBtn;
    });
    return d;
  }

  // nova senha: depois do link de recuperação (recuperacao = true) ou pelo menu da conta
  function abrirNovaSenha(recuperacao) {
    const d = janela(`
      <span class="selo">CriaDigi</span>
      <h2 class="janela-titulo">${recuperacao ? "Crie uma nova senha" : "Trocar senha"}</h2>
      <form class="janela-form">
        <label>Nova senha<input type="password" name="senha" minlength="8" required autocomplete="new-password"></label>
        <p class="aviso-form" role="alert" hidden></p>
        <button class="btn btn-primario btn-largo" type="submit">Salvar senha</button>
      </form>`);
    const f = $("form", d);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const aviso = $(".aviso-form", d);
      if (f.senha.value.length < 8) { aviso.textContent = "A senha precisa ter pelo menos 8 caracteres."; aviso.className = "aviso-form erro"; aviso.hidden = false; return; }
      try {
        await API.trocarSenha(f.senha.value);
        d.close();
        toast("Senha alterada.", "ok");
        if (recuperacao) setTimeout(() => location.replace(location.pathname), 800);
      } catch (e) { aviso.textContent = e.message; aviso.className = "aviso-form erro"; aviso.hidden = false; }
    });
  }

  // abre a janela de nova senha quando a pessoa chega pelo link do e-mail
  if (!DEMO) sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") setTimeout(() => abrirNovaSenha(true), 300); });

  // tela de login do painel admin
  function telaLogin(container, { titulo, aoEntrar }) {
    container.innerHTML = `
      <section class="login">
        <div class="login-card">
          <span class="selo">CriaDigi</span>
          <h1>${esc(titulo)}</h1>
          <p class="sub">Área restrita a quem administra o manual da marca. Para criar imagens, <a href="./">volte à CriaDigi</a>.</p>
          <form id="form-login" autocomplete="on">
            <label>E-mail<input type="email" name="email" required autocomplete="username" placeholder="voce@digi.ag"></label>
            <label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
            <button class="btn btn-primario btn-largo" type="submit">Entrar</button>
            <p class="erro-login" role="alert" hidden></p>
          </form>
        </div>
      </section>`;
    const f = $("#form-login", container);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = f.querySelector("button");
      const erro = f.querySelector(".erro-login");
      btn.disabled = true; btn.textContent = "Entrando…"; erro.hidden = true;
      try {
        await API.entrar(f.email.value, f.senha.value);
        await aoEntrar();
      } catch (e) {
        erro.textContent = e.message; erro.hidden = false;
        btn.disabled = false; btn.textContent = "Entrar";
      }
    });
  }

  window.CriaDigi = {
    API, FORMATOS, PAPEIS_COR, MODELOS, proporcaoIA,
    esc, $, $$, uid, toast, espera,
    arquivoParaDataURL, carregarImagem, reduzirParaBase64, carregarFontes,
    montarCabecalho, telaLogin, lum, definirTema, abrirLogin, definirDominios,
  };
})();
