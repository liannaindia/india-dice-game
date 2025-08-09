// supabase/functions/abautodraw/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type ABRound = {
  round_number: string;
  lead_rank: number | null;         // 1..13
  result_side: "andar"|"bahar" | null;
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

const randRank = () => Math.floor(Math.random()*13)+1;  // 1..13
const randSide = (): "andar"|"bahar" => Math.random()<0.5 ? "andar":"bahar";
const randHit  = () => [5,6,6,7,7,8,8,9,9,10,11,12][Math.floor(Math.random()*12)];

async function getRound(n:string){
  const { data, error } = await sb.from("ab_rounds")
    .select("round_number, lead_rank, result_side, match_index, is_manual")
    .eq("round_number", n).maybeSingle();
  if (error) throw error;
  return data as ABRound | null;
}

async function upsertRound(r: ABRound){
  const { error } = await sb.from("ab_rounds").upsert(r, { onConflict: "round_number" });
  if (error) throw error;
}

async function settle(round_number: string){
  // 读取该期投注
  const { data: bets, error: e1 } = await sb.from("ab_bets")
    .select("id,user_id,amount,side,odds,status")
    .eq("round_number", round_number);
  if (e1) throw e1;

  // 读结果
  const { data: rd, error: e2 } = await sb.from("ab_rounds")
    .select("result_side").eq("round_number", round_number).single();
  if (e2) throw e2;
  const winner = rd.result_side as "andar"|"bahar";

  const updates: { id:number; status:"win"|"lose"; payout:number; settled_at:string }[] = [];
  const balanceAdd: Record<string, number> = {};

  for (const b of bets||[]) {
    const win = b.side === winner;
    const odds = Number(b.odds ?? 1.95);
    const payout = win ? Number(b.amount)*odds : 0;
    updates.push({ id: b.id, status: win?"win":"lose", payout, settled_at: new Date().toISOString() });
    if (win && payout>0) balanceAdd[b.user_id] = (balanceAdd[b.user_id]||0) + payout;
  }

  if (updates.length){
    const { error: e3 } = await sb.from("ab_bets").upsert(updates);
    if (e3) throw e3;
  }

  // 加余额
  for (const [uid, delta] of Object.entries(balanceAdd)) {
    const { error: e4 } = await sb.rpc("increment_user_balance", { _user_id: uid, _delta: delta });
    if (e4) throw e4;
  }

  return { bets: bets?.length||0 };
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const prev = new Date(nowIST().getTime() - 60*1000);
    const round_number = body.round_number ?? roundKey(prev);

    // 若无结果则生成/或使用手动参数
    let r = await getRound(round_number);
    if (!r || !r.result_side || !r.lead_rank || !r.match_index){
      r = {
        round_number,
        result_side: (body.result_side ?? randSide()) as "andar"|"bahar",
        lead_rank: typeof body.lead_rank === "number" ? body.lead_rank : randRank(),
        match_index: typeof body.match_index === "number" ? body.match_index : randHit(),
        is_manual: !!(body.result_side || body.lead_rank || body.match_index),
      };
      await upsertRound(r);
    }

    const s = await settle(round_number);
    return new Response(JSON.stringify({ ok:true, round_number, round:r, settle:s }),
      { headers: { "content-type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: String(e) }), { status: 500 });
  }
});
