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

// 结算本期：只结算 pending
async function settleRound(rn: string) {
  // 取该期的开奖结果
  const { data: gr, error: roundErr } = await supabase
    .from("game_rounds")
    .select("round_number, result")
    .eq("round_number", rn)
    .maybeSingle();
  if (roundErr || !gr) return;

  const result = gr.result as number;

  // 抓未结算注单
  const { data: tickets, error: betsErr } = await supabase
    .from("bets")
    .select("*")
    .eq("round_number", rn)
    .eq("status", "pending");

  if (betsErr || !tickets || tickets.length === 0) return;

  // 逐单结算（量不大可直接循环；量大可以批量用存储过程处理）
  for (const t of tickets) {
    const isWin =
      (t.bet_type === "big" && result >= 4) ||
      (t.bet_type === "small" && result <= 3) ||
      (t.bet_type === "number" && t.choice === result);

    const payout = isWin ? Number(t.amount) * Number(t.odds) : 0;

    // 事务式：先标记注单，再派彩（只处理 pending，避免重复）
    // 1) 标记注单状态
    const { error: updBetErr } = await supabase
      .from("bets")
      .update({
        status: isWin ? "won" : "lost",
        payout,
        settled_at: new Date().toISOString(),
      })
      .eq("id", t.id)
      .eq("status", "pending"); // 防止重复结算

    if (updBetErr) continue;

    // 2) 派彩（仅赢才加余额）
    if (isWin && payout > 0) {
      await supabase
        .from("users")
        .update({ balance: (Number(t.user_balance) || undefined) }) // 占位避免 type 报错，无作用行可删
        .select(); // 占位
      // 直接累加（注意并发：这里量不大且同一轮只结一次，可接受）
      await supabase.rpc("sql", { q:
        `update users set balance = balance + ${payout}
         where id = '${t.user_id}'`
      }) as any; // 如果你不开启 RPC，可直接用 update + select balance; 这里示例为简化
      // 更通用写法（无 RPC）：
      // await supabase.from("users")
      //   .update({ balance: newBalance })
      //   .eq("id", t.user_id);
    }
  }
}

serve(async () => {
  const now = getIndianTime();

  // === 写入结果（你可以保留“每5分钟写5期”或改为只写当前一期） ===
  let insertCount = 0;
  for (let i = 0; i < 1; i++) { // 每次只写入当前期：想回到5期就把 1 改成 5
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

  // === 结算“刚刚写入/当前分钟”的这一期 ===
  const currentRound = roundNo(now);
  await settleRound(currentRound);

  // === 清理 1 天前旧数据 ===
  const clean = new Date(now);
  clean.setMinutes(0, 0, 0);
  clean.setDate(clean.getDate() - 1);
  const threshold = roundNo(clean);
  await supabase.from("game_rounds").delete().lt("round_number", threshold);
  await supabase.from("bets").delete().lt("round_number", threshold);

  return new Response(`OK: wrote=${insertCount}, settled=${currentRound}`, { status: 200 });
});
