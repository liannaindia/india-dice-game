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
  return roundKey(new Date(start.getTime() - 120000)); // 取“上一期”
}

/** ===== 盘面与赔率 =====
 * result_index: 0..15  →  result_number: 3..18 (number = index + 3)
 * 需求：排除 index=0(=3) 与 index=15(=18) → 只允许 1..14
 */
const ALLOWED_INDEXES: number[] = Array.from({ length: 14 }, (_, i) => i + 1); // 1..14 → number 4..17

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

    // 查有没有且是否手动
    const { data: exist, error: qErr } = await sb
      .from<WheelRow>("wheel_rounds")
      .select("round_number, is_manual")
      .eq("round_number", round)
      .maybeSingle();
    if (qErr) throw qErr;

    if (exist?.is_manual) {
      // 手动结果锁定，不覆盖
      return json({ ok: true, round, status: "manual_locked_skip" });
    }

    if (exist) {
      // ✅ 已存在自动结果：不再改动（避免同一期被多次随机覆盖）
      return json({ ok: true, round, status: "already_exists_skip" });
    }

    // 生成允许的随机 index（1..14）→ 等价禁止开 3/18
    const ridx = ALLOWED_INDEXES[Math.floor(Math.random() * ALLOWED_INDEXES.length)];
    const num = ridx + 3;     // 1→4, 14→17
    const mult = ODDS[num];

    // 兜底断言（理论上不会触发）
    if (ridx === 0 || ridx === 15) throw new Error(`Guard: forbidden index ${ridx}`);
    if (num === 3 || num === 18) throw new Error(`Guard: forbidden number ${num}`);
    if (mult == null) throw new Error(`Guard: missing odds for number ${num}`);

    const payload = {
      round_number: round,
      result_index: ridx,
      result_number: num,
      result_multiplier: mult,
      is_manual: false
    };

    // 只插入一次：依赖 round_number 唯一键，重复则忽略
    const { error: insErr } = await sb
      .from("wheel_rounds")
      .insert([payload], { onConflict: "round_number", ignoreDuplicates: true } as any);
    if (insErr) throw insErr;

    return json({ ok: true, round, status: "auto_insert", result_index: ridx, result_number: num, mult });
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
