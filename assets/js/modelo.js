/* =====================================================================
   CriaDigi · templates (desenho compartilhado entre admin e criação)
   Ordem das camadas: arte de fundo → fotos → camada de cima → textos.
   Posições e tamanhos dos campos ficam em fração da arte (0 a 1).
   ===================================================================== */
(function () {
  "use strict";

  const ENTRELINHA = 1.15;

  async function carregar(tpl) {
    const { carregarImagem } = window.CriaDigi;
    const [base, sobre] = await Promise.all([
      carregarImagem(tpl.base_url),
      tpl.sobre_url ? carregarImagem(tpl.sobre_url).catch(() => null) : Promise.resolve(null),
    ]);
    return { base, sobre };
  }

  // quebra o texto em linhas e reduz a fonte até caber (largura e número de linhas)
  function ajustarTexto(ctx, campo, texto, W) {
    const bruto = campo.caixa_alta ? String(texto || "").toLocaleUpperCase("pt-BR") : String(texto || "");
    const maxW = Math.max(10, (campo.largura || 0.5) * W);
    const maxLinhas = Math.max(1, campo.linhas_max || 1);
    const inicial = Math.max(6, (campo.tamanho || 6) / 100 * W);
    const minimo = inicial * 0.4;
    let px = inicial, linhas = [];
    for (let i = 0; i < 40; i++) {
      ctx.font = fonteCss(campo, px);
      linhas = quebrar(ctx, bruto, maxW);
      const largas = linhas.some((l) => ctx.measureText(l).width > maxW + 0.5);
      if ((linhas.length <= maxLinhas && !largas) || px <= minimo) break;
      px = Math.max(minimo, px * 0.94);
    }
    if (linhas.length > maxLinhas) {
      linhas = linhas.slice(0, maxLinhas);
      let ult = linhas[maxLinhas - 1];
      while (ult.length > 1 && ctx.measureText(ult + "…").width > maxW) ult = ult.slice(0, -1);
      linhas[maxLinhas - 1] = ult.trimEnd() + "…";
    }
    return { linhas, px };
  }

  function fonteCss(campo, px) {
    return `${campo.peso || 700} ${px}px "${campo.fonte || "Hanken Grotesk"}", "Hanken Grotesk", system-ui, sans-serif`;
  }

  function quebrar(ctx, texto, maxW) {
    const saida = [];
    for (const par of String(texto).split("\n")) {
      const palavras = par.split(/\s+/).filter(Boolean);
      if (!palavras.length) { saida.push(""); continue; }
      let linha = palavras[0];
      for (let i = 1; i < palavras.length; i++) {
        const t = linha + " " + palavras[i];
        if (ctx.measureText(t).width <= maxW) linha = t;
        else { saida.push(linha); linha = palavras[i]; }
      }
      saida.push(linha);
    }
    return saida;
  }

  function caminhoForma(ctx, forma, x, y, w, h) {
    ctx.beginPath();
    if (forma === "circulo") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (forma === "arredondado") {
      const r = Math.min(w, h) * 0.08;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  // foto preenchendo a área (como "cover"), com zoom ≥ 1 e deslocamento −1..1
  function desenharFoto(ctx, campo, foto, W, H) {
    const x = campo.x * W, y = campo.y * H, w = campo.w * W, h = campo.h * H;
    const img = foto.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const escala = Math.max(w / iw, h / ih) * (foto.zoom || 1);
    const dw = iw * escala, dh = ih * escala;
    const folgaX = (dw - w) / 2, folgaY = (dh - h) / 2;
    const dx = x - folgaX + (foto.dx || 0) * folgaX;
    const dy = y - folgaY + (foto.dy || 0) * folgaY;
    ctx.save();
    caminhoForma(ctx, campo.forma, x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  function desenharVaga(ctx, campo, W, H, destaque) {
    const x = campo.x * W, y = campo.y * H, w = campo.w * W, h = campo.h * H;
    ctx.save();
    caminhoForma(ctx, campo.forma, x, y, w, h);
    ctx.fillStyle = "rgba(234, 3, 86, .12)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, W / 360);
    ctx.setLineDash([W / 70, W / 110]);
    ctx.strokeStyle = destaque ? "#EA0356" : "rgba(234, 3, 86, .7)";
    ctx.stroke();
    ctx.setLineDash([]);
    // ícone de pessoa
    const r = Math.min(w, h) * 0.16;
    const cx = x + w / 2, cy = y + h / 2 - r * 0.6;
    ctx.fillStyle = "rgba(234, 3, 86, .55)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 2.3, r * 1.7, r * 1.1, 0, Math.PI, 0); ctx.fill();
    ctx.font = `700 ${Math.max(11, Math.min(w, h) * 0.075)}px "Hanken Grotesk", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = "#EA0356";
    ctx.fillText(campo.rotulo || "Foto", cx, Math.min(y + h - Math.min(w, h) * 0.12, cy + r * 2.6));
    ctx.restore();
  }

  function desenharTexto(ctx, campo, texto, W, H) {
    const { linhas, px } = ajustarTexto(ctx, campo, texto, W);
    const x = campo.x * W, y = campo.y * H, larg = (campo.largura || 0.5) * W;
    ctx.save();
    ctx.font = fonteCss(campo, px);
    ctx.fillStyle = campo.cor || "#222323";
    ctx.textBaseline = "top";
    ctx.textAlign = campo.alinhar || "left";
    const ax = campo.alinhar === "center" ? x + larg / 2 : campo.alinhar === "right" ? x + larg : x;
    linhas.forEach((l, i) => ctx.fillText(l, ax, y + i * px * ENTRELINHA));
    ctx.restore();
    const alt = Math.max(1, campo.linhas_max || 1) * px * ENTRELINHA;
    return { x0: x, y0: y, x1: x + larg, y1: y + Math.max(alt, px * ENTRELINHA) };
  }

  // estado: { textos: { [id]: "texto" }, fotos: { [id]: { img, zoom, dx, dy } } }
  // ui: { vagas: true (mostra áreas sem foto), sel: id do campo destacado, caixas: true (contornos) }
  function desenhar(ctx, tpl, imgs, estado, ui = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(imgs.base, 0, 0, W, H);
    const caixas = {};
    const campos = tpl.campos || [];
    for (const c of campos.filter((x) => x.tipo === "foto")) {
      const f = estado.fotos && estado.fotos[c.id];
      if (f && f.img) desenharFoto(ctx, c, f, W, H);
      else if (ui.vagas) desenharVaga(ctx, c, W, H, ui.sel === c.id);
      caixas[c.id] = { x0: c.x * W, y0: c.y * H, x1: (c.x + c.w) * W, y1: (c.y + c.h) * H };
    }
    if (imgs.sobre) ctx.drawImage(imgs.sobre, 0, 0, W, H);
    for (const c of campos.filter((x) => x.tipo === "texto")) {
      const t = estado.textos && estado.textos[c.id] != null ? estado.textos[c.id] : (c.padrao || "");
      caixas[c.id] = desenharTexto(ctx, c, t, W, H);
    }
    if (ui.caixas || ui.sel) {
      for (const c of campos) {
        const k = caixas[c.id];
        if (!k) continue;
        if (!ui.caixas && ui.sel !== c.id) continue;
        ctx.save();
        ctx.lineWidth = Math.max(2, W / 400);
        ctx.strokeStyle = ui.sel === c.id ? "#EA0356" : "rgba(34, 35, 35, .45)";
        ctx.setLineDash(ui.sel === c.id ? [] : [W / 120, W / 160]);
        ctx.strokeRect(k.x0, k.y0, k.x1 - k.x0, k.y1 - k.y0);
        if (ui.sel === c.id && ui.alca) {
          const a = Math.max(12, W / 70);
          ctx.fillStyle = "#EA0356";
          ctx.fillRect(k.x1 - a / 2, k.y1 - a / 2, a, a);
          k.alca = { x: k.x1, y: k.y1, r: a };
        }
        ctx.restore();
      }
    }
    return caixas;
  }

  async function exportar(tpl, imgs, estado, tipo = "image/png", qualidade = 0.92) {
    const c = document.createElement("canvas");
    c.width = tpl.largura; c.height = tpl.altura;
    const ctx = c.getContext("2d");
    if (tipo === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
    desenhar(ctx, tpl, imgs, estado, {});
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao exportar."))), tipo, qualidade));
  }

  window.CriaDigiModelo = { carregar, desenhar, exportar, ajustarTexto };
})();
