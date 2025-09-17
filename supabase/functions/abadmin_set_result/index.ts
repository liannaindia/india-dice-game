// supabase/functions/abadmin_set_result/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!; // 用于校验调用者身份
const ADMIN_EMAILS  = (Deno.env.get("ADMIN_EMAILS") ?? "admin@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()); // 多个用逗号分隔

// 用 service-role 做数据写入
const sbSvc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type ABRound = {
  round_number: string;
  lead_rank: number | null;
  result_side: "andar" | "bahar" | null;
  match_index: number | null;
  is_manual?: boolean | null;
};

function nowIST() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset()*-60000 + 5.5*3600*1000);
}
function roundKey(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  const h=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0');
  return `${y}${m}${day}${h}${mi}`;
}

async function getRound(n: string) {
  const { data, error } = await sbSvc.from("ab_rounds")
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

async function settle(round_number: string) {
  const { data: bets, error: e1 } = await sbSvc.from("ab_bets")
    .select("id,user_id,amount,side,odds,status,settled_at")
    .eq("round_number", round_number);
  if (e1) throw e1;

  const { data: rd, error: e2 } = await sbSvc.from("ab_rounds")
    .select("result_side")
    .eq("round_number", round_number)
    .single();
  if (e2) throw e2;
  const winner = rd.result_side as "andar"|"bahar";

  const updates: { id:number; status:"win"|"lose"; payout:number; settled_at:string }[] = [];
  const balanceAdd: Record<string, number> = {};

  for (const b of (bets ?? [])) {
    // 已结算的跳过
    if (b.settled_at) continue;

    const win = b.side === winner;
    const odds = Number(b.odds ?? 1.95);
    const payout = win ? Number(b.amount) * odds : 0;
    updates.push({ id: b.id, status: win ? "win" : "lose", payout, settled_at: new Date().toISOString() });
    if (win && payout > 0) balanceAdd[b.user_id] = (balanceAdd[b.user_id] || 0) + payout;
  }

  if (updates.length) {
    const { error: e3 } = await sbSvc.from("ab_bets").upsert(updates);
    if (e3) throw e3;
  }

  for (const [uid, delta] of Object.entries(balanceAdd)) {
    const { error: e4 } = await sbSvc.rpc("increment_user_balance", { _user_id: uid, _delta: delta });
    if (e4) throw e4;
  }

  return { updated: updates.length };
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

serve(async (req) => {
  // CORS
  const cors = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok:false, error:"Method not allowed" }), { status: 405, headers: cors });
  }

  try {
    // 校验调用者是管理员（用调用端的 Bearer token 获取当前用户）
    const authHeader = req.headers.get("Authorization") ?? "";
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok:false, error:"Unauthorized" }), { status: 401, headers: cors });
    }
    const email = (user.email ?? "").toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      return new Response(JSON.stringify({ ok:false, error:"Forbidden: not admin" }), { status: 403, headers: cors });
    }

    const body = await req.json().catch(() => ({}));
    const prev = new Date(nowIST().getTime() - 60 * 1000);
    const round_number: string = body.round_number ?? roundKey(prev);
    const result_side = String(body.result_side || "").toLowerCase();
    if (!["andar","bahar"].includes(result_side)) {
      return new Response(JSON.stringify({ ok:false, error:"result_side must be 'andar' or 'bahar'" }), { status: 400, headers: cors });
    }
    const force: boolean = !!body.force;

    if (!force && (await roundAlreadySettled(round_number))) {
      return new Response(JSON.stringify({ ok:false, error:"Round already settled. Use force=true to override." }), { status: 409, headers: cors });
    }

    const existing = await getRound(round_number);
    const payload: ABRound = {
      round_number,
      result_side: result_side as "andar"|"bahar",
      // 保留已有 main rank / hit 序号；如果你想必填也可以从 body 传入
      lead_rank: typeof body.lead_rank === "number" ? body.lead_rank : (existing?.lead_rank ?? null),
      match_index: typeof body.match_index === "number" ? body.match_index : (existing?.match_index ?? null),
      is_manual: true,
    };
    await upsertRound(payload);

    const s = await settle(round_number);
    return new Response(JSON.stringify({ ok:true, round_number, round: payload, settle: s }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: String(e) }), { status: 500, headers: cors });
  }
});
