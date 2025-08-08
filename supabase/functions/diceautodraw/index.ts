// supabase/functions/diceautodraw/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// IST 工具
function getIndianTime(offsetMin = 0): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
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
function randResult(): number {
  return Math.floor(Math.random() * 6) + 1; // 1~6
}

serve(async () => {
  const now = getIndianTime();

  // === 1) 写入结果（保留每次只写当前期；你要写5期就把 for 的上限改 5） ===
  let insertCount = 0;
  for (let i = 0; i < 1; i++) {
    const t = getIndianTime(i); // i 分钟后
    const rn = roundNo(t);

    // 若该期不存在或不是手动设置，才写入
    const { data: existing } = await supabase
      .from("game_rounds")
      .select("is_manual")
      .eq("round_number", rn)
      .maybeSingle();

    if (!existing || !existing.is_manual) {
      const result = randResult();
      const { error } = await supabase.from("game_rounds").upsert([
        {
          round_number: rn,
          result,
          is_manual: existing?.is_manual || false,
          created_at: now.toISOString(),
        },
      ]);
      if (!error) insertCount++;
    }
  }

  // === 2) 结算“上一分钟”的注单（关键！避免时间竞态） ===
  const prev = new Date(now.getTime() - 60 * 1000);
  const prevRound = roundNo(prev);
  const { error: settleErr } = await supabase.rpc("settle_round", { _round: prevRound });
  if (settleErr) {
    console.error("settle_round failed:", settleErr.message);
  }

  // === 3) 清理 1 天前旧数据（可保留） ===
  const clean = new Date(now);
  clean.setMinutes(0, 0, 0);
  clean.setDate(clean.getDate() - 1);
  const threshold = roundNo(clean);
  await supabase.from("game_rounds").delete().lt("round_number", threshold);
  await supabase.from("bets").delete().lt("round_number", threshold);

  return new Response(`OK: wrote=${insertCount}, settled=${prevRound}`, { status: 200 });
});
