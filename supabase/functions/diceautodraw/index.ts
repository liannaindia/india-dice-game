// supabase/functions/diceautodraw/index.ts
// 逻辑：只在「整点 + GRACE_SECONDS」之后，写入“上一分钟”的结果并调用结算。
// 与前端严格对齐：Prev 只显示上一期。
// 需要的环境变量：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ===== 配置 =====
const GRACE_SECONDS = 5; // 只有到整点+5秒以后才结算上一期，避免提前结算

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
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  try {
    const now = getIndianTime();
    const sec = now.getSeconds();

    // 还没过保护时间就什么都不做（防止提前 10 多秒结算）
    if (sec < GRACE_SECONDS) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "too_early", sec }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // 上一分钟（要结算/写入的期）
    const prev = getIndianTime(-1);
    const prevRound = roundNo(prev);

    // 1) 写入上一期结果（若非手动）
    let wroteRound = false;
    const { data: existing, error: qErr } = await supabase
      .from("game_rounds")
      .select("is_manual")
      .eq("round_number", prevRound)
      .maybeSingle();
    if (qErr) {
      console.error("query game_rounds error:", qErr);
      return new Response(JSON.stringify({ ok: false, step: "query_prev", error: qErr.message }), {
        status: 500, headers: { "content-type": "application/json" },
      });
    }
    if (!existing || !existing.is_manual) {
      const result = randResult();
      const { error: insErr } = await supabase
        .from("game_rounds")
        .upsert([{ round_number: prevRound, result, is_manual: existing?.is_manual || false, created_at: now.toISOString() }]);
      if (insErr) {
        console.error("upsert game_rounds error:", insErr);
        return new Response(JSON.stringify({ ok: false, step: "upsert_prev", error: insErr.message }), {
          status: 500, headers: { "content-type": "application/json" },
        });
      }
      wroteRound = true;
    }

    // 2) 结算上一期（你已有的存储过程）
    const { error: settleErr } = await supabase.rpc("settle_prev_minute");
    if (settleErr) console.error("settle_prev_minute error:", settleErr);

    // 3) 清理 1 天前旧数据（不中断）
    const cleanBase = getIndianTime();
    cleanBase.setMinutes(0, 0, 0);
    cleanBase.setDate(cleanBase.getDate() - 1);
    const threshold = roundNo(cleanBase);
    const { error: delRoundsErr } = await supabase.from("game_rounds").delete().lt("round_number", threshold);
    if (delRoundsErr) console.warn("cleanup game_rounds warn:", delRoundsErr.message);
    const { error: delBetsErr } = await supabase.from("bets").delete().lt("round_number", threshold);
    if (delBetsErr) console.warn("cleanup bets warn:", delBetsErr.message);

    return new Response(JSON.stringify({
      ok: true,
      wrote_prev_round: wroteRound,
      prev_round: prevRound,
      settled: !settleErr,
      grace_used: GRACE_SECONDS,
      ts_ist: now.toISOString(),
    }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
