// supabase/functions/abadmin_set_result/index.ts
// Deno Deploy / Supabase Edge Functions
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Env =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "admin@gmail.com")
  .split(",")
  .map((s) => s.trim().toLowerCase());
const DEBUG = (Deno.env.get("DEBUG") ?? "true").toLowerCase() === "true"; // 默认开启，排查完可关

// ===== CORS =====
const CORS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

// ===== Supabase Clients =====
// service-role：读写数据库
const sbSvc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
// anon：仅用于 getUser(accessToken) 校验来访者身份
const sbAnon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

// ===== Helpers =====
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function ensureEnv() {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ANON_KEY) missing.push("SUPABASE_ANON_KEY");
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

type Payload = {
  game?: string;                 // e.g. "ab" / "andarbahar" / 任意占位
  round_number: string;          // 必填，如 "202509172227"
  result_side: "andar" | "bahar"; // 必填：赢家方
  match_index?: number | null;   // 可选：第几张中
  force?: boolean;               // 可选：是否强制立即结算（会尝试调用存储过程）
};

async function getAuthUserEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization")?.trim();
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await sbAnon.auth.getUser(token);
  if (error) throw new Error(`auth.getUser failed: ${error.message}`);
  return data.user?.email?.toLowerCase() ?? null;
}

// ===== Main =====
serve(async (req) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    if (req.method !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed. Use POST." });
    }

    // 1) 环境检查
    ensureEnv();

    // 2) 身份校验（必须是管理员邮箱）
    const email = await getAuthUserEmail(req);
    if (!email) {
      return json(401, { ok: false, error: "Unauthorized: missing or invalid Bearer token." });
    }
    if (!ADMIN_EMAILS.includes(email)) {
      return json(403, { ok: false, error: `Forbidden: ${email} is not in ADMIN_EMAILS.` });
    }

    // 3) 解析/校验 body
    let payload: Payload;
    try {
      payload = await req.json();
    } catch {
      // 有些前端没设 content-type 或 body 为空，这里给出友好提示
      const raw = await req.text();
      return json(400, {
        ok: false,
        error: "Bad Request: body must be JSON.",
        hint: "Set headers: {'Content-Type':'application/json'} and pass a JSON stringified body.",
        rawReceived: raw ?? "",
      });
    }

    const errors: string[] = [];
    if (!payload.round_number || typeof payload.round_number !== "string") {
      errors.push("round_number (string) is required");
    }
    if (payload.result_side !== "andar" && payload.result_side !== "bahar") {
      errors.push("result_side must be 'andar' or 'bahar'");
    }
    if (payload.match_index != null && typeof payload.match_index !== "number") {
      errors.push("match_index, if provided, must be a number");
    }
    if (errors.length) return json(400, { ok: false, error: "Invalid payload", details: errors });

    const { round_number, result_side, match_index, force } = payload;

    // 4) 写入回合结果（只负责“设置结果+标记手工”，真实结算交给触发器/存储过程）
    // 你项目中表名可能是 ab_rounds（推荐），如不同请改这里。
    // 字段假设：round_number(text) PK/unique, result_side(text), is_manual(boolean), match_index(int), result_set_at(timestamptz)
    const now = new Date().toISOString();

    // 4.1 若存在则更新，若不存在则插入（upsert）
    const { data: upserted, error: upsertErr } = await sbSvc
      .from("ab_rounds")
      .upsert(
        {
          round_number,
          result_side,
          is_manual: true,
          match_index: match_index ?? null,
          result_set_at: now,
        },
        { onConflict: "round_number" },
      )
      .select("*")
      .single();

    if (upsertErr) {
      throw new Error(`upsert ab_rounds failed: ${upsertErr.message}`);
    }

    // 5) 可选：强制结算（如果你有存储过程 ab_settle_round(round text, force boolean)）
    let settleInfo: unknown = null;
    if (force) {
      const { data: rpcData, error: rpcErr } = await sbSvc.rpc("ab_settle_round", {
        p_round_number: round_number,
        p_force: true,
      });
      if (rpcErr) {
        // 不让它 500，直接把错误返回给前端，便于你判断“存储过程是否存在/参数是否匹配”
        settleInfo = { ok: false, rpc: "ab_settle_round", error: rpcErr.message };
      } else {
        settleInfo = { ok: true, rpc: "ab_settle_round", data: rpcData };
      }
    }

    return json(200, {
      ok: true,
      admin: email,
      saved: {
        round_number: upserted.round_number,
        result_side: upserted.result_side,
        match_index: upserted.match_index ?? null,
        is_manual: upserted.is_manual ?? true,
        result_set_at: upserted.result_set_at ?? now,
      },
      settle: settleInfo,
    });
  } catch (err) {
    // 把错误既打印到 Supabase Logs，也返回到前端（DEBUG=true 时包含堆栈）
    console.error("abadmin_set_result error:", err);
    return json(500, {
      ok: false,
      error: (err as Error)?.message ?? String(err),
      name: (err as Error)?.name ?? "Error",
      stack: DEBUG ? (err as Error)?.stack ?? null : undefined,
      hint:
        "Check: 1) ADMIN_EMAILS includes your account 2) request body JSON 3) env secrets set 4) table/columns exist 5) optional RPC 'ab_settle_round' exists if force=true.",
    });
  }
});
