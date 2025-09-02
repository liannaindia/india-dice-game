// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** ===== 时间：IST，2 分钟一桶 ===== */
function getIST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600 * 1000);
}
function bucketStart2mIST(d: Date) {
  const t = new Date(d);
  const m = t.getMinutes();
  t.setMinutes(m - (m % 2), 0, 0);
  return t;
}
function roundKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${mi}`;
}
function previousRoundNo() {
  const start = bucketStart2mIST(getIST());
  return roundKey(new Date(start.getTime() - 120000));
}

/** ===== 盘面与赔率 =====
 * result_index: 0..15  →  result_number: 3..18 (number = index + 3)
 * 需求：排除 index=0(=3) 与 index=15(=18)
 */
const ALLOWED_INDEXES: number[] = Array.from({ length: 14 }, (_, i) => i + 1); // 1..14 → 4..17

const ODDS: Record<number, number> = {
  3: 180, 18: 180,
  4:  60, 17:  60,
  5:  30, 16:  30,
  6:  18, 15:  18,
  7:  12, 14:  12,
  8:   9, 13:   9,
  9:   8, 12:   8,
 10:   7, 11:   7,
};

type WheelRow = {
  round_number: string;
  result_index: number | null;        // 0..15
  result_number: number | null;       // 3..18
  result_multiplier: number | null;
  is_manual: boolean | null;
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE")!, // service_role，RLS 不生效
  { auth: { persistSession: false } }
);

Deno.serve(async () => {
  try {
    const round = previousRoundNo();

    // 1) 查该期是否存在 & 是否手动
    const { data: exist, error: qErr } = await sb
      .from<WheelRow>("wheel_rounds")
      .select("round_number, is_manual")
      .eq("round_number", round)
      .maybeSingle();
    if (qErr) throw qErr;

    if (exist?.is_manual) {
      // 手动结果：跳过，不能覆盖
      return json({ ok: true, round, status: "manual_locked_skip" });
    }

    // 2) 从允许索引均匀抽样（排除 0/15）
    const ridx = ALLOWED_INDEXES[Math.floor(Math.random() * ALLOWED_INDEXES.length)]; // 1..14
    const num = ridx + 3; // 1→4, 14→17
    const mult = ODDS[num];

    // 3) 兜底断言：任何异常直接中止（不落库）
    if (ridx === 0 || ridx === 15) throw new Error(`Guard: forbidden index ${ridx}`);
    if (num === 3 || num === 18) throw new Error(`Guard: forbidden number ${num}`);
    if (mult == null) throw new Error(`Guard: missing odds for number ${num}`);

    // 4) 写库：不存在则插入；存在（且非手动）则更新
    if (!exist) {
      const { error: insErr } = await sb.from("wheel_rounds").insert([{
        round_number: round,
        result_index: ridx,
        result_number: num,
        result_multiplier: mult,
        is_manual: false
      }]);
      if (insErr) throw insErr;
      return json({ ok: true, round, status: "auto_insert", result_index: ridx, result_number: num, mult });
    } else {
      const { error: updErr } = await sb
        .from("wheel_rounds")
        .update({
          result_index: ridx,
          result_number: num,
          result_multiplier: mult,
          is_manual: false
        })
        .eq("round_number", round);
      if (updErr) throw updErr;
      return json({ ok: true, round, status: "auto_update_non_manual", result_index: ridx, result_number: num, mult });
    }
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
