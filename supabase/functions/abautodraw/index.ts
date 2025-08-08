// supabase/functions/abautodraw/index.ts
// 功能：每分钟执行一次，生成上一期 Andar Bahar 结果（或尊重手动指定），写入 ab_rounds；
//      随后结算该期 ab_bets，更新 win/lose 和 payout，并把中奖金额加到 users.balance。

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type RoundRow = {
  round_number: string;
  lead_rank: string | null;
  result_side: "andar" | "bahar" | null;
  match_index: number | null;
  is_manual?: boolean | null;
};

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

// 获取印度时间
function nowIST(): Date {
  const now = new Date();
  // IST = UTC+5:30
  return new Date(now.getTime() + now.getTimezoneOffset()*-60000 + 5.5*3600*1000);
}
function roundKey(d: Date): string {
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  const h=String(d.getHours()).padStart(2,"0");
  const min=String(d.getMinutes()).padStart(2,"0");
  return `${y}${m}${day}${h}${min}`;
}

function pickLeadRank(): string {
  // 均匀分布即可；若你要偏好分布可以在这里自定义
  return RANKS[Math.floor(Math.random()*RANKS.length)];
}
function pickMatchIndex(): number {
  // 第5~12张更常见，分布略向中间倾斜
  const candidates = [5,6,6,7,7,7,8,8,8,9,9,10,11,12];
  return candidates[Math.floor(Math.random()*candidates.length)];
}
function pickSide(): "andar"|"bahar" {
  return Math.random()<0.5 ? "andar":"bahar";
}

async function upsertRound(row: RoundRow) {
  const { error } = await supabase
    .from("ab_rounds")
    .upsert(row, { onConflict: "round_number" });
  if (error) throw error;
}

async function fetchRound(round_number: string): Promise<RoundRow|null> {
  const { data, error } = await supabase
    .from("ab_rounds")
    .select("round_number, lead_rank, result_side, match_index, is_manual")
    .eq("round_number", round_number)
    .maybeSingle();
  if (error) throw error;
  return data as RoundRow | null;
}

async function settleRound(round_number: string) {
  // 读该期结果
  const round = await fetchRound(round_number);
  if (!round || !round.result_side) return { settled: 0 };

  const winner = round.result_side;

  // 拉取待结算投注
  const { data: bets, error: betErr } = await supabase
    .from("ab_bets")
    .select("id, user_id, amount, side, odds, status")
    .eq("round_number", round_number)
    .eq("status", "pending");
  if (betErr) throw betErr;

  if (!bets || bets.length === 0) return { settled: 0 };

  // 计算每个投注的中奖金额
  type UpdateRow = { id: number; status: "win"|"lose"; payout: number };
  const updates: UpdateRow[] = [];
  const balanceDelta: Record<string, number> = {}; // user_id -> +payout

  for (const b of bets) {
    const win = b.side === winner;
    const odds = Number(b.odds ?? 1.95);
    const payout = win ? Number(b.amount) * odds : 0;
    updates.push({ id: b.id, status: win ? "win" : "lose", payout });

    if (win && payout > 0) {
      balanceDelta[b.user_id] = (balanceDelta[b.user_id] || 0) + payout;
    }
  }

  // 批量更新 ab_bets（分批避免 payload 过大）
  const batchSize = 1000;
  for (let i=0;i<updates.length;i+=batchSize){
    const slice = updates.slice(i,i+batchSize);
    const { error: upErr } = await supabase.from("ab_bets").upsert(slice);
    if (upErr) throw upErr;
  }

  // 批量更新 users.balance
  const entries = Object.entries(balanceDelta);
  for (let i=0;i<entries.length;i+=batchSize){
    const slice = entries.slice(i,i+batchSize);
    const updatesUsers = slice.map(([user_id, delta])=> ({ id: user_id, balance: delta }));
    // 用 RPC 更安全；这里为了简洁直接累加（利用 SQL 表达式）
    for (const u of updatesUsers) {
      const { error: balErr } = await supabase
        .rpc("increment_user_balance", { _user_id: u.id, _delta: u.balance });
      if (balErr) throw balErr;
    }
  }

  return { settled: bets.length };
}

serve(async (req) => {
  try {
    // 允许可选 body 覆盖：{ round_number?, lead_rank?, result_side?, match_index?, dryRun? }
    const body = (await req.json().catch(()=> ({}))) as Partial<RoundRow> & { dryRun?: boolean };

    // 要结算/出结果的“上一分钟”
    const prev = new Date(nowIST().getTime() - 60*1000);
    const round_number = body.round_number ?? roundKey(prev);

    // 如果已经有该期，直接结算并返回
    let existing = await fetchRound(round_number);

    if (!existing) {
      // 生成结果（或尊重手动输入）
      const lead_rank = body.lead_rank ?? pickLeadRank();
      const result_side = (body.result_side as any) ?? pickSide();
      const match_index = body.match_index ?? pickMatchIndex();
      const is_manual = body.lead_rank || body.result_side || body.match_index ? true : false;

      const row: RoundRow = { round_number, lead_rank, result_side, match_index, is_manual };
      if (!body.dryRun) await upsertRound(row);
      existing = row as RoundRow;
    }

    // 结算该期
    const result = await settleRound(round_number);

    return new Response(
      JSON.stringify({
        ok: true,
        round_number,
        round: existing,
        settle: result,
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok:false, error: String(e) }), { status: 500 });
  }
});
