// CriaDigi - funcao "criadigi-gerar"
// Junta o manual de marca cadastrado pelo admin ao pedido do usuario e chama
// a API de imagem do Gemini. A chave GEMINI_API_KEY fica so aqui (Secrets).
//
// Com login (conta de dominio permitido): a arte e salva na conta.
// Sem login: a arte volta direto para o navegador e NAO e salva.
// Os limites de uso valem para os dois casos (tabela criadigi_uso).
//
// Publique com "Enforce JWT verification" DESLIGADO (o uso sem login precisa disso).
// Este arquivo e so ASCII de proposito: o editor do Supabase quebra com acentos.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROPORCOES = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const PAPEIS: Record<string, string> = {
  principal: "cor principal",
  secundaria: "cor secund\u00e1ria",
  apoio: "cor de apoio",
  fundo: "fundo",
  texto: "texto e detalhes escuros",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Parte = { type: "text"; text: string } | { type: "image"; mime_type: string; data: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "M\u00e9todo n\u00e3o permitido" }, 405);

  const GEMINI = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI) return json({ erro: "A chave GEMINI_API_KEY n\u00e3o foi configurada nos Secrets do Supabase." }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let body: any;
  try { body = await req.json(); } catch { return json({ erro: "Pedido inv\u00e1lido." }, 400); }

  const prompt = String(body.prompt || "").trim().slice(0, 2000);
  const proporcao = PROPORCOES.includes(body.proporcao) ? body.proporcao : "1:1";
  const quantidade = Math.min(4, Math.max(1, Number(body.quantidade) || 1));
  const base = body.base && body.base.data ? body.base : null;
  if (!prompt && !base) return json({ erro: "Escreva o que voc\u00ea quer criar." }, 400);
  if (base && String(base.data).length > 8_000_000) return json({ erro: "A imagem de base \u00e9 grande demais." }, 413);

  // ---- manual de marca
  const [{ data: marca }, { data: cores }, { data: estilo }] = await Promise.all([
    sb.from("criadigi_marca").select("*").eq("id", 1).single(),
    sb.from("criadigi_cores").select("*").order("ordem"),
    body.estilo_id
      ? sb.from("criadigi_estilos").select("*").eq("id", body.estilo_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!marca) return json({ erro: "Manual de marca n\u00e3o encontrado. Rode o setup.sql." }, 500);

  // ---- quem pede: conta (com login) ou visitante
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let user: any = null;
  if (token.split(".").length === 3) {
    const { data } = await sb.auth.getUser(token);
    user = data?.user || null;
  }
  const dominios = String(marca.dominios_conta || "").toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^@/, "")).filter(Boolean);
  const email = String(user?.email || "").toLowerCase();
  const conta = !!user && (!dominios.length || dominios.some((d) => email.endsWith("@" + d)));

  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "desconhecido").split(",")[0].trim();
  const origem = await hash("ip|" + ip);
  const cliente = await hash("cli|" + (/^[0-9a-f-]{36}$/i.test(String(body.cliente || "")) ? body.cliente : ip));

  // ---- limites de uso
  const umaHora = new Date(Date.now() - 3600_000).toISOString();
  const umDia = new Date(Date.now() - 86400_000).toISOString();
  const contar = async (filtro: (q: any) => any, desde: string) => {
    const q = sb.from("criadigi_uso").select("id", { count: "exact", head: true }).gte("criado_em", desde);
    const { count } = await filtro(q);
    return count || 0;
  };
  const totalDia = await contar((q) => q, umDia);
  if (totalDia + quantidade > (marca.limite_dia || 1000)) {
    return json({ erro: `A plataforma atingiu o limite de ${marca.limite_dia} imagens nas \u00faltimas 24 horas. Tente mais tarde.` }, 429);
  }
  let restanteHora = 0;
  if (conta) {
    const [h, d] = await Promise.all([
      contar((q) => q.eq("user_id", user.id), umaHora),
      contar((q) => q.eq("user_id", user.id), umDia),
    ]);
    if (h + quantidade > marca.conta_hora) return json({ erro: limiteMsg(marca.conta_hora, "hora", h, true) }, 429);
    if (d + quantidade > marca.conta_dia) return json({ erro: limiteMsg(marca.conta_dia, "dia", d, true) }, 429);
    restanteHora = marca.conta_hora - h - quantidade;
  } else {
    const [h, d, ipDia] = await Promise.all([
      contar((q) => q.eq("cliente", cliente).is("user_id", null), umaHora),
      contar((q) => q.eq("cliente", cliente).is("user_id", null), umDia),
      contar((q) => q.eq("origem", origem).is("user_id", null), umDia),
    ]);
    if (h + quantidade > marca.anon_hora) return json({ erro: limiteMsg(marca.anon_hora, "hora", h, false) }, 429);
    if (d + quantidade > marca.anon_dia) return json({ erro: limiteMsg(marca.anon_dia, "dia", d, false) }, 429);
    if (ipDia + quantidade > marca.anon_ip_dia) {
      return json({ erro: "O limite de uso sem login desta rede acabou por hoje. Entre com sua conta para continuar." }, 429);
    }
    restanteHora = marca.anon_hora - h - quantidade;
  }

  // ---- imagens de referencia da marca
  const maxRefs = Math.max(0, Math.min(6, marca.max_referencias ?? 4));
  const refs: Parte[] = [];
  if (maxRefs > 0) {
    const { data: arquivos } = await sb.from("criadigi_arquivos").select("*")
      .eq("tipo", "referencia").eq("ativo", true).order("criado_em", { ascending: false }).limit(maxRefs);
    for (const a of arquivos || []) {
      const { data: blob } = await sb.storage.from("criadigi-marca").download(a.caminho);
      if (!blob) continue;
      refs.push({ type: "image", mime_type: blob.type || "image/png", data: encodeBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
  }

  // ---- instrucao final
  const linhasCores = (cores || []).map((c: any) =>
    `- ${c.nome} ${String(c.hex).toUpperCase()} (${PAPEIS[c.papel] || c.papel})`).join("\n");
  const texto = [
    `Voc\u00ea \u00e9 o gerador oficial de imagens da marca ${marca.nome}. Crie uma \u00fanica imagem que siga rigorosamente o manual de marca abaixo.`,
    base
      ? `PEDIDO DO USU\u00c1RIO (edite a imagem base, a \u00faltima imagem anexada, mantendo sua composi\u00e7\u00e3o geral): ${prompt || "ajuste a imagem para ficar fiel \u00e0 marca"}`
      : `PEDIDO DO USU\u00c1RIO: ${prompt}`,
    estilo ? `ESTILO VISUAL: ${estilo.nome}. ${estilo.instrucao}` : "",
    marca.descricao ? `IDENTIDADE VISUAL DA MARCA: ${marca.descricao}` : "",
    linhasCores
      ? `PALETA OBRIGAT\u00d3RIA (use estas cores como dominantes, respeitando os pap\u00e9is; tons naturais como pele e sombras s\u00e3o permitidos):\n${linhasCores}`
      : "",
    marca.sempre ? `SEMPRE: ${marca.sempre}` : "",
    marca.nunca ? `NUNCA: ${marca.nunca}` : "",
    `COMPOSI\u00c7\u00c3O: formato ${proporcao}. Mantenha \u00e1reas limpas e com pouco detalhe perto das bordas para a aplica\u00e7\u00e3o posterior de logo e textos.`,
    marca.permitir_texto_ia
      ? ""
      : "N\u00e3o escreva nenhum texto, letra, n\u00famero, logotipo ou marca d'\u00e1gua na imagem. Textos e logo ser\u00e3o aplicados depois pela plataforma.",
    refs.length
      ? `As ${refs.length} imagens anexadas${base ? " antes da \u00faltima" : ""} s\u00e3o refer\u00eancias de estilo aprovadas da marca: siga a paleta, a luz, o tratamento e o acabamento delas, mas n\u00e3o copie seus objetos nem sua composi\u00e7\u00e3o.`
      : "",
  ].filter(Boolean).join("\n\n");

  const input: Parte[] = [{ type: "text", text: texto }, ...refs];
  if (base) input.push({ type: "image", mime_type: base.mime || "image/png", data: String(base.data) });

  const modelo = String(marca.modelo || "gemini-nano-banana-2.1");
  const tamanho = modelo.includes("lite") ? "1K" : (marca.resolucao || "2K");

  const tentativas = await Promise.allSettled(
    Array.from({ length: quantidade }, () => gerarImagem(GEMINI, modelo, input, proporcao, tamanho)),
  );

  const imagens: { id: string; url: string }[] = [];
  const erros: string[] = [];
  for (const t of tentativas) {
    if (t.status === "rejected") { erros.push(String(t.reason?.message || t.reason)); continue; }
    const img = t.value;
    await sb.from("criadigi_uso").insert({ user_id: conta ? user.id : null, cliente, origem });
    if (!conta) {
      // sem login: devolve a imagem direto, sem salvar
      imagens.push({ id: crypto.randomUUID(), url: `data:${img.mime};base64,${img.data}` });
      continue;
    }
    const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
    const caminho = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("criadigi-geracoes").upload(caminho, decodeBase64(img.data), { contentType: img.mime });
    if (up.error) { erros.push(up.error.message); continue; }
    const { data: linha } = await sb.from("criadigi_geracoes").insert({
      user_id: user.id, email: user.email, prompt, estilo: estilo?.nome || null,
      formato: body.formato || proporcao, caminho, modelo,
    }).select("id").single();
    const { data: pub } = sb.storage.from("criadigi-geracoes").getPublicUrl(caminho);
    imagens.push({ id: linha?.id || caminho, url: pub.publicUrl });
  }

  if (!imagens.length) return json({ erro: traduzirErro(erros[0] || "Nenhuma imagem foi gerada.") }, 502);
  return json({ imagens, erros: erros.map(traduzirErro), salvo: conta, restante_hora: Math.max(0, restanteHora + (quantidade - imagens.length)) });
});

// ---------------------------------------------------------------------------
function limiteMsg(limite: number, periodo: string, usado: number, conta: boolean) {
  const resta = Math.max(0, limite - usado);
  const base = resta > 0
    ? `Voc\u00ea pode gerar s\u00f3 mais ${resta} imagem(ns) nesta ${periodo === "hora" ? "hora" : "janela de 24 horas"}. Diminua as varia\u00e7\u00f5es.`
    : `Limite de ${limite} imagens por ${periodo} atingido.`;
  return conta ? base + " Tente mais tarde." : base + " Entre com sua conta para gerar mais e salvar suas artes.";
}

async function gerarImagem(chave: string, modelo: string, input: Parte[], proporcao: string, tamanho: string) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      input,
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: proporcao, image_size: tamanho },
    }),
  });
  if (res.status === 404) return gerarImagemLegado(chave, modelo, input, proporcao, tamanho);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `Gemini respondeu ${res.status}`);
  const img = extrairImagem(j);
  if (!img) throw new Error("O Gemini n\u00e3o devolveu imagem (o pedido pode ter sido bloqueado pelos filtros de seguran\u00e7a).");
  return img;
}

