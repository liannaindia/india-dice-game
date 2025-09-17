// supabase/functions/abadmin_set_result/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Side = "andar" | "bahar";
type ABRound = {
  round_number: string;
  lead_rank: number | null;
  result_side: Side | null;
  match_index: number | null;
  is_manual?: boolean | null;
};

// ---- CORS（固定常量）----
const CORS = {
  "content-type": "application/json",
  // 上线建议改为你的站点，例如 "https://ganeshcasino.in"
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "vary": "Origin",
};

// ---- 时间工具（与业务无关）----
function nowIST() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset()*-60000 + 5.5*3600*1000);
}
function roundKey(d: Date) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  const h=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0');
  return `${y}${m}${day}${h}${mi}`;
}

serve(async (req) => {
  // ---- 先无条件处理预检，这一步必须在任何 env 读取之前 ----
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS, status: 200 });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok:false, error:"Method not allowed" }), { status: 405, headers: CORS });
  }

  // ---- 读取 env & 初始化（放在 OPTIONS 之后，避免预检失败）----
  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!; // 用于校验调用者身份（前端带的 Bearer）
  const ADMIN_EMAILS  = (Deno.env.get("ADMIN_EMAILS") ?? "admin@gmail.com")
    .split(",").map(s => s.trim().toLowerCase());

  const sbSvc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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
    const { data: bets, error: e1 } = await sbSvc.from("ab_bets")
      .select("id,user_id,amount,side,odds,status,settled_at")
      .eq("round_number", round_number);
    if (e1) throw e1;

    const { data: rd, error: e2 } = await sbSvc.from("ab_rounds")
      .select("result_side")
      .eq("round_number", round_number)
      .single();
    if (e2) throw e2;

    const winner = rd.result_side as Side;
    const updates: { id:number; status:"win"|"lose"; payout:number; settled_at:string }[]
