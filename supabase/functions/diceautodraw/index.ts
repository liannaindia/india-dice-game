// supabase/functions/diceautodraw/index.ts
// 每次执行：
// 1) 计算上一分钟(IST)的期号 -> 若该期未被手动设置(is_manual=true)，写入随机 1~6 的 result
// 2) 调用 settle_prev_minute 存储过程结算上一期注单
// 3) 清理 1 天前的历史记录
//
// 需要的表字段：
//   game_rounds(round_number text PK, result int, is_manual boolean default false, created_at timestamptz default now())
//   bets(..., round_number text, status text, payout numeric, ...)
// 需要的环境变量：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ===== 时间与期号（IST） =====
function getIndianTime(offsetMin = 0): Date {
  const nowUTC = new Date();
  const utcMs = nowUTC.getTime() + nowUTC.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60 * 1000 + offsetMin * 60 * 1000);
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
  return Math.floor(Math.random() * 6) + 1; // 1..6
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }

  try {
    const now = getIndianTime();          // 当前 IST
    const prev = getIndianTime(-1);       // 上一分钟 IST
    const prevRound = roundNo(prev);

    // === 1) 写入上一期结果（若未被手动设置） ===
    let wroteRound = false;
    {
      const { data: existing, error: qErr } = await supabase
        .from("game_rounds")
        .select("is_manual")
        .eq("round_number", prevRound)
        .maybeSingle();

      if (qErr) {
        console.error("query game_rounds error:", qErr);
        return new Response(
          JSON.stringify({ ok: false, step: "query_prev_round", error: qErr.message }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }

      if (!existing || !existing.is_manual) {
        const result = randResult();
        const { error: insErr } = await supabase
          .from("game_rounds")
          .upsert([{
            round_number: prevRound,
            result,
            is_manual: existing?.is_manual || false,
            created_at: now.toISOString(),
          }]);

        if (insErr) {
          console.error("insert game_rounds error:", insErr);
          return new Response(
            JSON.stringify({ ok: false, step: "upsert_prev_round", error: insErr.message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        wroteRound = true;
      }
    }

    // === 2) 结算上一期 ===
    // 你已有的存储过程，无参数：内部自行按“上一分钟”或“未结算期”处理
    const { error: settleErr } = await supabase.rpc("settle_prev_minute");
    if (settleErr) {
      console.error("settle_prev_minute error:", settleErr);
      // 不中断：结果已写入，下次还会重试结算
    }

    // === 3) 清理 1 天前旧数据 ===
    const cleanBase = getIndianTime();
    cleanBase.setMinutes(0, 0, 0);          // 对齐到整点（避免跨天字符串误删）
    cleanBase.setDate(cleanBase.getDate() - 1);
    const threshold = roundNo(cleanBase);
    // 尽量不中断，即使清理失败也不影响开奖与结算
    const { error: delRoundsErr } = await supabase
      .from("game_rounds")
      .delete()
      .lt("round_number", threshold);
    if (delRoundsErr) console.warn("cleanup game_rounds warn:", delRoundsErr.message);

    const { error: delBetsErr } = await supabase
      .from("bets")
      .delete()
      .lt("round_number", threshold);
    if (delBetsErr) console.warn("cleanup bets warn:", delBetsErr.message);

    return new Response(
      JSON.stringify({
        ok: true,
        wrote_prev_round: wroteRound,
        prev_round: prevRound,
        settled: !settleErr,
        cleanup: !(delRoundsErr || delBetsErr),
        ts_ist: now.toISOString(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    console.error("fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
