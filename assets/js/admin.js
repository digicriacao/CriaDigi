/* =====================================================================
   CriaDigi · painel admin (manual de marca)
   ===================================================================== */
(function () {
  "use strict";
  const { API, PAPEIS_COR, MODELOS, esc, $, $$, toast, carregarFontes, montarCabecalho, telaLogin } = window.CriaDigi;

  const S = { sessao: null, marca: {}, cores: [], arquivos: [], estilos: [], secao: "identidade" };

  async function iniciar() {
    S.sessao = await API.sessao().catch(() => null);
    montarCabecalho({ pagina: "admin", sessao: S.sessao });
    if (!S.sessao) {
      $("#entrada").hidden = false;
      telaLogin($("#entrada"), { titulo: "Admin da marca", aoEntrar: () => location.reload() });
      return;
    }
    if (!S.sessao.admin) {
      $("#entrada").hidden = false;
      $("#entrada").innerHTML = `<section class="login"><div class="login-card"><span class="selo">Acesso restrito</span>
        <h1>Esta área é só para administradores</h1><p class="sub">Você está conectado como ${esc(S.sessao.email)}. Peça a um admin para liberar seu acesso.</p>
        <a class="btn btn-primario btn-largo" href="./">Voltar a criar imagens</a></div></section>`;
      return;
    }
    $("#admin").hidden = false;
    await recarregar();
    const hash = location.hash.replace("#", "");
    if (hash) S.secao = hash;
    $("#admin-menu").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-sec]");
      if (b) irPara(b.dataset.sec);
    });
    irPara(S.secao);
  }

  async function recarregar() {
    try {
      Object.assign(S, await API.marca());
      carregarFontes(S.arquivos);
      contar();
    } catch (e) { toast("Erro ao carregar a marca: " + e.message, "erro", 8000); }
  }

  function contar() {
    const n = {
      cores: S.cores.length,
      fontes: S.arquivos.filter((a) => a.tipo === "fonte").length,
      logos: S.arquivos.filter((a) => a.tipo === "logo").length,
      referencias: S.arquivos.filter((a) => a.tipo === "referencia").length,
      estilos: S.estilos.length,
    };
    $$("[data-cont]").forEach((el) => { el.textContent = n[el.dataset.cont] ?? ""; });
  }

  function irPara(sec) {
    S.secao = sec;
    history.replaceState(null, "", "#" + sec);
    $$("#admin-menu [data-sec]").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
    const r = RENDER[sec] || RENDER.identidade;
    r($("#admin-conteudo"));
    window.scrollTo({ top: 0 });
  }

  const topo = (titulo, texto, extra = "") =>
    `<div class="secao-topo"><div><h1>${titulo}</h1><p>${texto}</p></div>${extra}</div>`;

  async function salvarComAviso(fn, okMsg = "Salvo.") {
    try { await fn(); toast(okMsg, "ok"); return true; }
    catch (e) { toast(e.message, "erro", 7000); return false; }
  }

  // ================================================================ seções
  const RENDER = {

    // ---------------------------------------------------------------- identidade
    identidade(el) {
      const m = S.marca;
      el.innerHTML = topo("Identidade da marca",
        "Esse texto vai junto com todo pedido de imagem. Escreva como se estivesse briefando um fotógrafo ou ilustrador.")
        + `<form class="cartao-admin" id="f-ident">
          <div class="form-grade">
            <label class="campo"><span class="rotulo">Nome da marca</span><input type="text" name="nome" value="${esc(m.nome)}" required></label>
            <div></div>
            <label class="campo inteiro"><span class="rotulo">Descrição do estilo visual</span>
              <textarea name="descricao" rows="4" placeholder="Ex.: fotografia luminosa, pessoas reais, ambientes modernos, muito respiro…">${esc(m.descricao)}</textarea></label>
            <label class="campo"><span class="rotulo">Sempre fazer</span>
              <textarea name="sempre" rows="5" placeholder="Ex.: usar o rosa como destaque; luz natural; diversidade.">${esc(m.sempre)}</textarea></label>
            <label class="campo"><span class="rotulo">Nunca fazer</span>
              <textarea name="nunca" rows="5" placeholder="Ex.: cores neon; banco de imagens genérico; textos na imagem.">${esc(m.nunca)}</textarea></label>
          </div>
          <div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar identidade</button></div>
        </form>
        <section class="cartao-admin">
          <h2>O que a IA recebe</h2>
          <p class="ajuda">Prévia da instrução montada a cada pedido, com um exemplo de prompt. Ela se atualiza enquanto você edita.</p>
          <pre class="prompt-previa" id="previa"></pre>
        </section>`;
      const f = $("#f-ident");
      const atualizarPrevia = () => {
        const dados = Object.fromEntries(new FormData(f));
        $("#previa").textContent = montarInstrucao({ ...S.marca, ...dados });
      };
      f.addEventListener("input", atualizarPrevia);
      atualizarPrevia();
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const dados = Object.fromEntries(new FormData(f));
        if (await salvarComAviso(() => API.salvarMarca(dados), "Identidade salva.")) Object.assign(S.marca, dados);
      });
    },

    // ---------------------------------------------------------------- cores
    cores(el) {
      el.innerHTML = topo("Paleta de cores",
        "Estas são as únicas cores que a IA deve usar como dominantes, e também as cores disponíveis para textos e filtros no editor.",
        `<button class="btn btn-primario" type="button" id="nova-cor">+ Nova cor</button>`)
        + `<section class="cartao-admin">
          <div class="lista-cores" id="lista-cores"></div>
          <div class="preview-paleta" id="preview-paleta" aria-hidden="true"></div>
        </section>`;
      const desenhar = () => {
        $("#lista-cores").innerHTML = S.cores.map((c) => `
          <div class="linha-cor" data-id="${c.id}">
            <input type="color" value="${esc(c.hex)}" aria-label="Cor">
            <input type="text" class="nome" value="${esc(c.nome)}" aria-label="Nome da cor" placeholder="Nome">
            <input type="text" class="hex" value="${esc(c.hex.toUpperCase())}" aria-label="Código hexadecimal" maxlength="7">
            <select class="papel" aria-label="Papel">${Object.entries(PAPEIS_COR).map(([k, v]) => `<option value="${k}" ${c.papel === k ? "selected" : ""}>${v}</option>`).join("")}</select>
            <button type="button" class="icone" data-apagar title="Apagar cor" aria-label="Apagar cor">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </button>
          </div>`).join("") || `<p class="ajuda">Nenhuma cor ainda.</p>`;
        $("#preview-paleta").innerHTML = S.cores.map((c) => `<span class="${c.papel}" style="background:${c.hex}" title="${esc(c.nome)}"></span>`).join("");
        contar();
      };
      desenhar();

      const salvarLinha = async (linha) => {
        const c = S.cores.find((x) => x.id === linha.dataset.id);
        const hex = $(".hex", linha).value.trim().toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(hex)) return toast("Use o formato #RRGGBB, por exemplo #EA0356.", "erro");
        const patch = { id: c.id, nome: $(".nome", linha).value.trim() || "Cor", hex, papel: $(".papel", linha).value, ordem: c.ordem };
        if (await salvarComAviso(() => API.salvarCor(patch), "Cor salva.")) { Object.assign(c, patch); desenhar(); }
      };

      const lista = $("#lista-cores");
      lista.addEventListener("input", (ev) => {
        const linha = ev.target.closest(".linha-cor");
        if (ev.target.type === "color") $(".hex", linha).value = ev.target.value.toUpperCase();
        if (ev.target.classList.contains("hex") && /^#[0-9A-Fa-f]{6}$/.test(ev.target.value)) $("input[type=color]", linha).value = ev.target.value;
      });
      lista.addEventListener("change", (ev) => { if (!ev.target.matches("[data-apagar]")) salvarLinha(ev.target.closest(".linha-cor")); });
      lista.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-apagar]");
        if (!b) return;
        const id = b.closest(".linha-cor").dataset.id;
        if (!confirm("Apagar esta cor da paleta?")) return;
        if (await salvarComAviso(() => API.apagarCor(id), "Cor apagada.")) { S.cores = S.cores.filter((c) => c.id !== id); desenhar(); }
      });
      $("#nova-cor").addEventListener("click", async () => {
        const nova = { nome: "Nova cor", hex: "#EA0356", papel: "apoio", ordem: (S.cores.at(-1)?.ordem || 0) + 1 };
        if (await salvarComAviso(() => API.salvarCor(nova), "Cor criada. Ajuste o nome e o código.")) {
          S.cores = (await API.marca()).cores; desenhar();
          const ult = $$(".linha-cor .nome").at(-1); if (ult) { ult.focus(); ult.select(); }
        }
      });
    },

    // ---------------------------------------------------------------- fontes
    fontes(el) {
      secaoArquivos(el, {
        tipo: "fonte",
        titulo: "Tipografia",
        texto: "Envie os arquivos das fontes da marca (.woff2, .woff, .ttf ou .otf). Elas são usadas nos textos do editor, garantindo a tipografia certa em toda peça. Confira se a licença permite uso na web.",
        aceita: ".woff2,.woff,.ttf,.otf",
        dica: "Um arquivo por peso (Regular, Bold…). Dê o mesmo nome de família aos pesos da mesma fonte.",
        visual: (a) => `<div class="arq-visual"><span class="amostra-fonte" style="font-family:'${esc(a.nome)}';font-weight:${a.peso || 400}">Aa Digi</span></div>`,
        campos: (a) => `
          <input type="text" data-campo="nome" value="${esc(a.nome)}" placeholder="Nome da família" aria-label="Nome da família">
          <div class="duas-col" style="margin:0">
            <select data-campo="variante" aria-label="Uso">
              <option value="titulo" ${a.variante === "titulo" ? "selected" : ""}>Títulos</option>
              <option value="texto" ${a.variante === "texto" ? "selected" : ""}>Textos</option>
            </select>
            <select data-campo="peso" aria-label="Peso">${[300, 400, 500, 600, 700, 800, 900].map((p) => `<option value="${p}" ${Number(a.peso) === p ? "selected" : ""}>${p}</option>`).join("")}</select>
          </div>`,
        metaInicial: (file) => ({
          nome: file.name.replace(/\.[^.]+$/, "").replace(/[-_](Regular|Bold|Medium|Light|Black|SemiBold|ExtraBold|Thin|Italic|VariableFont.*)$/i, "").replace(/[-_]+/g, " ").trim(),
          variante: S.arquivos.some((a) => a.tipo === "fonte" && a.variante === "titulo") ? "texto" : "titulo",
          peso: /black/i.test(file.name) ? 900 : /extrabold/i.test(file.name) ? 800 : /semibold/i.test(file.name) ? 600 : /bold/i.test(file.name) ? 700 : /medium/i.test(file.name) ? 500 : /light/i.test(file.name) ? 300 : 400,
        }),
        depois: () => carregarFontes(S.arquivos),
      });
    },

    // ---------------------------------------------------------------- logos
    logos(el) {
      secaoArquivos(el, {
        tipo: "logo",
        titulo: "Logos",
        texto: "Envie as versões da logo em PNG transparente ou SVG. A logo padrão entra automaticamente em toda imagem aberta no editor, na posição definida abaixo.",
        aceita: "image/png,image/svg+xml,image/webp",
        dica: "Cadastre pelo menos a versão principal (para fundos claros) e a negativa (para fundos escuros).",
        visual: (a) => `<div class="arq-visual ${a.variante === "negativa" ? "escuro" : ""}">${S.marca.logo_padrao === a.id ? '<span class="selo-padrao">Padrão</span>' : ""}<img src="${esc(a.url)}" alt="${esc(a.nome)}"></div>`,
        campos: (a) => `
          <input type="text" data-campo="nome" value="${esc(a.nome)}" placeholder="Nome" aria-label="Nome">
          <select data-campo="variante" aria-label="Versão">
            <option value="principal" ${a.variante === "principal" ? "selected" : ""}>Principal (fundo claro)</option>
            <option value="negativa" ${a.variante === "negativa" ? "selected" : ""}>Negativa (fundo escuro)</option>
            <option value="icone" ${a.variante === "icone" ? "selected" : ""}>Ícone / símbolo</option>
          </select>`,
        acoesExtras: (a) => S.marca.logo_padrao === a.id ? "" : `<button type="button" class="btn btn-sm btn-ghost" data-padrao="${a.id}">Tornar padrão</button>`,
        metaInicial: (file) => ({
          nome: file.name.replace(/\.[^.]+$/, ""),
          variante: /neg|branc|white/i.test(file.name) ? "negativa" : /icon|simbolo|símbolo/i.test(file.name) ? "icone" : "principal",
        }),
        rodape: `<section class="cartao-admin">
          <h2>Aplicação automática</h2>
          <p class="ajuda">Onde a logo padrão aparece quando o usuário abre uma imagem. Ele ainda pode mover ou trocar a versão.</p>
          <form class="form-grade" id="f-logo">
            <label class="campo"><span class="rotulo">Posição</span>
              <select name="logo_posicao">${[["sup-esq", "Superior esquerda"], ["sup-dir", "Superior direita"], ["inf-esq", "Inferior esquerda"], ["inf-centro", "Inferior centro"], ["inf-dir", "Inferior direita"], ["centro", "Centro"]]
                .map(([v, t]) => `<option value="${v}" ${S.marca.logo_posicao === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            <label class="campo"><span class="rotulo">Tamanho (% da largura)</span>
              <input type="number" name="logo_tamanho" min="4" max="60" value="${S.marca.logo_tamanho || 16}"></label>
          </form>
          <div class="acoes-form"><button class="btn btn-primario" type="button" id="salvar-logo">Salvar aplicação</button></div>
        </section>`,
        aoMontar: (root) => {
          $("#salvar-logo", root).addEventListener("click", async () => {
            const d = Object.fromEntries(new FormData($("#f-logo", root)));
            d.logo_tamanho = Number(d.logo_tamanho);
            if (await salvarComAviso(() => API.salvarMarca(d), "Aplicação da logo salva.")) Object.assign(S.marca, d);
          });
          $("#grade-arquivos", root).addEventListener("click", async (ev) => {
            const b = ev.target.closest("[data-padrao]");
            if (!b) return;
            if (await salvarComAviso(() => API.salvarMarca({ logo_padrao: b.dataset.padrao }), "Logo padrão definida.")) {
              S.marca.logo_padrao = b.dataset.padrao; irPara("logos");
            }
          });
        },
        depoisEnvio: async (row) => {
          if (!S.marca.logo_padrao && row.variante === "principal") {
            await API.salvarMarca({ logo_padrao: row.id }); S.marca.logo_padrao = row.id;
          }
        },
      });
    },

    // ---------------------------------------------------------------- referências
    referencias(el) {
      secaoArquivos(el, {
        tipo: "referencia",
        titulo: "Imagens de referência",
        texto: `Peças aprovadas que mostram o estilo da marca. As ${S.marca.max_referencias ?? 4} mais recentes e ativas vão junto com cada pedido para a IA copiar a paleta, a luz e o acabamento (não os objetos).`,
        aceita: "image/png,image/jpeg,image/webp",
        dica: "Prefira imagens sem texto, em boa resolução e coerentes entre si. Desative as que fugirem do estilo.",
        visual: (a) => `<div class="arq-visual foto"><img src="${esc(a.url)}" alt="${esc(a.descricao || a.nome)}"></div>`,
        campos: (a) => `
          <input type="text" data-campo="descricao" value="${esc(a.descricao || "")}" placeholder="Descrição curta (opcional)" aria-label="Descrição">
          <label class="interruptor"><input type="checkbox" data-campo="ativo" ${a.ativo !== false ? "checked" : ""}> Usar nas gerações</label>`,
        metaInicial: (file) => ({ nome: file.name, descricao: "" }),
        multiplos: true,
        redimensionar: 1600,
      });
    },

    // ---------------------------------------------------------------- estilos
    estilos(el) {
      el.innerHTML = topo("Estilos",
        "Os estilos aparecem como opções para o usuário. Cada um soma uma instrução ao manual da marca, sem nunca sair dele.",
        `<button class="btn btn-primario" type="button" id="novo-estilo">+ Novo estilo</button>`)
        + `<section class="cartao-admin"><div class="lista-estilos" id="lista-estilos"></div></section>`;
      const desenhar = () => {
        $("#lista-estilos").innerHTML = S.estilos.map((e) => `
          <div class="estilo-item" data-id="${e.id}">
            <input type="text" data-campo="nome" value="${esc(e.nome)}" aria-label="Nome do estilo">
            <textarea data-campo="instrucao" rows="2" aria-label="Instrução para a IA">${esc(e.instrucao)}</textarea>
            <div class="controles">
              <label class="interruptor"><input type="checkbox" data-campo="ativo" ${e.ativo !== false ? "checked" : ""}> Ativo</label>
              <button type="button" class="btn btn-sm btn-perigo" data-apagar>Apagar</button>
            </div>
          </div>`).join("") || `<p class="ajuda">Nenhum estilo cadastrado.</p>`;
        contar();
      };
      desenhar();
      const lista = $("#lista-estilos");
      lista.addEventListener("change", async (ev) => {
        const item = ev.target.closest(".estilo-item");
        const e = S.estilos.find((x) => x.id === item.dataset.id);
        const patch = {
          id: e.id,
          nome: $('[data-campo="nome"]', item).value.trim() || "Estilo",
          instrucao: $('[data-campo="instrucao"]', item).value.trim(),
          ativo: $('[data-campo="ativo"]', item).checked,
        };
        if (await salvarComAviso(() => API.salvarEstilo(patch), "Estilo salvo.")) Object.assign(e, patch);
      });
      lista.addEventListener("click", async (ev) => {
        if (!ev.target.closest("[data-apagar]")) return;
        const id = ev.target.closest(".estilo-item").dataset.id;
        if (!confirm("Apagar este estilo?")) return;
        if (await salvarComAviso(() => API.apagarEstilo(id), "Estilo apagado.")) { S.estilos = S.estilos.filter((e) => e.id !== id); desenhar(); }
      });
      $("#novo-estilo").addEventListener("click", async () => {
        const novo = { nome: "Novo estilo", instrucao: "Descreva aqui o tratamento visual (técnica, luz, acabamento).", ordem: (S.estilos.at(-1)?.ordem || 0) + 1, ativo: true };
        if (await salvarComAviso(() => API.salvarEstilo(novo), "Estilo criado.")) {
          S.estilos = (await API.marca()).estilos; desenhar();
          const ult = $$('.estilo-item [data-campo="nome"]').at(-1); if (ult) { ult.focus(); ult.select(); }
        }
      });
    },

    // ---------------------------------------------------------------- usuários
    async usuarios(el) {
      el.innerHTML = topo("Contas",
        "Qualquer pessoa usa a CriaDigi sem login; quem cria conta tem as artes salvas e um limite maior. Aqui você vê as contas, define quem é admin, troca senhas e remove acessos.")
        + `<section class="cartao-admin">
          <h2>Criar conta para alguém</h2>
          <p class="ajuda">Opcional: as pessoas também podem criar a própria conta pelo botão Entrar. Envie o e-mail e a senha para a pessoa; ela troca a senha depois, no menu da conta.</p>
          <form class="novo-usuario" id="f-usuario" autocomplete="off">
            <input type="email" name="email" placeholder="email@digi.ag" required aria-label="E-mail">
            <input type="text" name="senha" placeholder="Senha inicial (8+ caracteres)" minlength="8" required aria-label="Senha inicial">
            <label class="interruptor"><input type="checkbox" name="admin"> Admin</label>
            <button class="btn btn-primario" type="submit">Criar conta</button>
          </form>
        </section>
        <section class="cartao-admin">
          <div class="secao-topo" style="margin-bottom:12px"><h2>Todas as contas</h2><input type="text" id="busca-conta" placeholder="Buscar e-mail" style="max-width:240px" aria-label="Buscar e-mail"></div>
          <div id="lista-usuarios"><p class="ajuda">Carregando…</p></div>
        </section>`;

      const desenharLista = () => {
        const termo = ($("#busca-conta").value || "").toLowerCase();
        const lista = (S.usuarios || []).filter((u) => (u.email || "").toLowerCase().includes(termo));
        $("#lista-usuarios").innerHTML = lista.length ? `<table class="tabela">
          <thead><tr><th>E-mail</th><th>Perfil</th><th class="some-mobile">Artes salvas</th><th class="some-mobile">Último acesso</th><th></th></tr></thead>
          <tbody>${lista.map((u) => `<tr data-id="${u.id}">
            <td>${esc(u.email)}${u.email === S.sessao.email ? ' <span class="etiqueta">você</span>' : ""}</td>
            <td>${u.admin ? '<span class="etiqueta rosa">Admin</span>' : '<span class="etiqueta">Criação</span>'}</td>
            <td class="some-mobile">${u.artes ?? 0}</td>
            <td class="some-mobile">${u.ultimo_acesso ? new Date(u.ultimo_acesso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
            <td class="acoes-td">${u.email === S.sessao.email ? "" : `
              <button type="button" class="btn btn-sm btn-ghost" data-u="admin">${u.admin ? "Tirar admin" : "Tornar admin"}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-u="senha">Nova senha</button>
              <button type="button" class="btn btn-sm btn-perigo" data-u="remover">Remover</button>`}</td>
          </tr>`).join("")}</tbody></table>` : `<p class="ajuda">Nenhuma conta encontrada.</p>`;
      };
      const carregar = async () => {
        try {
          const { usuarios } = await API.usuarios("listar");
          usuarios.sort((a, b) => (b.admin - a.admin) || String(a.email).localeCompare(String(b.email)));
          S.usuarios = usuarios;
          desenharLista();
        } catch (e) {
          $("#lista-usuarios").innerHTML = `<div class="erro-lote">${esc(e.message)}</div>`;
        }
      };
      carregar();
      $("#busca-conta").addEventListener("input", desenharLista);

      $("#f-usuario").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const dados = { email: f.email.value.trim().toLowerCase(), senha: f.senha.value, admin: f.admin.checked };
        if (await salvarComAviso(() => API.usuarios("criar", dados), `Conta criada para ${dados.email}.`)) { f.reset(); carregar(); }
      });
      $("#lista-usuarios").addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-u]");
        if (!b) return;
        const u = (S.usuarios || []).find((x) => x.id === b.closest("tr").dataset.id);
        if (b.dataset.u === "admin") {
          if (await salvarComAviso(() => API.usuarios("admin", { email: u.email, valor: !u.admin }), "Perfil atualizado.")) carregar();
        }
        if (b.dataset.u === "senha") {
          const senha = prompt(`Nova senha para ${u.email} (mínimo 8 caracteres):`);
          if (!senha) return;
          await salvarComAviso(() => API.usuarios("senha", { id: u.id, senha }), "Senha alterada. Envie a nova senha para a pessoa.");
        }
        if (b.dataset.u === "remover") {
          if (!confirm(`Remover a conta de ${u.email}? As artes salvas dela também serão apagadas.`)) return;
          if (await salvarComAviso(() => API.usuarios("remover", { id: u.id }), "Conta removida.")) carregar();
        }
      });
    },

    // ---------------------------------------------------------------- IA
    ia(el) {
      const m = S.marca;
      const num = (nome, valor, min, max) => `<input type="number" name="${nome}" min="${min}" max="${max}" value="${valor}">`;
      el.innerHTML = topo("Inteligência artificial e limites",
        "Configuração do Gemini e dos limites de uso. A chave da API fica guardada no Supabase (Secrets), nunca no site.")
        + `<form id="f-ia">
          <section class="cartao-admin">
            <h2>Modelo</h2>
            <div class="form-grade" style="margin-top:12px">
              <label class="campo inteiro"><span class="rotulo">Modelo</span>
                <select name="modelo">${MODELOS.map((x) => `<option value="${x.id}" ${m.modelo === x.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}
                ${MODELOS.some((x) => x.id === m.modelo) ? "" : `<option value="${esc(m.modelo)}" selected>${esc(m.modelo)}</option>`}</select></label>
              <label class="campo"><span class="rotulo">Resolução</span>
                <select name="resolucao">${["1K", "2K", "4K"].map((r) => `<option ${m.resolucao === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
              <label class="campo"><span class="rotulo">Referências enviadas por pedido</span>${num("max_referencias", m.max_referencias ?? 4, 0, 6)}</label>
              <label class="campo checar inteiro"><input type="checkbox" name="permitir_texto_ia" ${m.permitir_texto_ia ? "checked" : ""}> Permitir que a IA escreva textos na imagem</label>
            </div>
            <p class="ajuda" style="margin-top:12px">Recomendado: deixar a IA <b>sem</b> escrever textos. Eles entram no editor com as fontes oficiais. 2K é o melhor equilíbrio entre qualidade e custo.</p>
          </section>

          <section class="cartao-admin">
            <h2>Sem login</h2>
            <p class="ajuda">As artes não são salvas. Os limites valem por navegador; o teto por rede impede que alguém burle o limite limpando o navegador.</p>
            <div class="form-grade">
              <label class="campo"><span class="rotulo">Por hora, por navegador</span>${num("anon_hora", m.anon_hora ?? 10, 0, 500)}</label>
              <label class="campo"><span class="rotulo">Por dia, por navegador</span>${num("anon_dia", m.anon_dia ?? 20, 0, 2000)}</label>
              <label class="campo"><span class="rotulo">Por dia, por rede (IP)</span>${num("anon_ip_dia", m.anon_ip_dia ?? 100, 0, 10000)}</label>
            </div>
            <p class="ajuda" style="margin-top:10px">No escritório, todo mundo costuma sair pelo mesmo IP. Se o time usar sem login, o teto por rede é dividido entre todos, então é melhor o time criar conta.</p>
          </section>

          <section class="cartao-admin">
            <h2>Com login</h2>
            <p class="ajuda">As artes ficam salvas em Minhas criações.</p>
            <div class="form-grade">
              <label class="campo"><span class="rotulo">Por hora, por conta</span>${num("conta_hora", m.conta_hora ?? 30, 1, 1000)}</label>
              <label class="campo"><span class="rotulo">Por dia, por conta</span>${num("conta_dia", m.conta_dia ?? 100, 1, 5000)}</label>
              <label class="campo inteiro"><span class="rotulo">Domínios de e-mail que contam como conta</span>
                <input type="text" name="dominios_conta" value="${esc(m.dominios_conta ?? "")}" placeholder="digi.ag (deixe vazio para aceitar qualquer e-mail)"></label>
            </div>
            <p class="ajuda" style="margin-top:10px">Contas com e-mail de outro domínio funcionam como "sem login": não salvam e seguem os limites de cima. Separe vários domínios por vírgula.</p>
          </section>

          <section class="cartao-admin">
            <h2>Teto da plataforma</h2>
            <div class="form-grade">
              <label class="campo"><span class="rotulo">Total de imagens por dia, somando todo mundo</span>${num("limite_dia", m.limite_dia ?? 1000, 1, 100000)}</label>
            </div>
            <p class="ajuda" style="margin-top:10px">Trava de segurança para o crédito do Gemini. Se for atingido, ninguém gera até a janela de 24 horas liberar espaço.</p>
            <div class="acoes-form">
              <a class="btn btn-ghost" href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener">Ver preços do Gemini</a>
              <button class="btn btn-primario" type="submit">Salvar configuração</button>
            </div>
          </section>
        </form>`;
      $("#f-ia").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const n = (nome, min, padrao) => {
          const bruto = String(f[nome].value).trim();
          const v = Number(bruto);
          return bruto !== "" && Number.isFinite(v) ? Math.max(min, Math.round(v)) : padrao;
        };
        const d = {
          modelo: f.modelo.value, resolucao: f.resolucao.value,
          max_referencias: Math.min(6, n("max_referencias", 0, 4)),
          permitir_texto_ia: f.permitir_texto_ia.checked,
          anon_hora: n("anon_hora", 0, 10), anon_dia: n("anon_dia", 0, 20), anon_ip_dia: n("anon_ip_dia", 0, 100),
          conta_hora: n("conta_hora", 1, 30), conta_dia: n("conta_dia", 1, 100),
          limite_dia: n("limite_dia", 1, 1000),
          dominios_conta: f.dominios_conta.value.trim().toLowerCase(),
        };
        if (await salvarComAviso(() => API.salvarMarca(d), "Configuração salva.")) Object.assign(S.marca, d);
      });
    },
  };

  // ================================================================ arquivos (genérico)
  function secaoArquivos(el, o) {
    const lista = () => S.arquivos.filter((a) => a.tipo === o.tipo);
    el.innerHTML = topo(o.titulo, o.texto) + `
      <section class="cartao-admin">
        <label class="envio" id="envio">
          <input type="file" accept="${o.aceita}" ${o.multiplos !== false ? "multiple" : ""} hidden>
          <span><b>Arraste os arquivos aqui ou clique para escolher</b>${esc(o.dica)}</span>
        </label>
      </section>
      <section class="cartao-admin"><div class="grade-arquivos" id="grade-arquivos"></div></section>
      ${o.rodape || ""}`;

    const desenhar = () => {
      const itens = lista();
      $("#grade-arquivos").innerHTML = itens.length ? itens.map((a) => `
        <div class="arq ${a.ativo === false ? "inativo" : ""}" data-id="${a.id}">
          ${o.visual(a)}
          <div class="arq-corpo">
            ${o.campos(a)}
            <div class="arq-acoes">${o.acoesExtras ? o.acoesExtras(a) : ""}<button type="button" class="btn btn-sm btn-perigo" data-apagar>Apagar</button></div>
          </div>
        </div>`).join("") : `<p class="ajuda">Nada cadastrado ainda.</p>`;
      contar();
    };
    desenhar();

    const envio = $("#envio");
    const enviar = async (files) => {
      const arr = [...files];
      if (!arr.length) return;
      envio.classList.add("sobre");
      let ok = 0;
      for (const file of arr) {
        try {
          let f = file;
          if (o.redimensionar && /^image\/(png|jpeg|webp)$/.test(file.type)) f = await reduzirArquivo(file, o.redimensionar);
          const row = await API.enviarArquivo(f, { tipo: o.tipo, ...o.metaInicial(file) });
          if (o.depoisEnvio) await o.depoisEnvio(row);
          ok++;
        } catch (e) { toast(`${file.name}: ${e.message}`, "erro", 7000); }
      }
      envio.classList.remove("sobre");
      await recarregar();
      if (o.depois) await o.depois();
      if (ok) toast(ok === 1 ? "Arquivo enviado." : `${ok} arquivos enviados.`, "ok");
      irPara(S.secao);
    };
    $("input", envio).addEventListener("change", (ev) => enviar(ev.target.files));
    envio.addEventListener("dragover", (ev) => { ev.preventDefault(); envio.classList.add("sobre"); });
    envio.addEventListener("dragleave", () => envio.classList.remove("sobre"));
    envio.addEventListener("drop", (ev) => { ev.preventDefault(); envio.classList.remove("sobre"); enviar(ev.dataTransfer.files); });

    const grade = $("#grade-arquivos");
    grade.addEventListener("change", async (ev) => {
      const campo = ev.target.dataset.campo;
      if (!campo) return;
      const card = ev.target.closest(".arq");
      const a = S.arquivos.find((x) => x.id === card.dataset.id);
      let valor = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
      if (campo === "peso") valor = Number(valor);
      if (await salvarComAviso(() => API.salvarArquivo(a.id, { [campo]: valor }), "Salvo.")) {
        a[campo] = valor;
        if (campo === "ativo") card.classList.toggle("inativo", !valor);
        if (o.tipo === "fonte") { await carregarFontes(S.arquivos); desenhar(); }
        if (o.tipo === "logo" && campo === "variante") desenhar();
      }
    });
    grade.addEventListener("click", async (ev) => {
      if (!ev.target.closest("[data-apagar]")) return;
      const a = S.arquivos.find((x) => x.id === ev.target.closest(".arq").dataset.id);
      if (!confirm(`Apagar "${a.nome}"?`)) return;
      if (await salvarComAviso(() => API.apagarArquivo(a), "Arquivo apagado.")) {
        S.arquivos = S.arquivos.filter((x) => x.id !== a.id);
        if (S.marca.logo_padrao === a.id) S.marca.logo_padrao = null;
        desenhar();
      }
    });
    if (o.aoMontar) o.aoMontar(el);
  }

  async function reduzirArquivo(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await window.CriaDigi.carregarImagem(url);
      const k = max / Math.max(img.naturalWidth, img.naturalHeight);
      if (k >= 1) return file;
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally { URL.revokeObjectURL(url); }
  }

  // espelho da instrução montada na função "gerar" (só para prévia)
  function montarInstrucao(m) {
    const estilo = S.estilos.find((e) => e.ativo !== false);
    const papeis = { principal: "cor principal", secundaria: "cor secundária", apoio: "cor de apoio", fundo: "fundo", texto: "texto e detalhes escuros" };
    const refs = Math.min(m.max_referencias ?? 4, S.arquivos.filter((a) => a.tipo === "referencia" && a.ativo !== false).length);
    return [
      `Você é o gerador oficial de imagens da marca ${m.nome}. Crie uma única imagem que siga rigorosamente o manual de marca abaixo.`,
      `PEDIDO DO USUÁRIO: equipe comemorando a meta batida em um escritório moderno`,
      estilo ? `ESTILO VISUAL: ${estilo.nome}. ${estilo.instrucao}` : "",
      m.descricao ? `IDENTIDADE VISUAL DA MARCA: ${m.descricao}` : "",
      S.cores.length ? `PALETA OBRIGATÓRIA (use estas cores como dominantes, respeitando os papéis; tons naturais como pele e sombras são permitidos):\n${S.cores.map((c) => `- ${c.nome} ${c.hex.toUpperCase()} (${papeis[c.papel] || c.papel})`).join("\n")}` : "",
      m.sempre ? `SEMPRE: ${m.sempre}` : "",
      m.nunca ? `NUNCA: ${m.nunca}` : "",
      `COMPOSIÇÃO: formato 4:5. Mantenha áreas limpas e com pouco detalhe perto das bordas para a aplicação posterior de logo e textos.`,
      m.permitir_texto_ia ? "" : "Não escreva nenhum texto, letra, número, logotipo ou marca d'água na imagem. Textos e logo serão aplicados depois pela plataforma.",
      refs ? `As ${refs} imagens anexadas são referências de estilo aprovadas da marca: siga a paleta, a luz, o tratamento e o acabamento delas, mas não copie seus objetos nem sua composição.` : "",
    ].filter(Boolean).join("\n\n");
  }

  iniciar();
})();
