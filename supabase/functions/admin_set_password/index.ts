// supabase/functions/admin_set_password/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ★ CORS 头：把 origin 改成你自己的后台域名（也可先用 '*' 方便调试）
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://indiadice.netlify.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 允许的管理员邮箱（按需修改）
const ADMIN_EMAIL_ALLOWLIST = new Set(["admin@gmail.com"]);

serve(async (req) => {
  // ★ 处理预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // 1) 验证调用者（管理员）
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!user.email || !ADMIN_EMAIL_ALLOWLIST.has(user.email)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) 读取参数
    const { user_id, new_password } = await req.json().catch(() => ({}));
    if (!user_id || typeof new_password !== "string" || new_password.length < 6) {
      return new Response(JSON.stringify({ error: "Missing/invalid params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) 用 service_role 改密码
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 可选：写审计日志…

    return new Response(JSON.stringify({ ok: true, user_id: data.user?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
