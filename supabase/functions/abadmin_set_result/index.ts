// supabase/functions/abadmin_set_result/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Env =====
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!; // 用于 getUser()
const ADMIN_EMAILS  = (Deno.env.get("ADMIN_EMAILS") ?? "admin@gmail.com")
  .split(",").map(s => s.trim().toLowerCase());

// ===== CORS =====
const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "https://ganeshcasino.in", // 上线可改为 https://ganeshcasino.in
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

// ===== Supabase (service role) =====
const sbSvc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ===== Types & helpers =====
type Side = "andar" | "bahar";
type ABRound = {
  round_number: string;
  lead_rank: number | null;
  result_side: Side | null;
  match_index: number | null;
  is_manual?: boolean | null;
};

function nowIST() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * -60000 + 5.5 * 3600 * 1000);
}
function roundKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}${m}${day}${h}${mi}`;
}

// ===== DB helpers =====
async function getRound(n: string) {
  const { data, error } = await sbSvc
    .from("ab_rounds")
    .select("round_number, lead_rank, result_side, match_index, is_manual")
    .eq("round_number", n)
    .maybeSingle();
  if (error) throw error;
  return data as ABRound | null;
}

async function upsertRound(r: ABRound) {
  const { error } = await sbSvc.from("ab_rounds").upsert(r, { onConflict: "round_number" });
  if (error) throw error;
}

async function roundAlreadySettled(n: string) {
  const { count, error } = await sbSvc
    .from("ab_bets")
    .select("*", { count: "exact", head: true })
    .eq("round_number", n)
    .not("settled_at", "is", null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function settle(round_number: string) {
  const { data: bets, error: e1 } = await sbSvc
    .from("ab_bets")
    .select("id,user_id,amount,side,odds,status,settled_at")
    .eq("round_number", round_number);
  if (e1) throw e1;

  const { data: rd, error: e2 } = await sbSvc
    .from("ab_rounds")
    .select("result_side")
    .eq("round_number", round_number)
    .single();
  if (e2) throw e2;

  const winner = rd.result_side as Side;
  if (!winner) return { updated: 0 };

  const updates: { id: number; status: "win" | "lose"; payout: number; settled_at: string }[] = [];
  const balanceAdd: Record<string, number> = {};

  for (const b of bets ?? []) {
    if (b.settled_at) continue; // 已结算跳过

    const win = b.side === winner;
    const odds = Number(b.odds ?? 1.95);
    const payout = win ? Number(b.amount) * odds : 0;

    updates.push({
      id: b.id,
      status: win ? "win" : "lose",
      payout,
      settled_at: new Date().toISOString(),
    });

    if (win && payout > 0) {
      balanceAdd[b.user_id] = (balanceAdd[b.user_id] || 0) + payout;
    }
  }

  if (updates.length) {
    const { error: e3 } = await sbSvc.from("ab_bets").upsert(updates);
    if (e3) throw e3;
  }

  for (const [uid, delta] of Object.entries(balanceAdd)) {
    const { error: e4 } = await sbSvc.rpc("increment_user_balance", {
      _user_id: uid,
      _delta: delta,
    });
    if (e4) throw e4;
  }

  return { updated: updates.length };
}

// ===== HTTP handler =====
serve(async (req) => {
  // CORS 预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: CORS,
    });
  }

  try {
    // 鉴权（使用调用方 JWT）
    const authHeader = req.headers.get("Authorization") ?? "";
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: CORS,
      });
    }
    const email = String(user.email || "").toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden: not admin" }), {
        status: 403,
        headers: CORS,
      });
    }

    // 读取参数
    const body = await req.json().catch(() => ({}));
    const prev = new Date(nowIST().getTime() - 60 * 1000);
    const round_number: string = body.round_number ?? roundKey(prev);
    const result_side = String(body.result_side || "").toLowerCase();
    if (!["andar", "bahar"].includes(result_side)) {
      return new Response(
        JSON.stringify({ ok: false, error: "result_side must be 'andar' or 'bahar'" }),
        { status: 400, headers: CORS },
      );
    }
    const force: boolean = !!body.force;

    if (!force && (await roundAlreadySettled(round_number))) {
      return new Response(
        JSON.stringify({ ok: false, error: "Round already settled. Use force=true to override." }),
        { status: 409, headers: CORS },
      );
    }

    const existing = await getRound(round_number);
    const payload: ABRound = {
      round_number,
      result_side: result_side as Side,
      lead_rank: typeof body.lead_rank === "number" ? body.lead_rank : existing?.lead_rank ?? null,
      match_index:
        typeof body.match_index === "number" ? body.match_index : existing?.match_index ?? null,
      is_manual: true,
    };

    await upsertRound(payload);

    const s = await settle(round_number);

    return new Response(JSON.stringify({ ok: true, round_number, round: payload, settle: s }), {
      headers: CORS,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: CORS,
    });
  }
});