// Rota antiga (generateContent), usada so se a rota nova nao existir para o modelo.
async function gerarImagemLegado(chave: string, modelo: string, input: Parte[], proporcao: string, tamanho: string) {
  const parts = input.map((p) => p.type === "text"
    ? { text: p.text }
    : { inline_data: { mime_type: p.mime_type, data: p.data } });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: proporcao, imageSize: tamanho } },
      }),
    },
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `Gemini respondeu ${res.status}`);
  const img = extrairImagem(j);
  if (!img) throw new Error("O Gemini n\u00e3o devolveu imagem (o pedido pode ter sido bloqueado pelos filtros de seguran\u00e7a).");
  return img;
}

function extrairImagem(j: any): { data: string; mime: string } | null {
  if (j?.output_image?.data) return { data: j.output_image.data, mime: j.output_image.mime_type || "image/png" };
  let ultima: any = null;
  for (const s of j?.steps || []) {
    if (s.type !== "model_output") continue;
    for (const c of s.content || []) if (c.type === "image" && c.data) ultima = c;
  }
  if (ultima) return { data: ultima.data, mime: ultima.mime_type || "image/png" };
  for (const c of j?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) return { data: d.data, mime: d.mimeType || d.mime_type || "image/png" };
    }
  }
  return null;
}

async function hash(texto: string) {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto + "|criadigi"));
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function traduzirErro(msg: string) {
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return "A chave do Gemini \u00e9 inv\u00e1lida. Confira o Secret GEMINI_API_KEY.";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) return "Cota do Gemini esgotada no momento. Confira o faturamento no Google AI Studio ou tente em alguns minutos.";
  if (/billing/i.test(msg)) return "A gera\u00e7\u00e3o de imagens exige faturamento ativo na conta do Google AI Studio.";
  if (/safety|blocked|bloquead/i.test(msg)) return "O pedido foi bloqueado pelos filtros de seguran\u00e7a do Gemini. Reformule o texto.";
  return msg;
}
