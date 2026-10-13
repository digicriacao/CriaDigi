/* =====================================================================
   CriaDigi · editor de imagem (canvas)
   Camadas: base (recorte + ajustes + filtro + degradê) → logo → textos.
   Tudo é recalculado a partir do estado, então a imagem original nunca
   é perdida: dá para recortar de novo, desfazer e trocar o formato.
   ===================================================================== */
(function () {
  "use strict";

  const POSICOES = ["sup-esq", "sup-centro", "sup-dir", "meio-esq", "centro", "meio-dir", "inf-esq", "inf-centro", "inf-dir"];

  class Editor {
    constructor(canvas, opcoes = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.aoMudar = opcoes.aoMudar || (() => {});
      this.aoSelecionar = opcoes.aoSelecionar || (() => {});
      this.logos = new Map(); // id -> HTMLImageElement
      this.historico = [];
      this.futuro = [];
      this.modo = "editar";
      this._raf = 0;
      this._baseSuja = true;
      this.baseCache = document.createElement("canvas");
      this._resetar();
      this._ligarPonteiro();
    }

    _resetar() {
      this.src = null;
      this.srcC = document.createElement("canvas");
      this.rot = 0; this.flipH = false; this.flipV = false;
      this.crop = { x: 0, y: 0, w: 1, h: 1 };
      this.out = { w: 1080, h: 1080 };
      this.adj = { brilho: 0, contraste: 0, saturacao: 0, calor: 0 };
      this.filtro = { cor: null, forca: 0 };
      this.degrade = { cor: "#222323", forca: 0, lado: "baixo" };
      this.logo = { id: null, pos: "inf-dir", tamanho: 16, x: null, y: null };
      this.textos = [];
      this.sel = null;
    }

    get temImagem() { return !!this.src; }

    // ------------------------------------------------------------ carregar
    async carregar(src, formato) {
      const img = await window.CriaDigi.carregarImagem(src);
      const manterCamadas = { logo: { ...this.logo }, textos: this.textos };
      this._resetar();
      this.logo = manterCamadas.logo;
      this.src = img;
      this._refazerFonte();
      if (formato) this.definirFormato(formato.w, formato.h, false);
      else {
        const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        this.out = { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
        this.crop = { x: 0, y: 0, w: this.srcC.width, h: this.srcC.height };
      }
      this.historico = []; this.futuro = [];
      this._baseSuja = true;
      this.marcar();
      this.desenhar();
    }

    // troca só a imagem de fundo (ex.: depois de "refinar com IA"), mantendo textos e logo
    async trocarBase(src) {
      const img = await window.CriaDigi.carregarImagem(src);
      this.src = img;
      this.rot = 0; this.flipH = false; this.flipV = false;
      this._refazerFonte();
      this.crop = this._cobrir(this.out.w / this.out.h);
      this._baseSuja = true;
      this.marcar();
      this.desenhar();
    }

    registrarLogo(id, img) { this.logos.set(id, img); }

    // ------------------------------------------------------------ geometria
    _refazerFonte() {
      const img = this.src;
      const giro = this.rot % 2 === 1;
      const w = giro ? img.naturalHeight : img.naturalWidth;
      const h = giro ? img.naturalWidth : img.naturalHeight;
      const c = this.srcC;
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.save();
      x.translate(w / 2, h / 2);
      x.rotate(this.rot * Math.PI / 2);
      x.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
      x.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      x.restore();
    }

    _cobrir(razao) {
      const W = this.srcC.width, H = this.srcC.height;
      let w = W, h = W / razao;
      if (h > H) { h = H; w = H * razao; }
      return { x: (W - w) / 2, y: (H - h) / 2, w, h };
    }

    definirFormato(w, h, registrar = true) {
      this.out = { w: Math.round(w), h: Math.round(h) };
      if (this.src) this.crop = this._cobrir(w / h);
      this._baseSuja = true;
      if (registrar) this.marcar();
      this.desenhar();
    }

    // resize: muda os pixels de saída. Se a proporção mudar, refaz o recorte centralizado.
    redimensionar(w, h) {
      w = Math.max(16, Math.min(6000, Math.round(w)));
      h = Math.max(16, Math.min(6000, Math.round(h)));
      const mesma = Math.abs(w / h - this.out.w / this.out.h) < 0.002;
      this.out = { w, h };
      if (!mesma && this.src) this.crop = this._cobrir(w / h);
      this._baseSuja = true;
      this.marcar();
      this.desenhar();
    }

    girar(dir) {
      if (!this.src) return;
      this.rot = (this.rot + (dir > 0 ? 1 : 3)) % 4;
      this._refazerFonte();
      const giro = this.out;
      this.out = { w: giro.h, h: giro.w };
      this.crop = this._cobrir(this.out.w / this.out.h);
      this._baseSuja = true; this.marcar(); this.desenhar();
    }

    espelhar(eixo) {
      if (!this.src) return;
      if (eixo === "h") this.flipH = !this.flipH; else this.flipV = !this.flipV;
      const c = this.crop, W = this.srcC.width, H = this.srcC.height;
      this._refazerFonte();
      // espelha o recorte junto, para continuar mostrando a mesma região
      if (eixo === "h" && this.rot % 2 === 0 || eixo === "v" && this.rot % 2 === 1) c.x = W - c.x - c.w;
      else c.y = H - c.y - c.h;
      this._baseSuja = true; this.marcar(); this.desenhar();
    }

    // ------------------------------------------------------------ estado / desfazer
    _estado() {
      return JSON.stringify({
        rot: this.rot, flipH: this.flipH, flipV: this.flipV, crop: this.crop, out: this.out,
        adj: this.adj, filtro: this.filtro, degrade: this.degrade, logo: this.logo, textos: this.textos,
      });
    }

    _aplicarEstado(json) {
      const s = JSON.parse(json);
      const giroMudou = s.rot !== this.rot || s.flipH !== this.flipH || s.flipV !== this.flipV;
      Object.assign(this, s);
      if (giroMudou && this.src) this._refazerFonte();
      if (this.sel && this.sel !== "logo" && !this.textos.some((t) => t.id === this.sel)) this.sel = null;
      this._baseSuja = true;
      this.desenhar();
      this.aoMudar();
      this.aoSelecionar(this.sel);
    }

    marcar() {
      const s = this._estado();
      if (this.historico[this.historico.length - 1] === s) return;
      this.historico.push(s);
      if (this.historico.length > 60) this.historico.shift();
      this.futuro = [];
      this.aoMudar();
    }

    desfazer() {
      if (this.historico.length < 2) return;
      this.futuro.push(this.historico.pop());
      this._aplicarEstado(this.historico[this.historico.length - 1]);
    }

    refazer() {
      if (!this.futuro.length) return;
      const s = this.futuro.pop();
      this.historico.push(s);
      this._aplicarEstado(s);
    }

    get podeDesfazer() { return this.historico.length > 1; }
    get podeRefazer() { return this.futuro.length > 0; }

    // ------------------------------------------------------------ camadas
    sujarBase() { this._baseSuja = true; this.desenhar(); }

    adicionarTexto(opcoes) {
      const t = {
        id: window.CriaDigi.uid(),
        texto: "Seu texto aqui",
        fonte: "Hanken Grotesk",
        peso: 700,
        tamanho: 7,          // % da largura da imagem
        cor: "#FFFFFF",
        fundo: null,
        alinhar: "left",
        caixaAlta: false,
        largura: 0.8,        // largura máxima do bloco (fração da imagem)
        x: 0.08, y: 0.08,    // posição do bloco (fração da imagem)
        ...opcoes,
      };
      this.textos.push(t);
      this.sel = t.id;
      this.marcar();
      this.desenhar();
      this.aoSelecionar(this.sel);
      return t;
    }

    textoSelecionado() { return this.textos.find((t) => t.id === this.sel) || null; }

    removerSelecionado() {
      if (!this.sel) return;
      if (this.sel === "logo") this.logo.id = null;
      else this.textos = this.textos.filter((t) => t.id !== this.sel);
      this.sel = null;
      this.marcar(); this.desenhar(); this.aoSelecionar(null);
    }

    // ------------------------------------------------------------ desenho
    desenhar() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this.modo === "recorte") this._desenharRecorte();
        else this._desenharEdicao();
      });
    }

    _montarBase(W, H) {
      const b = this.baseCache;
      if (b.width !== W || b.height !== H) { b.width = W; b.height = H; }
      const x = b.getContext("2d", { willReadFrequently: true });
      x.clearRect(0, 0, W, H);
      x.imageSmoothingQuality = "high";
      const c = this.crop;
      x.drawImage(this.srcC, c.x, c.y, c.w, c.h, 0, 0, W, H);
      ajustarPixels(x, W, H, this.adj);
      if (this.filtro.cor && this.filtro.forca > 0) {
        x.save();
        x.globalCompositeOperation = "color";
        x.globalAlpha = this.filtro.forca / 100;
        x.fillStyle = this.filtro.cor;
        x.fillRect(0, 0, W, H);
        x.restore();
      }
      if (this.degrade.forca > 0) {
        const lado = this.degrade.lado;
        const g = lado === "cima" ? x.createLinearGradient(0, 0, 0, H * 0.65)
          : lado === "esquerda" ? x.createLinearGradient(0, 0, W * 0.65, 0)
          : x.createLinearGradient(0, H, 0, H * 0.35);
        const a = this.degrade.forca / 100;
        g.addColorStop(0, hexA(this.degrade.cor, a));
        g.addColorStop(1, hexA(this.degrade.cor, 0));
        x.fillStyle = g;
        x.fillRect(0, 0, W, H);
      }
      this._baseSuja = false;
    }

    _compor(ctx, W, H, comUI) {
      if (this._baseSuja || this.baseCache.width !== W || this.baseCache.height !== H) this._montarBase(W, H);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.baseCache, 0, 0);
      this._desenharLogo(ctx, W, H, comUI);
      for (const t of this.textos) this._desenharTexto(ctx, t, W, H, comUI);
    }

    _desenharEdicao() {
      const { w, h } = this.out;
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      if (!this.src) { this.ctx.clearRect(0, 0, w, h); return; }
      this._compor(this.ctx, w, h, true);
    }

    _desenharLogo(ctx, W, H, comUI) {
      const L = this.logo;
      const img = L.id && this.logos.get(L.id);
      if (!img) { L._caixa = null; return; }
      const lw = W * L.tamanho / 100;
      const lh = lw * (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
      const m = Math.min(W, H) * 0.05;
      let cx, cy;
      if (L.x != null && L.y != null) { cx = L.x * W; cy = L.y * H; }
      else {
        const [v, hz] = posicaoGrade(L.pos);
        cx = hz === 0 ? m + lw / 2 : hz === 1 ? W / 2 : W - m - lw / 2;
        cy = v === 0 ? m + lh / 2 : v === 1 ? H / 2 : H - m - lh / 2;
      }
      ctx.drawImage(img, cx - lw / 2, cy - lh / 2, lw, lh);
      L._caixa = { x0: cx - lw / 2, y0: cy - lh / 2, x1: cx + lw / 2, y1: cy + lh / 2, cx, cy };
      if (comUI && this.sel === "logo") contorno(ctx, L._caixa, W);
    }

    _desenharTexto(ctx, t, W, H, comUI) {
      const px = Math.max(6, W * t.tamanho / 100);
      ctx.font = `${t.peso} ${px}px "${t.fonte}", "Hanken Grotesk", system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const texto = t.caixaAlta ? t.texto.toLocaleUpperCase("pt-BR") : t.texto;
      const maxW = t.largura * W;
      const linhas = quebrar(ctx, texto, maxW);
      const lh = px * 1.12;
      const larguras = linhas.map((l) => ctx.measureText(l).width);
      const larguraBloco = Math.max(1, ...larguras);
      const x0 = t.x * W, y0 = t.y * H;
      const pad = t.fundo ? px * 0.32 : 0;
      const ancoraX = t.alinhar === "center" ? x0 + larguraBloco / 2 : t.alinhar === "right" ? x0 + larguraBloco : x0;
      if (t.fundo) {
        ctx.fillStyle = t.fundo;
        linhas.forEach((l, i) => {
          const lw = larguras[i];
          const lx = t.alinhar === "center" ? ancoraX - lw / 2 : t.alinhar === "right" ? ancoraX - lw : x0;
          retArredondado(ctx, lx - pad, y0 + i * lh - pad * 0.55, lw + pad * 2, lh + pad * 0.5, px * 0.12);
          ctx.fill();
        });
      }
      ctx.fillStyle = t.cor;
      ctx.textAlign = t.alinhar;
      linhas.forEach((l, i) => ctx.fillText(l, ancoraX, y0 + i * lh + px * 0.04));
      ctx.textAlign = "left";
      t._caixa = { x0: x0 - pad, y0: y0 - pad * 0.55, x1: x0 + larguraBloco + pad, y1: y0 + linhas.length * lh + pad * 0.3 };
      if (comUI && this.sel === t.id) contorno(ctx, t._caixa, W);
    }

    // ------------------------------------------------------------ recorte
    iniciarRecorte(razao) {
      if (!this.src) return;
      this.modo = "recorte";
      this._recorte = { ...this.crop };
      this.razaoRecorte = razao || null;
      if (razao) this._ajustarRazao();
      this.desenhar();
    }

    definirRazaoRecorte(razao) {
      this.razaoRecorte = razao || null;
      if (razao) this._ajustarRazao();
      this.desenhar();
    }

    _ajustarRazao() {
      const r = this._recorte, k = this.razaoRecorte;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let w = r.w, h = w / k;
      if (h > this.srcC.height) { h = this.srcC.height; w = h * k; }
      if (w > this.srcC.width) { w = this.srcC.width; h = w / k; }
      this._recorte = limitar({ x: cx - w / 2, y: cy - h / 2, w, h }, this.srcC.width, this.srcC.height);
    }

    aplicarRecorte() {
      const r = this._recorte;
      const razaoNova = r.w / r.h;
      const razaoAtual = this.out.w / this.out.h;
      this.crop = { ...r };
      if (Math.abs(razaoNova - razaoAtual) > 0.005) {
        this.out = { w: this.out.w, h: Math.max(16, Math.round(this.out.w / razaoNova)) };
      }
      this.modo = "editar";
      this._baseSuja = true;
      this.marcar();
      this.desenhar();
    }

    cancelarRecorte() { this.modo = "editar"; this.desenhar(); }

    _desenharRecorte() {
      const W = this.srcC.width, H = this.srcC.height;
      const k = Math.min(1, 1600 / Math.max(W, H));
      const cw = Math.round(W * k), ch = Math.round(H * k);
      if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
      this._kRecorte = k;
      const x = this.ctx;
      x.clearRect(0, 0, cw, ch);
      x.drawImage(this.srcC, 0, 0, cw, ch);
      const r = this._recorte;
      const rx = r.x * k, ry = r.y * k, rw = r.w * k, rh = r.h * k;
      x.save();
      x.fillStyle = "rgba(20,20,22,.58)";
      x.beginPath(); x.rect(0, 0, cw, ch); x.rect(rx, ry, rw, rh); x.fill("evenodd");
      x.strokeStyle = "#fff"; x.lineWidth = Math.max(1.5, cw / 600);
      x.strokeRect(rx, ry, rw, rh);
      x.globalAlpha = 0.45; x.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        x.beginPath(); x.moveTo(rx + rw * i / 3, ry); x.lineTo(rx + rw * i / 3, ry + rh); x.stroke();
        x.beginPath(); x.moveTo(rx, ry + rh * i / 3); x.lineTo(rx + rw, ry + rh * i / 3); x.stroke();
      }
      x.globalAlpha = 1;
      const a = Math.max(10, cw / 70);
      x.fillStyle = "#EA0356";
      for (const [px, py] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
        x.fillRect(px - a / 2, py - a / 2, a, a);
      }
      x.restore();
    }

    // ------------------------------------------------------------ ponteiro
    _ponto(ev) {
      const r = this.cv.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * this.cv.width / r.width,
        y: (ev.clientY - r.top) * this.cv.height / r.height,
        escala: this.cv.width / r.width,
      };
    }

    _ligarPonteiro() {
      const cv = this.cv;
      let arraste = null;

      cv.addEventListener("pointerdown", (ev) => {
        if (!this.src) return;
        const p = this._ponto(ev);
        if (this.modo === "recorte") {
          const k = this._kRecorte, r = this._recorte;
          const tol = 22 * p.escala;
          const cantos = [
            { nome: "se", x: r.x, y: r.y }, { nome: "sd", x: r.x + r.w, y: r.y },
            { nome: "ie", x: r.x, y: r.y + r.h }, { nome: "id", x: r.x + r.w, y: r.y + r.h },
          ];
          const canto = cantos.find((c) => Math.hypot(c.x * k - p.x, c.y * k - p.y) < tol);
          const px = p.x / k, py = p.y / k;
          if (canto) arraste = { tipo: "canto", canto: canto.nome, ini: { ...r } };
          else if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) arraste = { tipo: "mover-recorte", dx: px - r.x, dy: py - r.y };
          else return;
          cv.setPointerCapture(ev.pointerId);
          return;
        }
        // edição: acerta texto (de cima para baixo) e depois a logo
        let alvo = null;
        for (let i = this.textos.length - 1; i >= 0; i--) {
          const c = this.textos[i]._caixa;
          if (c && p.x >= c.x0 && p.x <= c.x1 && p.y >= c.y0 && p.y <= c.y1) { alvo = this.textos[i]; break; }
        }
        const cl = this.logo._caixa;
        if (!alvo && cl && p.x >= cl.x0 && p.x <= cl.x1 && p.y >= cl.y0 && p.y <= cl.y1) {
          this.sel = "logo";
          arraste = { tipo: "logo", dx: p.x - cl.cx, dy: p.y - cl.cy, moveu: false };
        } else if (alvo) {
          this.sel = alvo.id;
          arraste = { tipo: "texto", t: alvo, dx: p.x - alvo.x * this.out.w, dy: p.y - alvo.y * this.out.h, moveu: false };
        } else {
          this.sel = null;
        }
        this.aoSelecionar(this.sel);
        this.desenhar();
        if (arraste) cv.setPointerCapture(ev.pointerId);
      });

      cv.addEventListener("pointermove", (ev) => {
        if (!this.src) return;
        const p = this._ponto(ev);
        if (!arraste) {
          if (this.modo === "editar") {
            const sobre = this.textos.some((t) => t._caixa && p.x >= t._caixa.x0 && p.x <= t._caixa.x1 && p.y >= t._caixa.y0 && p.y <= t._caixa.y1)
              || (this.logo._caixa && p.x >= this.logo._caixa.x0 && p.x <= this.logo._caixa.x1 && p.y >= this.logo._caixa.y0 && p.y <= this.logo._caixa.y1);
            cv.style.cursor = sobre ? "move" : "default";
          } else cv.style.cursor = "crosshair";
          return;
        }
        const W = this.out.w, H = this.out.h;
        if (arraste.tipo === "texto") {
          arraste.t.x = clamp((p.x - arraste.dx) / W, -0.2, 1);
          arraste.t.y = clamp((p.y - arraste.dy) / H, -0.2, 1);
          arraste.moveu = true;
        } else if (arraste.tipo === "logo") {
          this.logo.x = clamp((p.x - arraste.dx) / W, 0, 1);
          this.logo.y = clamp((p.y - arraste.dy) / H, 0, 1);
          arraste.moveu = true;
        } else if (arraste.tipo === "mover-recorte") {
          const k = this._kRecorte, r = this._recorte;
          r.x = clamp(p.x / k - arraste.dx, 0, this.srcC.width - r.w);
          r.y = clamp(p.y / k - arraste.dy, 0, this.srcC.height - r.h);
        } else if (arraste.tipo === "canto") {
          this._arrastarCanto(arraste, p.x / this._kRecorte, p.y / this._kRecorte);
        }
        this.desenhar();
      });

      const soltar = () => {
        if (arraste && (arraste.moveu || arraste.tipo === "texto" || arraste.tipo === "logo")) {
          if (arraste.moveu) { this.marcar(); this.aoSelecionar(this.sel); }
        }
        arraste = null;
      };
      cv.addEventListener("pointerup", soltar);
      cv.addEventListener("pointercancel", soltar);
    }

    _arrastarCanto(a, px, py) {
      const W = this.srcC.width, H = this.srcC.height, i = a.ini;
      // canto oposto fica fixo
      // se = superior esquerdo, sd = superior direito, ie = inferior esquerdo, id = inferior direito
      const fx = a.canto.endsWith("e") ? i.x + i.w : i.x;
      const fy = a.canto.startsWith("s") ? i.y + i.h : i.y;
      px = clamp(px, 0, W); py = clamp(py, 0, H);
      let w = Math.abs(px - fx), h = Math.abs(py - fy);
      const minimo = Math.max(24, Math.min(W, H) * 0.04);
      w = Math.max(minimo, w); h = Math.max(minimo, h);
      if (this.razaoRecorte) {
        const k = this.razaoRecorte;
        if (w / h > k) w = h * k; else h = w / k;
        const maxW = px < fx ? fx : W - fx, maxH = py < fy ? fy : H - fy;
        if (w > maxW) { w = maxW; h = w / k; }
        if (h > maxH) { h = maxH; w = h * k; }
      }
      const x = px < fx ? fx - w : fx;
      const y = py < fy ? fy - h : fy;
      this._recorte = limitar({ x, y, w, h }, W, H);
    }

    // ------------------------------------------------------------ exportar
    exportar(tipo = "image/png", qualidade = 0.92) {
      const c = document.createElement("canvas");
      c.width = this.out.w; c.height = this.out.h;
      const x = c.getContext("2d");
      if (tipo === "image/jpeg") { x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height); }
      this._baseSuja = true;
      this._compor(x, c.width, c.height, false);
      this._baseSuja = true;
      this.desenhar();
      return new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("Falha ao exportar.")), tipo, qualidade));
    }
  }

  // ------------------------------------------------------------ auxiliares
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function limitar(r, W, H) {
    r.w = Math.min(r.w, W); r.h = Math.min(r.h, H);
    r.x = clamp(r.x, 0, W - r.w); r.y = clamp(r.y, 0, H - r.h);
    return r;
  }
  function posicaoGrade(pos) {
    const i = Math.max(0, POSICOES.indexOf(pos));
    return [Math.floor(i / 3), i % 3];
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function retArredondado(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function contorno(ctx, c, W) {
    ctx.save();
    ctx.strokeStyle = "#EA0356";
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.setLineDash([W / 90, W / 140]);
    ctx.strokeRect(c.x0 - 4, c.y0 - 4, c.x1 - c.x0 + 8, c.y1 - c.y0 + 8);
    ctx.restore();
  }
  function quebrar(ctx, texto, maxW) {
    const saida = [];
    for (const par of String(texto).split("\n")) {
      const palavras = par.split(/\s+/).filter(Boolean);
      if (!palavras.length) { saida.push(""); continue; }
      let linha = palavras[0];
      for (let i = 1; i < palavras.length; i++) {
        const tentativa = linha + " " + palavras[i];
        if (ctx.measureText(tentativa).width <= maxW) linha = tentativa;
        else { saida.push(linha); linha = palavras[i]; }
      }
      saida.push(linha);
    }
    return saida;
  }
  // brilho, contraste, saturação e temperatura direto nos pixels
  // (funciona em todos os navegadores, inclusive Safari)
  function ajustarPixels(ctx, W, H, a) {
    if (!a.brilho && !a.contraste && !a.saturacao && !a.calor) return;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const b = a.brilho * 1.6;
    const c = a.contraste * 2.55;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    const s = 1 + a.saturacao / 100;
    const t = a.calor * 0.35;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], bl = d[i + 2];
      r = f * (r - 128) + 128 + b;
      g = f * (g - 128) + 128 + b;
      bl = f * (bl - 128) + 128 + b;
      const cinza = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = cinza + (r - cinza) * s + t;
      g = cinza + (g - cinza) * s;
      bl = cinza + (bl - cinza) * s - t;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    }
    ctx.putImageData(img, 0, 0);
  }

  window.CriaDigiEditor = { Editor, POSICOES };
})();
