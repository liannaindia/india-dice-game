// supabase/functions/abautodraw/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// IST 工具
function istNow(offsetMin = 0): Date {
  const nowUTC = new Date();
  const utc = nowUTC.getTime() + nowUTC.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 60 * 60 * 1000 + offsetMin * 60 * 1000);
}
function roundNo(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}${m}${day}${h}${min}`;
}
function randRank(): number {
  const ranks = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // 11J,12Q,13K,14A
  return ranks[Math.floor(Math.random() * ranks.length)];
}
function randSide(): "andar"|"bahar" {
  return Math.random() < 0.5 ? "andar" : "bahar";
}

serve(async () => {
  const now = istNow();
  const currRound = roundNo(now);

  // 1) 若当前期未手动设置，则随机写入
  const { data: existing } = await supabase
    .from("ab_rounds").select("is_manual").eq("round_number", currRound).maybeSingle();

  if (!existing || !existing.is_manual) {
    const payload = {
      round_number: currRound,
      lead_rank: randRank(),
      result_side: randSide(),
      match_index: 1,
      is_manual: existing?.is_manual || false,
      created_at: now.toISOString()
    };
    await supabase.from("ab_rounds").upsert(payload);
  }

  // 2) 结算上一分钟
  const { error: settleErr } = await supabase.rpc("settle_ab_prev_minute");
  if (settleErr) console.error("settle_ab_prev_minute error:", settleErr.message);

  // 3) 清理1天前
  const clean = new Date(now);
  clean.setMinutes(0,0,0);
  clean.setDate(clean.getDate() - 1);
  const threshold = roundNo(clean);
  await supabase.from("ab_rounds").delete().lt("round_number", threshold);
  await supabase.from("ab_bets").delete().lt("round_number", threshold);

  return new Response("OK", { status: 200 });
});
