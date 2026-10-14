/* =====================================================================
   CriaDigi · página de criação
   Esquerda: chat com a IA. Centro: resultados, templates, minhas criações
   e editor. Direita: opções da criação (ou ferramentas, ou campos do template).
   ===================================================================== */
(function () {
  "use strict";
  const { API, FORMATOS, esc, $, $$, toast, carregarImagem, reduzirParaBase64,
    carregarFontes, arquivoParaDataURL, montarCabecalho, lum, abrirLogin, definirDominios, uid } = window.CriaDigi;
  const { Editor, POSICOES } = window.CriaDigiEditor;
  const Modelo = window.CriaDigiModelo;

  const MAX_FOTOS = 4;

  const S = {
    sessao: null,            // pessoa conectada (ou null)
    conta: false,            // true se a conta salva artes (e-mail de domínio permitido)
    marca: null, cores: [], arquivos: [], estilos: [],
    estilo: null,
    formato: null,
    quantidade: 2,
    base: null,              // dataURL da imagem de partida (opcional)
    fotos: [],               // fotos de pessoas: [{ id, url }]
    historico: [],           // pedidos já feitos nesta conversa
    foco: null,              // imagem que o próximo pedido vai ajustar
    resultados: [],          // {id, url, formato, prompt}
    aberto: null,            // item aberto no editor
    gerando: false,
    exp: { tipo: "image/png", qualidade: 0.9 },
    trava: true,
    templates: null, categoria: "Todas", tpl: null,
  };

  let ed = null;

  // ================================================================ início
  async function iniciar() {
    // a criação é aberta; o login é opcional e serve para salvar as artes
    S.sessao = await API.sessao().catch(() => null);
    montarCabecalho({ pagina: "criar", sessao: S.sessao, aoMinhasCriacoes: () => mostrarAba("galeria") });
    $("#app").hidden = false;

    try {
      const dados = await API.marca();
      Object.assign(S, dados);
    } catch (e) {
      toast("Não consegui carregar o manual da marca: " + e.message, "erro", 8000);
    }
    definirDominios(S.marca);
    S.conta = !!S.sessao && API.emailPermitido(S.sessao.email, S.marca);
    atualizarAvisoConta();
    S.estilo = S.estilos.filter((e) => e.ativo !== false)[0] || null;
    S.formato = FORMATOS[0];   // o primeiro formato da lista do admin já vem marcado

    ed = new Editor($("#tela"), { aoMudar: sincronizarFerramentas, aoSelecionar: aoSelecionar });
    carregarFontes(S.arquivos).then(() => { if (ed) ed.sujarBase(); if (S.tpl) desenharTpl(); });
    carregarLogos();

    montarChat();
    montarOpcoes();
    montarFerramentas();
    montarTemplates();
    ligarAtalhos();
  }

  // ================================================================ chat
  function montarChat() {
    const txt = $("#prompt");
    $("#gerar").addEventListener("click", gerar);
    txt.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); gerar(); }
    });
    const crescer = () => { txt.style.height = "auto"; txt.style.height = Math.min(220, txt.scrollHeight + 2) + "px"; };
    txt.addEventListener("input", crescer);

    $("#limpar-foco").addEventListener("click", () => definirFoco(null));
    $("#nova-conversa").addEventListener("click", () => {
      if (S.gerando) return;
      S.historico = []; definirFoco(null);
      $$(".msg", $("#chat")).forEach((m) => m.remove());
      $("#chat-vazio").hidden = false;
      $("#nova-conversa").hidden = true;
      txt.focus();
    });

    // miniaturas no chat: clique seleciona para ajustar; lápis abre no editor
    $("#chat").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-chat-id]");
      if (!b) return;
      const it = S.resultados.find((r) => String(r.id) === b.dataset.chatId);
      if (!it) return;
      if (ev.target.closest("[data-chat-editar]")) return abrirNoEditor(it);
      definirFoco(it);
      txt.focus();
    });

    // os pedidos ajustam a imagem selecionada (foco)
    atualizarAnexos();
  }

  function definirFoco(it) {
    S.foco = it;
    const box = $("#chat-foco");
    box.hidden = !it;
    if (it) $("img", box).src = it.url;
    $$("[data-chat-id]").forEach((b) => b.classList.toggle("foco", !!it && b.dataset.chatId === String(it.id)));
    $$(".cartao[data-id]", $("#resultados")).forEach((c) => c.classList.toggle("foco", !!it && c.dataset.id === String(it.id)));
    $("#prompt").placeholder = it ? "Peça um ajuste: “fundo mais claro”, “mais pessoas”…" : "Descreva a imagem ou peça um ajuste…";
  }

  // mostra acima do campo o que vai junto com o próximo pedido
  function atualizarAnexos() {
    const box = $("#chat-anexos");
    const itens = [];
    if (S.base && !S.foco) itens.push(`<span class="anexo"><img src="${esc(S.base)}" alt="">Imagem de partida</span>`);
    if (S.fotos.length) itens.push(`<span class="anexo">${S.fotos.map((f) => `<img src="${esc(f.url)}" alt="">`).join("")}${S.fotos.length} foto${S.fotos.length > 1 ? "s" : ""} de pessoa${S.fotos.length > 1 ? "s" : ""}</span>`);
    box.innerHTML = itens.join("");
    box.hidden = !itens.length;
  }

  function addMsg(html, classe) {
    $("#chat-vazio").hidden = true;
    $("#nova-conversa").hidden = false;
    const m = document.createElement("div");
    m.className = "msg " + classe;
    m.innerHTML = html;
    $("#chat").appendChild(m);
    m.scrollIntoView({ block: "end", behavior: "smooth" });
    return m;
  }

  function miniaturasChat(itens) {
    return `<div class="msg-imagens">${itens.map((it) => `
      <button type="button" class="msg-img" data-chat-id="${esc(it.id)}" title="Selecionar para ajustar">
        <img src="${esc(it.url)}" alt="" crossorigin="anonymous">
        <span class="msg-img-editar" data-chat-editar title="Abrir no editor" aria-label="Abrir no editor">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </span>
      </button>`).join("")}</div>`;
  }

  // ================================================================ opções (direita)
  function montarOpcoes() {
    const ativos = S.estilos.filter((e) => e.ativo !== false);
    $("#estilos").innerHTML = ativos.length
      ? ativos.map((e) => `<button type="button" role="radio" class="chip ${S.estilo && S.estilo.id === e.id ? "on" : ""}" aria-checked="${S.estilo && S.estilo.id === e.id}" data-id="${e.id}" title="${esc(e.instrucao)}">${esc(e.nome)}</button>`).join("")
      : `<p class="ajuda">Nenhum estilo cadastrado. A IA segue só o manual da marca.</p>`;
    $("#estilos").addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      S.estilo = S.estilos.find((e) => e.id === b.dataset.id);
      $$(".chip", $("#estilos")).forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-checked", c === b); });
    });

    $("#formatos").innerHTML = FORMATOS.map((f) => cartaoFormato(f, f.id === S.formato.id)).join("");
    $("#formatos").addEventListener("click", (ev) => {
      const b = ev.target.closest(".formato");
      if (!b) return;
      S.formato = FORMATOS.find((f) => f.id === b.dataset.id);
      $$(".formato", $("#formatos")).forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-checked", c === b); });
      if (S.foco) toast("O novo formato vale para a próxima imagem nova. Ajustes mantêm o formato da imagem selecionada.", "info", 5000);
    });

    $("#quantidade").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      S.quantidade = Number(b.dataset.q);
      $$("button", $("#quantidade")).forEach((x) => x.classList.toggle("on", x === b));
    });

    // imagem de partida
    const soltar = $("#soltar-base");
    const usarBase = async (file) => {
      if (!file || !file.type.startsWith("image/")) return toast("Escolha um arquivo de imagem.", "erro");
      S.base = await arquivoParaDataURL(file);
      $("#base-previa img").src = S.base;
      $("#base-previa").hidden = false;
      soltar.hidden = true;
      atualizarAnexos();
      if (S.foco) toast("Para partir desta imagem, tire a seleção da imagem em ajuste no chat (×).", "info", 6000);
    };
    $("#arquivo-base").addEventListener("change", (ev) => usarBase(ev.target.files[0]));
    ligarSoltar(soltar, (files) => usarBase(files[0]));
    $("#remover-base").addEventListener("click", () => {
      S.base = null; $("#base-previa").hidden = true; soltar.hidden = false; $("#arquivo-base").value = "";
      atualizarAnexos();
    });

    // fotos de pessoas
    const addFotos = async (files) => {
      const imgs = [...files].filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return toast("Escolha arquivos de imagem.", "erro");
      const livre = MAX_FOTOS - S.fotos.length;
      if (livre <= 0) return toast(`Use no máximo ${MAX_FOTOS} fotos de pessoas.`, "erro");
      if (imgs.length > livre) toast(`Só cabem mais ${livre} foto(s). As demais foram ignoradas.`, "aviso");
      for (const f of imgs.slice(0, livre)) S.fotos.push({ id: uid(), url: await arquivoParaDataURL(f) });
      desenharFotos();
    };
    $("#arquivo-pessoas").addEventListener("change", (ev) => { addFotos(ev.target.files); ev.target.value = ""; });
    ligarSoltar($("#soltar-pessoas"), addFotos);
    $("#fotos-pessoas").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-remover-foto]");
      if (!b) return;
      S.fotos = S.fotos.filter((f) => f.id !== b.dataset.removerFoto);
      desenharFotos();
    });

    $$("#palco-topo .aba").forEach((b) => b.addEventListener("click", () => mostrarAba(b.dataset.aba)));

    $("#abrir-local").addEventListener("change", async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const url = await arquivoParaDataURL(f);
      abrirNoEditor({ id: "local-" + Date.now(), url, formato: null, prompt: f.name.replace(/\.[^.]+$/, "") });
      ev.target.value = "";
    });
  }

  function desenharFotos() {
    $("#fotos-pessoas").innerHTML = S.fotos.map((f) => `
      <span class="foto-pessoa"><img src="${esc(f.url)}" alt="Foto de pessoa">
        <button type="button" data-remover-foto="${f.id}" aria-label="Remover foto">×</button></span>`).join("");
    $("#soltar-pessoas").hidden = S.fotos.length >= MAX_FOTOS;
    atualizarAnexos();
  }

  function ligarSoltar(el, aoSoltar) {
    el.addEventListener("dragover", (ev) => { ev.preventDefault(); el.classList.add("sobre"); });
    el.addEventListener("dragleave", () => el.classList.remove("sobre"));
    el.addEventListener("drop", (ev) => { ev.preventDefault(); el.classList.remove("sobre"); aoSoltar(ev.dataTransfer.files); });
  }

  function atualizarAvisoConta() {
    const el = $("#aviso-conta");
    if (!el) return;
    const m = S.marca || {};
    if (S.conta) {
      el.innerHTML = `Suas artes ficam salvas em <button type="button" class="link-sutil" data-ir="galeria">Minhas criações</button>.`;
    } else if (S.sessao) {
      el.innerHTML = `Sua conta não usa um e-mail ${esc(API.dominiosDe(m).map((d) => "@" + d).join(" ou "))}, então as artes não são salvas.`;
    } else {
      el.innerHTML = `Sem login: até ${m.anon_hora ?? 10} imagens por hora e ${m.anon_dia ?? 20} por dia, sem salvar. <button type="button" class="link-sutil" data-ir="entrar">Entrar</button> ou <button type="button" class="link-sutil" data-ir="criar">criar conta</button>.`;
    }
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ir]");
    if (!b) return;
    if (b.dataset.ir === "galeria") mostrarAba("galeria");
    if (b.dataset.ir === "entrar") abrirLogin("entrar");
    if (b.dataset.ir === "criar") abrirLogin("criar");
  });

  function cartaoFormato(f, on) {
    const k = 26 / Math.max(f.w, f.h);
    return `<button type="button" role="radio" aria-checked="${on}" class="formato ${on ? "on" : ""}" data-id="${f.id}">
      <span class="forma" style="width:${Math.max(8, Math.round(f.w * k))}px;height:${Math.max(8, Math.round(f.h * k))}px"></span>
      <span class="formato-nome">${esc(f.nome)}</span>
      <span class="formato-px">${f.w}×${f.h}</span>
    </button>`;
  }

  // painel direito: "opcoes" (criar), "ferramentas" (editor) ou "template"
  function painelDireito(qual) {
    $("#opcoes").hidden = qual !== "opcoes";
    $("#ferramentas").hidden = qual !== "ferramentas";
    $("#painel-template").hidden = qual !== "template";
    $(".area").classList.toggle("editando", qual !== "opcoes");
  }

  function mostrarAba(aba) {
    $$("#palco-topo .aba").forEach((b) => { const on = b.dataset.aba === aba; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    fecharEditor(false);
    fecharTemplate(false);
    $("#resultados").hidden = aba !== "resultados";
    $("#galeria").hidden = aba !== "galeria";
    $("#templates").hidden = aba !== "templates";
    if (aba === "galeria") carregarGaleria();
    if (aba === "templates") carregarTemplates();
  }

  function abaAtual() {
    const b = $("#palco-topo .aba.on");
    return b ? b.dataset.aba : "resultados";
  }

  // ================================================================ gerar
  async function gerar() {
    if (S.gerando) return;
    const txt = $("#prompt");
    const prompt = txt.value.trim();
    const refinar = !!S.foco;
    if (!prompt && !refinar && !S.base && !S.fotos.length) { toast("Descreva o que você quer criar.", "erro"); txt.focus(); return; }
    if (!prompt && refinar) { toast("Diga o que você quer ajustar na imagem selecionada.", "erro"); txt.focus(); return; }
    S.gerando = true;
    const btn = $("#gerar");
    btn.disabled = true;
    btn.classList.add("carregando");
    btn.querySelector(".txt").textContent = S.quantidade > 1 ? `Gerando ${S.quantidade} variações…` : "Gerando…";

    const formato = refinar && S.foco.formato ? S.foco.formato : S.formato;
    const foco = S.foco;
    const usaBase = !refinar && S.base;
    const historicoAntes = [...S.historico];

    // mensagem da pessoa no chat
    const anexos = [];
    if (refinar) anexos.push(`<img src="${esc(foco.url)}" alt="" title="Imagem em ajuste">`);
    if (usaBase) anexos.push(`<img src="${esc(S.base)}" alt="" title="Imagem de partida">`);
    S.fotos.forEach((f) => anexos.push(`<img src="${esc(f.url)}" alt="" title="Foto de pessoa">`));
    addMsg(`${anexos.length ? `<div class="msg-anexos">${anexos.join("")}</div>` : ""}<p>${esc(prompt || "Criar a partir das imagens enviadas")}</p>`, "msg-eu");
    const resposta = addMsg(`<p class="msg-status"><span class="ponto-carregando"></span>${refinar ? "Ajustando a imagem…" : S.quantidade > 1 ? `Criando ${S.quantidade} variações…` : "Criando a imagem…"}</p>`, "msg-ia");
    txt.value = ""; txt.style.height = "";

    mostrarAba("resultados");
    $("#vazio")?.remove();
    const lote = document.createElement("div");
    lote.className = "lote";
    lote.innerHTML = `<div class="lote-topo"><p class="lote-prompt">${refinar ? '<span class="tag-ajuste">Ajuste</span> ' : ""}${esc(prompt || "A partir das imagens enviadas")}</p><span class="lote-meta">${esc(formato.nome)}${S.estilo ? " · " + esc(S.estilo.nome) : ""}</span></div>
      <div class="lote-grade">${Array.from({ length: S.quantidade }, () => `<div class="cartao carregando" style="aspect-ratio:${proporcaoCss(formato.prop)}"><span class="pulso"></span></div>`).join("")}</div>`;
    $("#resultados").prepend(lote);

    try {
      const base = refinar ? await reduzirParaBase64(foco.url) : usaBase ? await reduzirParaBase64(S.base) : null;
      const fotos = await Promise.all(S.fotos.map((f) => reduzirParaBase64(f.url, 1024)));
      const r = await API.gerar({
        prompt,
        historico: historicoAntes,
        estilo_id: S.estilo?.id || null,
        estilo_nome: S.estilo?.nome || "",
        proporcao: formato.prop,
        formato: formato.id,
        quantidade: S.quantidade,
        base,
        base_tipo: refinar ? "refinar" : "partir",
        fotos,
      });
      const itens = r.imagens.map((im) => ({ ...im, formato, prompt }));
      S.resultados.unshift(...itens);
      if (prompt) S.historico.push(prompt);
      $(".lote-grade", lote).innerHTML = itens.map((it) => cartaoResultado(it, formato)).join("");
      $(".lote-meta", lote).insertAdjacentHTML("beforeend", r.salvo
        ? ` · <span class="selo-salvo">Salvo</span>`
        : ` · <span class="selo-nao-salvo" title="Baixe agora ou entre na sua conta para salvar as próximas">Não salvo</span>`);
      resposta.innerHTML = `<p>${itens.length > 1 ? `Pronto, ${itens.length} variações.` : "Pronto."} ${itens.length > 1 ? "Escolha uma" : "Continue"} e peça ajustes aqui, ou clique no lápis para abrir no editor.</p>${miniaturasChat(itens)}`;
      definirFoco(itens[0]);
      if (typeof r.restante_hora === "number" && !r.salvo && r.restante_hora <= 3) {
        toast(r.restante_hora > 0 ? `Sem login, você ainda pode gerar ${r.restante_hora} imagem(ns) nesta hora.` : "Você usou o limite desta hora sem login. Entre na sua conta para gerar mais.", "aviso", 6000);
      }
      if (r.erros && r.erros.length) toast(`${r.erros.length} variação(ões) falharam: ${r.erros[0]}`, "aviso", 7000);
    } catch (e) {
      $(".lote-grade", lote).innerHTML = `<div class="erro-lote">${esc(e.message)}</div>`;
      resposta.classList.add("msg-erro");
      resposta.innerHTML = `<p>${esc(e.message)}</p>`;
      if (prompt) { txt.value = prompt; }
    } finally {
      S.gerando = false;
      btn.disabled = false;
      btn.classList.remove("carregando");
      btn.querySelector(".txt").textContent = "Gerar imagens";
      resposta.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }

  function proporcaoCss(prop) { const [a, b] = prop.split(":"); return `${a} / ${b}`; }

  function cartaoResultado(it, formato) {
    return `<figure class="cartao" data-id="${esc(it.id)}">
      <img src="${esc(it.url)}" alt="${esc(it.prompt || "Imagem gerada")}" loading="lazy" crossorigin="anonymous" style="aspect-ratio:${proporcaoCss(formato.prop)}">
      <figcaption>
        <button type="button" class="btn btn-sm btn-primario" data-acao="editar">Editar</button>
        <button type="button" class="btn btn-sm btn-claro" data-acao="ajustar">Ajustar no chat</button>
        <button type="button" class="btn btn-sm btn-claro" data-acao="baixar-original">Baixar</button>
      </figcaption>
    </figure>`;
  }

  $("#resultados").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-acao]");
    const card = ev.target.closest(".cartao[data-id]");
    if (!card) return;
    const it = S.resultados.find((r) => String(r.id) === card.dataset.id);
    if (!it) return;
    if (b && b.dataset.acao === "baixar-original") return baixarUrl(it.url, nomeBase(it) + ".jpg");
    if (b && b.dataset.acao === "ajustar") { definirFoco(it); $("#prompt").focus(); return; }
    abrirNoEditor(it);
  });

  // ================================================================ galeria
  async function carregarGaleria() {
    const g = $("#galeria");
    if (!S.conta) {
      g.innerHTML = `<div class="vazio">
        <div class="vazio-icone" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="17" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M8 42c3-8 9-12 16-12s13 4 16 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div>
        <h3>${S.sessao ? "Esta conta não salva artes" : "Entre para salvar suas criações"}</h3>
        <p>${S.sessao
          ? `As artes ficam salvas só para contas com e-mail ${esc(API.dominiosDe(S.marca).map((d) => "@" + d).join(" ou "))}.`
          : "Sem login você pode criar e baixar normalmente, mas nada fica guardado. Com uma conta, tudo o que você gerar aparece aqui."}</p>
        ${S.sessao ? "" : `<div class="linha-botoes" style="justify-content:center"><button type="button" class="btn btn-primario" data-ir="entrar">Entrar</button><button type="button" class="btn btn-ghost" data-ir="criar">Criar conta</button></div>`}
      </div>`;
      return;
    }
    g.innerHTML = `<p class="ajuda">Carregando…</p>`;
    try {
      const lista = await API.historico();
      S.galeria = lista;
      if (!lista.length) { g.innerHTML = `<div class="vazio"><h3>Nada por aqui ainda</h3><p>Tudo o que você gerar com sua conta fica guardado aqui.</p></div>`; return; }
      g.innerHTML = `<div class="galeria-grade">${lista.map((it) => `
        <figure class="cartao" data-gid="${esc(it.id)}">
          <img src="${esc(it.url)}" alt="${esc(it.prompt || "")}" loading="lazy" crossorigin="anonymous">
          <figcaption>
            <span class="g-prompt" title="${esc(it.prompt || "")}">${esc(it.prompt || "Sem descrição")}</span>
            <span class="g-data">${new Date(it.criado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span class="g-acoes">
              <button type="button" class="btn btn-sm btn-primario" data-acao="editar">Editar</button>
              <button type="button" class="btn btn-sm btn-ghost" data-acao="ajustar">Ajustar no chat</button>
              <button type="button" class="icone" data-acao="apagar" title="Apagar" aria-label="Apagar">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
              </button>
            </span>
          </figcaption>
        </figure>`).join("")}</div>`;
    } catch (e) {
      g.innerHTML = `<div class="erro-lote">${esc(e.message)}</div>`;
    }
  }

  $("#galeria").addEventListener("click", async (ev) => {
    const card = ev.target.closest("[data-gid]");
    if (!card) return;
    const it = (S.galeria || []).find((x) => String(x.id) === card.dataset.gid);
    if (!it) return;
    const b = ev.target.closest("[data-acao]");
    if (b && b.dataset.acao === "apagar") {
      if (!confirm("Apagar esta arte da sua conta? Não dá para desfazer.")) return;
      try { await API.apagarGeracao(it); card.remove(); toast("Arte apagada.", "ok"); } catch (e) { toast(e.message, "erro"); }
      return;
    }
    const formato = FORMATOS.find((f) => f.id === it.formato) || null;
    const item = { ...it, formato };
    if (b && b.dataset.acao === "ajustar") {
      if (!S.resultados.some((r) => r.id === item.id)) S.resultados.push(item);
      definirFoco(item); $("#prompt").focus(); return;
    }
    abrirNoEditor(item);
  });

  // ================================================================ editor
  async function abrirNoEditor(it, { semLogo = false } = {}) {
    fecharTemplate(false);
    S.aberto = it;
    $("#resultados").hidden = true;
    $("#galeria").hidden = true;
    $("#templates").hidden = true;
    $("#editor").hidden = false;
    $("#palco-topo").hidden = true;
    painelDireito("ferramentas");
    if (window.innerWidth <= 900) window.scrollTo({ top: 0 });
    try {
      ed.textos = [];
      ed.sel = null;
      await ed.carregar(it.url, it.formato);
      if (semLogo) ed.logo = { ...ed.logo, id: null }; else aplicarLogoPadrao();
      ed.marcar();
      ed.historico = [ed.historico[ed.historico.length - 1]];
      $("#exp-nome").value = nomeBase(it);
      $(".refinar").hidden = !!it.semIA;
      sincronizarFerramentas();
      aoSelecionar(null);
      mostrarFerr("formato");
    } catch (e) {
      toast(e.message, "erro");
      fecharEditor(true);
    }
  }

  function fecharEditor(voltar = true) {
    if ($("#editor").hidden) return;
    if (ed.modo === "recorte") cancelarRecorte();
    $("#editor").hidden = true;
    $("#palco-topo").hidden = false;
    painelDireito("opcoes");
    const veioDeTemplate = S.aberto && S.aberto.deTemplate;
    S.aberto = null;
    if (voltar) {
      const aba = abaAtual();
      $("#resultados").hidden = aba !== "resultados";
      $("#galeria").hidden = aba !== "galeria";
      $("#templates").hidden = aba !== "templates";
      if (veioDeTemplate && S.tpl) reabrirTemplate();
    }
  }
  $("#voltar").addEventListener("click", () => fecharEditor(true));


  function nomeBase(it) {
    const limpar = (t, max) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max);
    const slug = limpar(it.prompt, 40) || "criadigi";
    const f = it.formato ? limpar(it.formato.nome, 24) : "";
    return `criadigi-${slug}${f ? "-" + f : ""}`;
  }

  // logos da marca
  function logosAtivos() { return S.arquivos.filter((a) => a.tipo === "logo" && a.ativo !== false); }

  function carregarLogos() {
    for (const l of logosAtivos()) {
      carregarImagem(l.url).then((img) => { ed.registrarLogo(l.id, img); ed.desenhar(); })
        .catch(() => console.warn("Logo não carregou", l.nome));
    }
  }

  function aplicarLogoPadrao() {
    const logos = logosAtivos();
    const padrao = logos.find((l) => l.id === S.marca?.logo_padrao) || logos.find((l) => l.variante === "principal") || logos[0];
    ed.logo = {
      id: padrao ? padrao.id : null,
      pos: S.marca?.logo_posicao || "inf-dir",
      tamanho: S.marca?.logo_tamanho || 16,
      x: null, y: null,
    };
    ed.desenhar();
  }

  // ---------------------------------------------------------------- ferramentas
  function mostrarFerr(nome) {
    $$(".abas-ferr .aba").forEach((b) => { const on = b.dataset.ferr === nome; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $$(".ferr").forEach((s) => { s.hidden = s.dataset.ferr !== nome; });
    if (nome === "exportar") atualizarResumoExport();
  }

  function swatches(container, { comNenhum = false, selecionada = null } = {}) {
    container.innerHTML = (comNenhum ? `<button type="button" class="amostra nenhuma ${!selecionada ? "on" : ""}" data-hex="" title="Nenhum" aria-label="Nenhum"></button>` : "")
      + S.cores.map((c) => `<button type="button" class="amostra ${selecionada && selecionada.toUpperCase() === c.hex.toUpperCase() ? "on" : ""}" data-hex="${c.hex}" style="--c:${c.hex}" title="${esc(c.nome)} ${c.hex}" aria-label="${esc(c.nome)}"></button>`).join("");
  }

  function marcarSwatch(container, hex) {
    $$(".amostra", container).forEach((b) => b.classList.toggle("on", (b.dataset.hex || "").toUpperCase() === (hex || "").toUpperCase()));
  }

  function montarFerramentas() {
    $$(".abas-ferr .aba").forEach((b) => b.addEventListener("click", () => mostrarFerr(b.dataset.ferr)));

    // ---- formato
    $("#ed-formatos").innerHTML = FORMATOS.map((f) => `<button type="button" class="item-formato" data-id="${f.id}"><span>${esc(f.nome)}</span><small>${f.w}×${f.h}</small></button>`).join("");
    $("#ed-formatos").addEventListener("click", (ev) => {
      const b = ev.target.closest(".item-formato");
      if (!b) return;
      const f = FORMATOS.find((x) => x.id === b.dataset.id);
      ed.definirFormato(f.w, f.h);
      if (S.aberto) { S.aberto.formato = f; $("#exp-nome").value = nomeBase(S.aberto); }
    });
    const larg = $("#ed-larg"), alt = $("#ed-alt");
    larg.addEventListener("input", () => { if (S.trava && larg.value) alt.value = Math.round(larg.value * ed.out.h / ed.out.w); });
    alt.addEventListener("input", () => { if (S.trava && alt.value) larg.value = Math.round(alt.value * ed.out.w / ed.out.h); });
    $("#ed-trava").addEventListener("click", (ev) => {
      S.trava = !S.trava;
      ev.currentTarget.classList.toggle("on", S.trava);
      ev.currentTarget.setAttribute("aria-pressed", S.trava);
    });
    $("#ed-redimensionar").addEventListener("click", () => {
      const w = Number(larg.value), h = Number(alt.value);
      if (!w || !h) return toast("Informe largura e altura.", "erro");
      ed.redimensionar(w, h);
      toast(`Imagem redimensionada para ${ed.out.w}×${ed.out.h}.`, "ok");
    });
    $$("[data-girar]").forEach((b) => b.addEventListener("click", () => ed.girar(Number(b.dataset.girar))));
    $$("[data-espelhar]").forEach((b) => b.addEventListener("click", () => ed.espelhar(b.dataset.espelhar)));

    // ---- recorte
    $("#ed-recortar").addEventListener("click", iniciarRecorte);
    $("#cancelar-recorte").addEventListener("click", cancelarRecorte);
    $("#aplicar-recorte").addEventListener("click", () => {
      ed.aplicarRecorte();
      $("#barra-recorte").hidden = true;
      $("#ferramentas").classList.remove("bloqueado");
    });
    $("#razoes-recorte").addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      $$(".chip", $("#razoes-recorte")).forEach((c) => c.classList.toggle("on", c === b));
      ed.definirRazaoRecorte(Number(b.dataset.r) || null);
    });

    // ---- ajustes
    $$("[data-adj]").forEach((inp) => {
      inp.addEventListener("input", () => {
        ed.adj[inp.dataset.adj] = Number(inp.value);
        inp.previousElementSibling.value = inp.value;
        ed.sujarBase();
      });
      inp.addEventListener("change", () => ed.marcar());
    });
    swatches($("#filtro-cores"), { comNenhum: true });
    $("#filtro-cores").addEventListener("click", (ev) => {
      const b = ev.target.closest(".amostra");
      if (!b) return;
      ed.filtro.cor = b.dataset.hex || null;
      if (ed.filtro.cor && !ed.filtro.forca) { ed.filtro.forca = 35; }
      marcarSwatch($("#filtro-cores"), ed.filtro.cor);
      ed.sujarBase(); ed.marcar(); sincronizarFerramentas();
    });
    ligarDeslizador($("#filtro-forca"), (v) => { ed.filtro.forca = v; if (!ed.filtro.cor && v) { ed.filtro.cor = (S.cores[0] || {}).hex || "#EA0356"; marcarSwatch($("#filtro-cores"), ed.filtro.cor); } ed.sujarBase(); });

    swatches($("#degrade-cores"));
    $("#degrade-cores").addEventListener("click", (ev) => {
      const b = ev.target.closest(".amostra");
      if (!b) return;
      ed.degrade.cor = b.dataset.hex;
      if (!ed.degrade.forca) ed.degrade.forca = 70;
      marcarSwatch($("#degrade-cores"), ed.degrade.cor);
      ed.sujarBase(); ed.marcar(); sincronizarFerramentas();
    });
    ligarDeslizador($("#degrade-forca"), (v) => { ed.degrade.forca = v; ed.sujarBase(); });
    $("#degrade-lado").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      ed.degrade.lado = b.dataset.lado;
      if (!ed.degrade.forca) ed.degrade.forca = 70;
      ed.sujarBase(); ed.marcar(); sincronizarFerramentas();
    });
    $("#zerar-ajustes").addEventListener("click", () => {
      ed.adj = { brilho: 0, contraste: 0, saturacao: 0, calor: 0 };
      ed.filtro = { cor: null, forca: 0 };
      ed.degrade = { ...ed.degrade, forca: 0 };
      ed.sujarBase(); ed.marcar(); sincronizarFerramentas();
    });

    // ---- texto
    const fontes = fontesDisponiveis();
    $("#tx-fonte").innerHTML = fontes.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    swatches($("#tx-cores"));
    swatches($("#tx-fundos"), { comNenhum: true });
    $$("[data-novo-texto]").forEach((b) => b.addEventListener("click", () => novoTexto(b.dataset.novoTexto)));
    $("#tx-texto").addEventListener("input", (ev) => editarTexto({ texto: ev.target.value }, false));
    $("#tx-texto").addEventListener("change", () => ed.marcar());
    $("#tx-fonte").addEventListener("change", (ev) => editarTexto({ fonte: ev.target.value }));
    $("#tx-peso").addEventListener("change", (ev) => editarTexto({ peso: Number(ev.target.value) }));
    $("#tx-caixa").addEventListener("change", (ev) => editarTexto({ caixaAlta: ev.target.checked }));
    ligarDeslizador($("#tx-tamanho"), (v) => editarTexto({ tamanho: v }, false), (v) => v.toFixed(1));
    ligarDeslizador($("#tx-largura"), (v) => editarTexto({ largura: v / 100 }, false), (v) => v + "%");
    $("#tx-cores").addEventListener("click", (ev) => { const b = ev.target.closest(".amostra"); if (b) editarTexto({ cor: b.dataset.hex }); });
    $("#tx-fundos").addEventListener("click", (ev) => { const b = ev.target.closest(".amostra"); if (b) editarTexto({ fundo: b.dataset.hex || null }); });
    $("#tx-alinhar").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) editarTexto({ alinhar: b.dataset.al }); });
    $("#tx-posicao").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      const t = ed.textoSelecionado();
      if (!b || !t) return;
      const c = t._caixa;
      const altura = c ? (c.y1 - c.y0) / ed.out.h : 0.1;
      const y = b.dataset.y === "topo" ? 0.07 : b.dataset.y === "meio" ? 0.5 - altura / 2 : 0.93 - altura;
      editarTexto({ y });
    });
    $("#tx-remover").addEventListener("click", () => ed.removerSelecionado());
    $("#camadas-texto").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-tid]");
      if (!b) return;
      ed.sel = b.dataset.tid; ed.desenhar(); aoSelecionar(ed.sel);
    });

    // ---- logo
    montarEscolhaLogo();
    $("#logo-pos").innerHTML = POSICOES.map((p) => `<button type="button" data-pos="${p}" aria-label="${p.replace("-", " ")}"><i></i></button>`).join("");
    $("#logo-pos").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      ed.logo.pos = b.dataset.pos; ed.logo.x = null; ed.logo.y = null;
      ed.marcar(); ed.desenhar(); sincronizarFerramentas();
    });
    ligarDeslizador($("#logo-tamanho"), (v) => { ed.logo.tamanho = v; ed.desenhar(); }, (v) => v + "%");

    // ---- exportar
    $("#exp-tipo").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      S.exp.tipo = b.dataset.tipo;
      $$("button", $("#exp-tipo")).forEach((x) => x.classList.toggle("on", x === b));
      $("#exp-qualidade-wrap").hidden = S.exp.tipo === "image/png";
      atualizarResumoExport();
    });
    const q = $("#exp-qualidade");
    q.addEventListener("input", () => { S.exp.qualidade = q.value / 100; q.previousElementSibling.value = q.value; });
    $("#baixar").addEventListener("click", async () => {
      try {
        const blob = await ed.exportar(S.exp.tipo, S.exp.qualidade);
        const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[S.exp.tipo];
        baixarBlob(blob, ($("#exp-nome").value.trim() || "criadigi") + "." + ext);
      } catch (e) { toast(e.message, "erro"); }
    });
    $("#copiar").addEventListener("click", async () => {
      try {
        const blob = await ed.exportar("image/png");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Imagem copiada. Cole onde quiser.", "ok");
      } catch (e) { toast("Seu navegador não permitiu copiar. Use o botão Baixar.", "erro"); }
    });

    // ---- refinar com IA
    $("#refinar").addEventListener("click", refinar);
    $("#refinar-texto").addEventListener("keydown", (ev) => { if (ev.key === "Enter") refinar(); });

    // ---- desfazer
    $("#desfazer").addEventListener("click", () => ed.desfazer());
    $("#refazer").addEventListener("click", () => ed.refazer());
  }

  function ligarDeslizador(inp, aoMudar, formatar = (v) => String(v)) {
    inp.addEventListener("input", () => {
      const v = Number(inp.value);
      inp.previousElementSibling.value = formatar(v);
      aoMudar(v);
    });
    inp.addEventListener("change", () => ed.marcar());
  }

  function fontesDisponiveis() {
    const nomes = [...new Set(S.arquivos.filter((a) => a.tipo === "fonte" && a.ativo !== false).map((a) => a.nome))];
    if (!nomes.includes("Hanken Grotesk")) nomes.push("Hanken Grotesk");
    return nomes;
  }

  function fontePara(papel) {
    const f = S.arquivos.find((a) => a.tipo === "fonte" && a.ativo !== false && a.variante === papel)
      || S.arquivos.find((a) => a.tipo === "fonte" && a.ativo !== false);
    return f ? f.nome : "Hanken Grotesk";
  }

  function corDoPapel(papel, alternativa) {
    const c = S.cores.find((x) => x.papel === papel);
    return c ? c.hex : alternativa;
  }

  function corClara() {
    const c = S.cores.find((x) => x.hex.toUpperCase() === "#FFFFFF") || S.cores.filter((x) => lum(x.hex) > 0.8)[0];
    return c ? c.hex : "#FFFFFF";
  }

  function novoTexto(tipo) {
    const claro = corClara();
    const presets = {
      titulo: { texto: "Título da campanha", fonte: fontePara("titulo"), peso: 800, tamanho: 8.5, cor: claro, x: 0.07, y: 0.6, largura: 0.82 },
      subtitulo: { texto: "Uma frase de apoio curta e direta", fonte: fontePara("texto"), peso: 500, tamanho: 4, cor: claro, x: 0.07, y: 0.78, largura: 0.7 },
      chamada: { texto: "Participe", fonte: fontePara("titulo"), peso: 700, tamanho: 3.6, cor: claro, fundo: corDoPapel("principal", "#EA0356"), x: 0.08, y: 0.88, largura: 0.6, caixaAlta: true },
    };
    ed.adicionarTexto(presets[tipo]);
    setTimeout(() => { $("#tx-texto").focus(); $("#tx-texto").select(); }, 30);
  }

  function editarTexto(patch, registrar = true) {
    const t = ed.textoSelecionado();
    if (!t) return;
    Object.assign(t, patch);
    ed.desenhar();
    if (registrar) ed.marcar();
    sincronizarTexto();
  }

  function aoSelecionar(sel) {
    if (sel === "logo") mostrarFerr("logo");
    else if (sel) mostrarFerr("texto");
    sincronizarTexto();
    sincronizarFerramentas();
  }

  function sincronizarTexto() {
    const lista = $("#camadas-texto");
    lista.innerHTML = ed.textos.length
      ? ed.textos.map((t) => `<button type="button" class="camada ${ed.sel === t.id ? "on" : ""}" data-tid="${t.id}">${esc(t.texto.split("\n")[0] || "(vazio)")}</button>`).join("")
      : `<p class="ajuda">Adicione um título, subtítulo ou chamada. Os textos usam as fontes e cores da marca.</p>`;
    const t = ed.textoSelecionado();
    $("#props-texto").hidden = !t;
    if (!t) return;
    if (document.activeElement !== $("#tx-texto")) $("#tx-texto").value = t.texto;
    $("#tx-fonte").value = t.fonte;
    $("#tx-peso").value = String(t.peso);
    $("#tx-caixa").checked = !!t.caixaAlta;
    $("#tx-tamanho").value = t.tamanho; $("#tx-tamanho").previousElementSibling.value = Number(t.tamanho).toFixed(1);
    $("#tx-largura").value = Math.round(t.largura * 100); $("#tx-largura").previousElementSibling.value = Math.round(t.largura * 100) + "%";
    marcarSwatch($("#tx-cores"), t.cor);
    marcarSwatch($("#tx-fundos"), t.fundo || "");
    $$("button", $("#tx-alinhar")).forEach((b) => b.classList.toggle("on", b.dataset.al === t.alinhar));
  }

  function montarEscolhaLogo() {
    const logos = logosAtivos();
    const box = $("#logos-escolha");
    if (!logos.length) {
      box.innerHTML = `<p class="ajuda">Nenhuma logo cadastrada. O admin cadastra as versões da logo no painel.</p>`;
      $("#props-logo").hidden = true;
      return;
    }
    box.innerHTML = `<button type="button" class="logo-op" data-lid=""><span>Sem logo</span></button>`
      + logos.map((l) => `<button type="button" class="logo-op ${l.variante === "negativa" ? "escuro" : ""}" data-lid="${l.id}" title="${esc(l.nome)}"><img src="${esc(l.url)}" alt="${esc(l.nome)}" crossorigin="anonymous"></button>`).join("");
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest(".logo-op");
      if (!b) return;
      ed.logo.id = b.dataset.lid || null;
      ed.marcar(); ed.desenhar(); sincronizarFerramentas();
    });
  }

  function sincronizarFerramentas() {
    if (!ed) return;
    // barra
    $("#desfazer").disabled = !ed.podeDesfazer;
    $("#refazer").disabled = !ed.podeRefazer;
    $("#editor-info").textContent = ed.temImagem ? `${ed.out.w} × ${ed.out.h} px` : "";
    // formato
    const ativo = FORMATOS.find((f) => f.w === ed.out.w && f.h === ed.out.h);
    $$(".item-formato").forEach((b) => b.classList.toggle("on", !!ativo && b.dataset.id === ativo.id));
    if (document.activeElement !== $("#ed-larg") && document.activeElement !== $("#ed-alt")) {
      $("#ed-larg").value = ed.out.w; $("#ed-alt").value = ed.out.h;
    }
    // ajustes
    $$("[data-adj]").forEach((inp) => { inp.value = ed.adj[inp.dataset.adj]; inp.previousElementSibling.value = inp.value; });
    marcarSwatch($("#filtro-cores"), ed.filtro.cor || "");
    $("#filtro-forca").value = ed.filtro.forca; $("#filtro-forca").previousElementSibling.value = ed.filtro.forca;
    marcarSwatch($("#degrade-cores"), ed.degrade.forca ? ed.degrade.cor : "");
    $("#degrade-forca").value = ed.degrade.forca; $("#degrade-forca").previousElementSibling.value = ed.degrade.forca;
    $$("button", $("#degrade-lado")).forEach((b) => b.classList.toggle("on", b.dataset.lado === ed.degrade.lado));
    // logo
    $$(".logo-op").forEach((b) => b.classList.toggle("on", (b.dataset.lid || null) === (ed.logo.id || null)));
    $$("button", $("#logo-pos")).forEach((b) => b.classList.toggle("on", ed.logo.x == null && b.dataset.pos === ed.logo.pos));
    $("#logo-tamanho").value = ed.logo.tamanho; $("#logo-tamanho").previousElementSibling.value = ed.logo.tamanho + "%";
    $("#props-logo").classList.toggle("apagado", !ed.logo.id);
    sincronizarTexto();
    atualizarResumoExport();
  }

  function atualizarResumoExport() {
    if (!ed) return;
    const nome = { "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP" }[S.exp.tipo];
    $("#exp-resumo").textContent = `${nome} · ${ed.out.w} × ${ed.out.h} px`;
  }

  // ---------------------------------------------------------------- recorte
  function iniciarRecorte() {
    if (!ed.temImagem) return;
    const razaoAtual = ed.out.w / ed.out.h;
    const opcoes = [
      { r: razaoAtual, nome: "Formato atual" }, { r: 0, nome: "Livre" },
      { r: 1, nome: "1:1" }, { r: 4 / 5, nome: "4:5" }, { r: 9 / 16, nome: "9:16" }, { r: 16 / 9, nome: "16:9" },
    ];
    $("#razoes-recorte").innerHTML = opcoes.map((o, i) => `<button type="button" class="chip ${i === 0 ? "on" : ""}" data-r="${o.r}">${o.nome}</button>`).join("");
    $("#barra-recorte").hidden = false;
    $("#ferramentas").classList.add("bloqueado");
    ed.iniciarRecorte(razaoAtual);
  }

  function cancelarRecorte() {
    ed.cancelarRecorte();
    $("#barra-recorte").hidden = true;
    $("#ferramentas").classList.remove("bloqueado");
  }

  // ---------------------------------------------------------------- refinar
  async function refinar() {
    const pedido = $("#refinar-texto").value.trim();
    if (!pedido) { toast("Diga o que você quer mudar na imagem.", "erro"); $("#refinar-texto").focus(); return; }
    if (!S.aberto) return;
    const btn = $("#refinar");
    btn.disabled = true; btn.textContent = "Refinando…";
    $(".tela-wrap").classList.add("processando");
    try {
      const base = await reduzirParaBase64(S.aberto.url);
      const formato = S.aberto.formato || FORMATOS.reduce((m, f) => Math.abs(f.w / f.h - ed.out.w / ed.out.h) < Math.abs(m.w / m.h - ed.out.w / ed.out.h) ? f : m, FORMATOS[0]);
      const r = await API.gerar({
        prompt: pedido, estilo_id: S.estilo?.id || null, estilo_nome: S.estilo?.nome || "",
        proporcao: formato.prop, formato: formato.id, quantidade: 1, base, base_tipo: "refinar",
      });
      const nova = r.imagens[0];
      S.aberto = { ...S.aberto, id: nova.id, url: nova.url };
      S.resultados.unshift({ ...nova, formato, prompt: pedido });
      await ed.trocarBase(nova.url);
      $("#refinar-texto").value = "";
      toast("Imagem refinada. Seus textos e a logo foram mantidos.", "ok");
    } catch (e) {
      toast(e.message, "erro", 8000);
    } finally {
      btn.disabled = false; btn.textContent = "Refinar";
      $(".tela-wrap").classList.remove("processando");
    }
  }

  // ---------------------------------------------------------------- atalhos
  function ligarAtalhos() {
    document.addEventListener("keydown", (ev) => {
      if ($("#editor").hidden) return;
      const digitando = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !digitando) {
        ev.preventDefault();
        if (ev.shiftKey) ed.refazer(); else ed.desfazer();
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && !digitando && ed.sel) { ev.preventDefault(); ed.removerSelecionado(); }
      if (ev.key === "Escape" && ed.modo === "recorte") cancelarRecorte();
    });
  }

  // ---------------------------------------------------------------- downloads
  function baixarBlob(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function baixarUrl(url, nome) {
    try {
      const blob = await (await fetch(url)).blob();
      baixarBlob(blob, nome);
    } catch (_) { window.open(url, "_blank"); }
  }

  // ================================================================ templates
  // Artes prontas do admin: o usuário só edita os textos e coloca a foto.
  function montarTemplates() {
    $("#tpl-categorias").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-cat]");
      if (!b) return;
      S.categoria = b.dataset.cat;
      desenharListaTemplates();
    });
    $("#tpl-lista").addEventListener("click", (ev) => {
      const card = ev.target.closest("[data-tpl]");
      if (!card) return;
      const t = (S.templates || []).find((x) => String(x.id) === card.dataset.tpl);
      if (t) abrirTemplate(t);
    });
    $("#tpl-voltar").addEventListener("click", () => { fecharTemplate(true); });
    ligarArrasteTemplate();
  }

  async function carregarTemplates() {
    if (S.templates) return desenharListaTemplates();
    $("#tpl-lista").innerHTML = `<p class="ajuda">Carregando…</p>`;
    try {
      S.templates = await API.templates();
      desenharListaTemplates();
    } catch (e) {
      $("#tpl-lista").innerHTML = `<div class="erro-lote">${esc(e.message)}</div>`;
    }
  }

  function desenharListaTemplates() {
    const lista = S.templates || [];
    const cats = ["Todas", ...new Set(lista.map((t) => t.categoria || "Geral"))];
    if (!cats.includes(S.categoria)) S.categoria = "Todas";
    $("#tpl-categorias").innerHTML = lista.length > 1 && cats.length > 2
      ? cats.map((c) => `<button type="button" class="chip ${c === S.categoria ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("") : "";
    const vis = lista.filter((t) => S.categoria === "Todas" || (t.categoria || "Geral") === S.categoria);
    $("#tpl-lista").innerHTML = vis.length ? vis.map((t) => `
      <button type="button" class="tpl-cartao" data-tpl="${esc(t.id)}">
        <span class="tpl-thumb" style="aspect-ratio:${t.largura} / ${t.altura}"><img src="${esc(t.base_url)}" alt="" loading="lazy" crossorigin="anonymous"></span>
        <span class="tpl-nome">${esc(t.nome)}</span>
        <span class="tpl-meta">${esc(t.categoria || "Geral")} · ${t.largura}×${t.altura}</span>
      </button>`).join("")
      : `<div class="vazio"><h3>Nenhum template ainda</h3><p>O admin cadastra as artes prontas, como aniversários e comunicados. Elas aparecem aqui.</p></div>`;
  }

  async function abrirTemplate(t) {
    $("#templates").hidden = true;
    $("#palco-topo").hidden = true;
    $("#tpl-uso").hidden = false;
    painelDireito("template");
    $("#painel-template").innerHTML = `<p class="ajuda">Carregando o template…</p>`;
    $("#tpl-info").textContent = `${t.nome} · ${t.largura} × ${t.altura} px`;
    if (window.innerWidth <= 900) window.scrollTo({ top: 0 });
    try {
      const imgs = await Modelo.carregar(t);
      const textos = {};
      (t.campos || []).filter((c) => c.tipo === "texto").forEach((c) => { textos[c.id] = c.padrao || ""; });
      S.tpl = { t, imgs, estado: { textos, fotos: {} }, exp: { tipo: "image/png" }, ocupado: {} };
      const cv = $("#tpl-tela");
      cv.width = t.largura; cv.height = t.altura;
      montarPainelTemplate();
      desenharTpl();
    } catch (e) {
      toast("Não consegui abrir o template: " + e.message, "erro");
      fecharTemplate(true);
    }
  }

  function reabrirTemplate() {
    $("#templates").hidden = true;
    $("#palco-topo").hidden = true;
    $("#tpl-uso").hidden = false;
    painelDireito("template");
    desenharTpl();
  }

  function fecharTemplate(voltarLista) {
    if ($("#tpl-uso").hidden) return;
    $("#tpl-uso").hidden = true;
    $("#palco-topo").hidden = false;
    painelDireito("opcoes");
    if (voltarLista) { S.tpl = null; mostrarAba("templates"); }
  }

  function desenharTpl() {
    if (!S.tpl) return;
    const ctx = $("#tpl-tela").getContext("2d");
    S.tpl.caixas = Modelo.desenhar(ctx, S.tpl.t, S.tpl.imgs, S.tpl.estado, { vagas: true });
  }

  const ROTULO_IA = {
    retrato: "A IA transforma a foto em um retrato profissional no padrão da arte.",
    fundo: "A IA troca o fundo da foto para combinar com a arte.",
    personalizado: "A IA prepara a foto para combinar com a arte.",
  };

  function montarPainelTemplate() {
    const { t } = S.tpl;
    const campos = t.campos || [];
    const textos = campos.filter((c) => c.tipo === "texto");
    const fotos = campos.filter((c) => c.tipo === "foto");
    const p = $("#painel-template");
    p.innerHTML = `
      <h2 class="titulo-painel">${esc(t.nome)}</h2>
      ${textos.length ? `<span class="rotulo">Textos</span>` : ""}
      ${textos.map((c) => `
        <label class="campo campo-tpl"><span class="rotulo-campo">${esc(c.rotulo || "Texto")}</span>
          ${(c.linhas_max || 1) > 1
            ? `<textarea rows="${Math.min(4, c.linhas_max)}" data-tpl-texto="${c.id}">${esc(S.tpl.estado.textos[c.id] || "")}</textarea>`
            : `<input type="text" data-tpl-texto="${c.id}" value="${esc(S.tpl.estado.textos[c.id] || "")}">`}
        </label>`).join("")}
      ${fotos.map((c) => `
        <div class="bloco caixa-opcao" data-tpl-foto="${c.id}">
          <span class="rotulo">${esc(c.rotulo || "Foto")}</span>
          ${c.ia && c.ia !== "nenhum" ? `<p class="ajuda">${ROTULO_IA[c.ia] || ROTULO_IA.personalizado}</p>` : ""}
          <label class="soltar soltar-sm">
            <input type="file" accept="image/*" hidden data-tpl-arquivo="${c.id}">
            <span>Arraste a foto aqui ou <u>escolha</u></span>
          </label>
          <div class="tpl-foto-estado" hidden></div>
          <div class="tpl-foto-ctrl" hidden>
            <label class="deslizador">Zoom <output>100%</output><input type="range" min="100" max="300" value="100" data-tpl-zoom="${c.id}"></label>
            <div class="linha-botoes">
              ${c.ia && c.ia !== "nenhum" ? `<button type="button" class="btn btn-sm btn-ghost" data-tpl-alternar="${c.id}">Ver foto original</button>
              <button type="button" class="btn btn-sm btn-ghost" data-tpl-refazer="${c.id}">Refazer com IA</button>` : ""}
              <button type="button" class="btn btn-sm btn-perigo" data-tpl-remover="${c.id}">Remover</button>
            </div>
          </div>
        </div>`).join("")}
      ${fotos.length ? `<p class="ajuda ajuda-mini">Use só fotos de pessoas que autorizaram o uso da imagem.</p>` : ""}
      <span class="rotulo">Baixar</span>
      <div class="segmentado" id="tpl-exp-tipo">
        <button type="button" data-tipo="image/png" class="on">PNG</button>
        <button type="button" data-tipo="image/jpeg">JPG</button>
      </div>
      <button type="button" class="btn btn-primario btn-largo" id="tpl-baixar" style="margin-top:12px">Baixar arte</button>
      <button type="button" class="btn btn-ghost btn-largo" id="tpl-copiar" style="margin-top:8px">Copiar</button>
      <button type="button" class="btn btn-ghost btn-largo" id="tpl-editor" style="margin-top:8px" title="Recortar, redimensionar, ajustar">Abrir no editor</button>`;

    p.oninput = (ev) => {
      const id = ev.target.dataset.tplTexto;
      if (id) { S.tpl.estado.textos[id] = ev.target.value; desenharTpl(); }
      const z = ev.target.dataset.tplZoom;
      if (z) {
        const f = S.tpl.estado.fotos[z];
        if (f) { f.zoom = Number(ev.target.value) / 100; ev.target.previousElementSibling.value = ev.target.value + "%"; desenharTpl(); }
      }
    };
    p.onchange = (ev) => {
      const id = ev.target.dataset.tplArquivo;
      if (id && ev.target.files[0]) { usarFotoTemplate(id, ev.target.files[0]); ev.target.value = ""; }
    };
    p.onclick = async (ev) => {
      const tipo = ev.target.closest("#tpl-exp-tipo [data-tipo]");
      if (tipo) {
        S.tpl.exp.tipo = tipo.dataset.tipo;
        $$("#tpl-exp-tipo button").forEach((b) => b.classList.toggle("on", b === tipo));
        return;
      }
      const alt = ev.target.closest("[data-tpl-alternar]");
      if (alt) {
        const f = S.tpl.estado.fotos[alt.dataset.tplAlternar];
        if (!f || !f.tratada) return;
        f.img = f.img === f.tratada ? f.original : f.tratada;
        alt.textContent = f.img === f.tratada ? "Ver foto original" : "Usar foto da IA";
        desenharTpl();
        return;
      }
      const ref = ev.target.closest("[data-tpl-refazer]");
      if (ref) { tratarFotoTemplate(ref.dataset.tplRefazer); return; }
      const rem = ev.target.closest("[data-tpl-remover]");
      if (rem) {
        delete S.tpl.estado.fotos[rem.dataset.tplRemover];
        atualizarBlocoFoto(rem.dataset.tplRemover);
        desenharTpl();
        return;
      }
      if (ev.target.closest("#tpl-baixar")) return baixarTemplate();
      if (ev.target.closest("#tpl-copiar")) return copiarTemplate();
      if (ev.target.closest("#tpl-editor")) return editarTemplate();
    };
    $$("[data-tpl-foto] .soltar", p).forEach((el) => {
      const id = el.closest("[data-tpl-foto]").dataset.tplFoto;
      ligarSoltar(el, (files) => files[0] && usarFotoTemplate(id, files[0]));
    });
  }

  function campoTpl(id) { return (S.tpl.t.campos || []).find((c) => c.id === id); }

  async function usarFotoTemplate(id, file) {
    if (!file.type.startsWith("image/")) return toast("Escolha um arquivo de imagem.", "erro");
    const url = await arquivoParaDataURL(file);
    const img = await carregarImagem(url);
    S.tpl.estado.fotos[id] = { img, original: img, url, zoom: 1, dx: 0, dy: 0, tratada: null };
    atualizarBlocoFoto(id);
    desenharTpl();
    const c = campoTpl(id);
    if (c && c.ia && c.ia !== "nenhum") tratarFotoTemplate(id);
  }

  async function tratarFotoTemplate(id) {
    const f = S.tpl.estado.fotos[id];
    const c = campoTpl(id);
    if (!f || !c || S.tpl.ocupado[id]) return;
    S.tpl.ocupado[id] = true;
    atualizarBlocoFoto(id, "A IA está preparando a foto…");
    try {
      const foto = await reduzirParaBase64(f.url, 1280);
      const proporcao = window.CriaDigi.proporcaoIA(c.w * S.tpl.t.largura, c.h * S.tpl.t.altura);
      const r = await API.gerar({ modo: "foto", foto, tratamento: c.ia, cor: c.ia_cor || null, instrucao: c.ia_instrucao || "", proporcao });
      const img = await carregarImagem(r.imagens[0].url);
      const atual = S.tpl && S.tpl.estado.fotos[id];
      if (atual === f) { f.tratada = img; f.img = img; f.zoom = 1; f.dx = 0; f.dy = 0; }
      S.tpl.ocupado[id] = false;
      atualizarBlocoFoto(id);
      desenharTpl();
    } catch (e) {
      if (S.tpl) S.tpl.ocupado[id] = false;
      atualizarBlocoFoto(id, null, `A IA não conseguiu preparar a foto: ${e.message} A foto original foi usada.`);
    }
  }

  function atualizarBlocoFoto(id, carregando = null, erro = null) {
    const bloco = $(`[data-tpl-foto="${id}"]`);
    if (!bloco) return;
    const f = S.tpl.estado.fotos[id];
    const st = $(".tpl-foto-estado", bloco);
    $(".soltar", bloco).hidden = !!f;
    $(".tpl-foto-ctrl", bloco).hidden = !f || !!carregando;
    st.hidden = !f;
    if (!f) return;
    st.className = "tpl-foto-estado" + (erro ? " erro" : "");
    st.innerHTML = `<img src="${esc(f.tratada && f.img === f.tratada ? f.tratada.src : f.url)}" alt="">
      <span>${carregando ? `<span class="ponto-carregando"></span>${esc(carregando)}` : erro ? esc(erro) : f.tratada ? "Foto preparada pela IA. Arraste na arte para ajustar." : "Arraste na arte para ajustar o enquadramento."}</span>`;
    const z = $(`[data-tpl-zoom="${id}"]`, bloco);
    if (z) { z.value = Math.round((f.zoom || 1) * 100); z.previousElementSibling.value = z.value + "%"; }
    const alt = $(`[data-tpl-alternar="${id}"]`, bloco);
    if (alt) { alt.hidden = !f.tratada; alt.textContent = f.img === f.tratada ? "Ver foto original" : "Usar foto da IA"; }
  }

  // arrastar a foto dentro da moldura
  function ligarArrasteTemplate() {
    const cv = $("#tpl-tela");
    let arr = null;
    const ponto = (ev) => {
      const r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height };
    };
    cv.addEventListener("pointerdown", (ev) => {
      if (!S.tpl) return;
      const p = ponto(ev);
      const c = (S.tpl.t.campos || []).filter((x) => x.tipo === "foto").reverse().find((x) => {
        const W = cv.width, H = cv.height;
        return p.x >= x.x * W && p.x <= (x.x + x.w) * W && p.y >= x.y * H && p.y <= (x.y + x.h) * H;
      });
      if (!c) return;
      const f = S.tpl.estado.fotos[c.id];
      if (!f) { const inp = $(`[data-tpl-arquivo="${c.id}"]`); if (inp) inp.click(); return; }
      arr = { c, f, x: p.x, y: p.y, dx: f.dx || 0, dy: f.dy || 0 };
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!S.tpl) return;
      const p = ponto(ev);
      if (!arr) {
        const sobre = (S.tpl.t.campos || []).some((x) => x.tipo === "foto" && p.x >= x.x * cv.width && p.x <= (x.x + x.w) * cv.width && p.y >= x.y * cv.height && p.y <= (x.y + x.h) * cv.height);
        cv.style.cursor = sobre ? "grab" : "default";
        return;
      }
      const { c, f } = arr;
      const w = c.w * cv.width, h = c.h * cv.height;
      const iw = f.img.naturalWidth || f.img.width, ih = f.img.naturalHeight || f.img.height;
      const k = Math.max(w / iw, h / ih) * (f.zoom || 1);
      const folgaX = (iw * k - w) / 2, folgaY = (ih * k - h) / 2;
      f.dx = folgaX > 0.5 ? Math.max(-1, Math.min(1, arr.dx + (p.x - arr.x) / folgaX)) : 0;
      f.dy = folgaY > 0.5 ? Math.max(-1, Math.min(1, arr.dy + (p.y - arr.y) / folgaY)) : 0;
      desenharTpl();
    });
    const soltar = () => { arr = null; };
    cv.addEventListener("pointerup", soltar);
    cv.addEventListener("pointercancel", soltar);
  }

  function fotosVazias() {
    return (S.tpl.t.campos || []).filter((c) => c.tipo === "foto" && !S.tpl.estado.fotos[c.id]);
  }

  async function baixarTemplate() {
    const vazias = fotosVazias();
    if (vazias.length && !confirm(`Falta a foto em "${vazias[0].rotulo || "Foto"}". Baixar mesmo assim?`)) return;
    try {
      const blob = await Modelo.exportar(S.tpl.t, S.tpl.imgs, S.tpl.estado, S.tpl.exp.tipo, 0.92);
      const slug = (S.tpl.t.nome || "template").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      baixarBlob(blob, `criadigi-${slug}.${S.tpl.exp.tipo === "image/jpeg" ? "jpg" : "png"}`);
    } catch (e) { toast(e.message, "erro"); }
  }

  async function copiarTemplate() {
    try {
      const blob = await Modelo.exportar(S.tpl.t, S.tpl.imgs, S.tpl.estado, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Arte copiada. Cole onde quiser.", "ok");
    } catch (_) { toast("Seu navegador não permitiu copiar. Use o botão Baixar.", "erro"); }
  }

  async function editarTemplate() {
    try {
      const blob = await Modelo.exportar(S.tpl.t, S.tpl.imgs, S.tpl.estado, "image/png");
      const url = await arquivoParaDataURL(blob);
      $("#tpl-uso").hidden = true;
      abrirNoEditor({ id: "tpl-" + Date.now(), url, formato: null, prompt: S.tpl.t.nome, deTemplate: true, semIA: true }, { semLogo: true });
    } catch (e) { toast(e.message, "erro"); }
  }

  iniciar();
})();
