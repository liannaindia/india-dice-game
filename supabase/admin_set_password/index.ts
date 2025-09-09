// supabase/functions/admin_set_password/index.ts
// 作用：仅允许管理员调用，直接为指定 user_id 设置新密码

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 你的管理员邮箱（根据你项目记忆要求）
const ADMIN_EMAIL_ALLOWLIST = new Set(["admin@gmail.com"]);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // 1) 用调用者的 JWT 校验是否为管理员
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (!user.email || !ADMIN_EMAIL_ALLOWLIST.has(user.email)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }

    // 2) 解析参数
    const { user_id, new_password } = await req.json().catch(() => ({}));
    if (!user_id || typeof new_password !== "string") {
      return new Response(JSON.stringify({ error: "Missing user_id or new_password" }), { status: 400 });
    }
    // 基本校验：长度/复杂度可按需增强
    if (new_password.length < 6) {
      return new Response(JSON.stringify({ error: "Password too short (min 6)" }), { status: 400 });
    }

    // 3) 用 service_role 调 Admin API 改密码
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // 可选：写一条审计日志到表 admin_audit_logs（如果你有）
    // await adminClient.from("admin_audit_logs").insert({
    //   actor_email: user.email,
    //   action: "set_password",
    //   target_user_id: user_id,
    // });

    return new Response(JSON.stringify({ ok: true, user_id: data.user?.id }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
