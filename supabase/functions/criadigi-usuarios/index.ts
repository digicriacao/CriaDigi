// CriaDigi - funcao "criadigi-usuarios"
// So admins usam (pelo painel admin). Lista contas, cria contas, troca senhas,
// define quem e admin e remove contas.
// Este arquivo e so ASCII de proposito: o editor do Supabase quebra com acentos.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  const eu = u?.user;
  if (!eu) return json({ erro: "Sess\u00e3o expirada. Entre novamente." }, 401);

  const { data: adminsRows } = await sb.from("criadigi_admins").select("email");
  const admins = new Set((adminsRows || []).map((a: any) => String(a.email).toLowerCase()));
  if (!admins.has((eu.email || "").toLowerCase())) return json({ erro: "Apenas administradores." }, 403);

  const body = await req.json().catch(() => ({}));
  const acao = body.acao;

  try {
    if (acao === "listar") {
      const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      // contas que geraram no CriaDigi (para mostrar quem usa)
      const { data: usos } = await sb.from("criadigi_geracoes").select("user_id");
      const total = new Map<string, number>();
      for (const g of usos || []) total.set(g.user_id, (total.get(g.user_id) || 0) + 1);
      return json({
        usuarios: data.users.map((x) => ({
          id: x.id,
          email: x.email,
          criado_em: x.created_at,
          ultimo_acesso: x.last_sign_in_at,
          admin: admins.has((x.email || "").toLowerCase()),
          artes: total.get(x.id) || 0,
        })),
      });
    }

    if (acao === "criar") {
      const email = String(body.email || "").trim().toLowerCase();
      const senha = String(body.senha || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "E-mail inv\u00e1lido." }, 400);
      if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
      if (error) throw error;
      if (body.admin) await sb.from("criadigi_admins").upsert({ email });
      return json({ ok: true });
    }

    if (acao === "senha") {
      const senha = String(body.senha || "");
      if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { error } = await sb.auth.admin.updateUserById(String(body.id), { password: senha });
      if (error) throw error;
      return json({ ok: true });
    }

    if (acao === "admin") {
      const email = String(body.email || "").toLowerCase();
      if (email === (eu.email || "").toLowerCase() && !body.valor) {
        return json({ erro: "Voc\u00ea n\u00e3o pode remover o seu pr\u00f3prio acesso de admin." }, 400);
      }
      if (body.valor) await sb.from("criadigi_admins").upsert({ email });
      else await sb.from("criadigi_admins").delete().eq("email", email);
      return json({ ok: true });
    }

    if (acao === "remover") {
      if (body.id === eu.id) return json({ erro: "Voc\u00ea n\u00e3o pode remover a pr\u00f3pria conta." }, 400);
      const { data: alvo } = await sb.auth.admin.getUserById(String(body.id));
      // apaga as artes salvas da pessoa no storage
      const { data: artes } = await sb.from("criadigi_geracoes").select("caminho").eq("user_id", String(body.id));
      if (artes?.length) await sb.storage.from("criadigi-geracoes").remove(artes.map((a: any) => a.caminho));
      const { error } = await sb.auth.admin.deleteUser(String(body.id));
      if (error) throw error;
      if (alvo?.user?.email) await sb.from("criadigi_admins").delete().eq("email", alvo.user.email.toLowerCase());
      return json({ ok: true });
    }

    return json({ erro: "A\u00e7\u00e3o desconhecida." }, 400);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    if (/already been registered|already exists/i.test(msg)) return json({ erro: "Esse e-mail j\u00e1 tem conta." }, 400);
    return json({ erro: msg }, 500);
  }
});
