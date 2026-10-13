/* =====================================================================
   CriaDigi · página de criação
   ===================================================================== */
(function () {
  "use strict";
  const { API, FORMATOS, esc, $, $$, toast, carregarImagem, reduzirParaBase64,
    carregarFontes, arquivoParaDataURL, montarCabecalho, lum, abrirLogin, definirDominios } = window.CriaDigi;
  const { Editor, POSICOES } = window.CriaDigiEditor;

  const IDEIAS = [
    "Equipe comemorando a meta batida em um escritório moderno",
    "Troféu sobre uma mesa com confetes nas cores da marca",
    "Pessoa sorrindo ao receber um prêmio em um evento corporativo",
    "Fundo abstrato para anúncio de campanha de incentivo",
  ];

  const S = {
    sessao: null,            // pessoa conectada (ou null)
    conta: false,            // true se a conta salva artes (e-mail de domínio permitido)
    marca: null, cores: [], arquivos: [], estilos: [],
    estilo: null,
    formato: FORMATOS[1],
    quantidade: 2,
    base: null,              // dataURL da imagem de base
    resultados: [],          // {id, url, formato, prompt}
    aberto: null,            // item aberto no editor
    gerando: false,
    exp: { tipo: "image/png", qualidade: 0.9 },
    trava: true,
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

    ed = new Editor($("#tela"), { aoMudar: sincronizarFerramentas, aoSelecionar: aoSelecionar });
    carregarFontes(S.arquivos).then(() => ed && ed.sujarBase());
    carregarLogos();

    montarCriar();
    montarMarcaAtiva();
    montarFerramentas();
    ligarAtalhos();
  }

  // ================================================================ painel criar
  function montarCriar() {
    $("#ideias").innerHTML = IDEIAS.map((t) => `<button type="button" class="ideia">${esc(t)}</button>`).join("");
    $("#ideias").addEventListener("click", (ev) => {
      const b = ev.target.closest(".ideia");
      if (b) { $("#prompt").value = b.textContent; $("#prompt").focus(); }
    });

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
    });

    $("#quantidade").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      S.quantidade = Number(b.dataset.q);
      $$("button", $("#quantidade")).forEach((x) => x.classList.toggle("on", x === b));
    });

    // imagem de base
    const soltar = $("#soltar-base");
    const usarBase = async (file) => {
      if (!file || !file.type.startsWith("image/")) return toast("Escolha um arquivo de imagem.", "erro");
      S.base = await arquivoParaDataURL(file);
      $("#base-previa img").src = S.base;
      $("#base-previa").hidden = false;
      soltar.hidden = true;
    };
    $("#arquivo-base").addEventListener("change", (ev) => usarBase(ev.target.files[0]));
    soltar.addEventListener("dragover", (ev) => { ev.preventDefault(); soltar.classList.add("sobre"); });
    soltar.addEventListener("dragleave", () => soltar.classList.remove("sobre"));
    soltar.addEventListener("drop", (ev) => { ev.preventDefault(); soltar.classList.remove("sobre"); usarBase(ev.dataTransfer.files[0]); });
    $("#remover-base").addEventListener("click", () => {
      S.base = null; $("#base-previa").hidden = true; soltar.hidden = false; $("#arquivo-base").value = "";
    });

    $("#gerar").addEventListener("click", gerar);
    $("#prompt").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) gerar();
    });

    // abas resultados / galeria
    $$("#palco-topo .aba").forEach((b) => b.addEventListener("click", () => mostrarAba(b.dataset.aba)));

    $("#abrir-local").addEventListener("change", async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const url = await arquivoParaDataURL(f);
      abrirNoEditor({ id: "local-" + Date.now(), url, formato: null, prompt: f.name.replace(/\.[^.]+$/, "") });
      ev.target.value = "";
    });
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
      el.innerHTML = `Sem login: até ${m.anon_hora ?? 10} imagens por hora e ${m.anon_dia ?? 20} por dia, e as artes não ficam salvas. <button type="button" class="link-sutil" data-ir="entrar">Entrar</button> ou <button type="button" class="link-sutil" data-ir="criar">criar conta</button>.`;
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

  function mostrarAba(aba) {
    $$("#palco-topo .aba").forEach((b) => { const on = b.dataset.aba === aba; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    fecharEditor(false);
    $("#resultados").hidden = aba !== "resultados";
    $("#galeria").hidden = aba !== "galeria";
    if (aba === "galeria") carregarGaleria();
  }

  // ================================================================ gerar
  async function gerar() {
    if (S.gerando) return;
    const prompt = $("#prompt").value.trim();
    if (!prompt && !S.base) { toast("Descreva o que você quer criar.", "erro"); $("#prompt").focus(); return; }
    S.gerando = true;
    const btn = $("#gerar");
    btn.disabled = true;
    btn.classList.add("carregando");
    btn.querySelector(".txt").textContent = S.quantidade > 1 ? `Gerando ${S.quantidade} variações…` : "Gerando…";
    mostrarAba("resultados");
    $("#vazio")?.remove();

    const formato = S.formato;
    const lote = document.createElement("div");
    lote.className = "lote";
    lote.innerHTML = `<div class="lote-topo"><p class="lote-prompt">${esc(prompt || "A partir da imagem enviada")}</p><span class="lote-meta">${esc(formato.nome)}${S.estilo ? " · " + esc(S.estilo.nome) : ""}</span></div>
      <div class="lote-grade">${Array.from({ length: S.quantidade }, () => `<div class="cartao carregando" style="aspect-ratio:${proporcaoCss(formato.prop)}"><span class="pulso"></span></div>`).join("")}</div>`;
    $("#resultados").prepend(lote);
    if (window.innerWidth <= 900) lote.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const base = S.base ? await reduzirParaBase64(S.base) : null;
      const r = await API.gerar({
        prompt,
        estilo_id: S.estilo?.id || null,
        estilo_nome: S.estilo?.nome || "",
        proporcao: formato.prop,
        formato: formato.id,
        quantidade: S.quantidade,
        base,
      });
      const itens = r.imagens.map((im) => ({ ...im, formato, prompt }));
      S.resultados.unshift(...itens);
      $(".lote-grade", lote).innerHTML = itens.map((it) => cartaoResultado(it, formato)).join("");
      const meta = $(".lote-meta", lote);
      meta.insertAdjacentHTML("beforeend", r.salvo
        ? ` · <span class="selo-salvo">Salvo</span>`
        : ` · <span class="selo-nao-salvo" title="Baixe agora ou entre na sua conta para salvar as próximas">Não salvo</span>`);
      if (typeof r.restante_hora === "number" && !r.salvo && r.restante_hora <= 3) {
        toast(r.restante_hora > 0 ? `Sem login, você ainda pode gerar ${r.restante_hora} imagem(ns) nesta hora.` : "Você usou o limite desta hora sem login. Entre na sua conta para gerar mais.", "aviso", 6000);
      }
      if (r.erros && r.erros.length) toast(`${r.erros.length} variação(ões) falharam: ${r.erros[0]}`, "aviso", 7000);
    } catch (e) {
      $(".lote-grade", lote).innerHTML = `<div class="erro-lote">${esc(e.message)}</div>`;
      toast(e.message, "erro", 8000);
    } finally {
      S.gerando = false;
      btn.disabled = false;
      btn.classList.remove("carregando");
      btn.querySelector(".txt").textContent = "Gerar imagens";
    }
  }

  function proporcaoCss(prop) { const [a, b] = prop.split(":"); return `${a} / ${b}`; }

  function cartaoResultado(it, formato) {
    return `<figure class="cartao" data-id="${esc(it.id)}">
      <img src="${esc(it.url)}" alt="${esc(it.prompt || "Imagem gerada")}" loading="lazy" crossorigin="anonymous" style="aspect-ratio:${proporcaoCss(formato.prop)}">
      <figcaption>
        <button type="button" class="btn btn-sm btn-primario" data-acao="editar">Editar</button>
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
    if (b && b.dataset.acao === "baixar-original") return baixarUrl(it.url, nomeBase(it) + ".png");
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
    abrirNoEditor({ ...it, formato });
  });

  // ================================================================ editor
  async function abrirNoEditor(it) {
    S.aberto = it;
    $("#resultados").hidden = true;
    $("#galeria").hidden = true;
    $("#editor").hidden = false;
    $("#palco-topo").hidden = true;
    $("#marca-ativa").hidden = true;
    $("#ferramentas").hidden = false;
    $(".area").classList.add("editando");
    if (window.innerWidth <= 900) window.scrollTo({ top: 0 });
    try {
      ed.textos = [];
      ed.sel = null;
      await ed.carregar(it.url, it.formato);
      aplicarLogoPadrao();
      ed.marcar();
      ed.historico = [ed.historico[ed.historico.length - 1]];
      $("#exp-nome").value = nomeBase(it);
      sincronizarFerramentas();
      aoSelecionar(null);
      mostrarFerr("formato");
    } catch (e) {
      toast(e.message, "erro");
      fecharEditor(true);
    }
  }

  function fecharEditor(voltarResultados = true) {
    if ($("#editor").hidden) return;
    if (ed.modo === "recorte") cancelarRecorte();
    $("#editor").hidden = true;
    $("#palco-topo").hidden = false;
    $("#marca-ativa").hidden = false;
    $("#ferramentas").hidden = true;
    $(".area").classList.remove("editando");
    S.aberto = null;
    if (voltarResultados) {
      const abaGaleria = $('#palco-topo .aba[data-aba="galeria"]').classList.contains("on");
      $("#resultados").hidden = abaGaleria;
      $("#galeria").hidden = !abaGaleria;
    }
  }
  $("#voltar").addEventListener("click", () => fecharEditor(true));

  function nomeBase(it) {
    const f = it.formato ? it.formato.id : "imagem";
    const slug = (it.prompt || "criadigi").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "criadigi";
    return `criadigi-${slug}-${f}`;
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
        proporcao: formato.prop, formato: formato.id, quantidade: 1, base,
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

  // ---------------------------------------------------------------- marca ativa
  function montarMarcaAtiva() {
    const fontes = fontesDisponiveis();
    const logos = logosAtivos();
    $("#marca-ativa").innerHTML = `
      <h2 class="titulo-painel">Marca ativa</h2>
      <p class="nome-marca">${esc(S.marca?.nome || "Digi")}</p>
      ${S.marca?.descricao ? `<p class="ajuda">${esc(S.marca.descricao)}</p>` : ""}
      <span class="rotulo">Paleta</span>
      <ul class="paleta-lista">
        ${S.cores.map((c) => `<li><span class="bola" style="--c:${c.hex}"></span><span>${esc(c.nome)}</span><code>${c.hex.toUpperCase()}</code></li>`).join("")}
      </ul>
      <span class="rotulo">Tipografia</span>
      <ul class="fontes-lista">${fontes.map((f) => `<li style="font-family:'${esc(f)}',sans-serif">${esc(f)}</li>`).join("")}</ul>
      ${logos.length ? `<span class="rotulo">Logos</span><div class="logos-mini">${logos.map((l) => `<span class="${l.variante === "negativa" ? "escuro" : ""}"><img src="${esc(l.url)}" alt="${esc(l.nome)}"></span>`).join("")}</div>` : ""}
      <div class="dicas">
        <span class="rotulo">Dicas para bons resultados</span>
        <ul>
          <li>Descreva a cena: quem, onde, fazendo o quê.</li>
          <li>Diga o clima: conquista, calma, energia.</li>
          <li>Não peça textos na imagem: você coloca depois no editor, com a fonte certa.</li>
        </ul>
      </div>`;
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

  iniciar();
})();
