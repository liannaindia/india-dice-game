// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Wingo 颜色池：数字 0-9 对应颜色
const COLORS = ["red","green","blue","purple","yellow","pink","orange","cyan","black","white"];

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE")!,
  { auth: { persistSession: false } }
);

Deno.serve(async () => {
  try {
    const round = previousRoundNo();

    // 查该期是否存在
    const { data: exist, error: qErr } = await sb
      .from("color2m_rounds")
      .select("round_number,is_manual")
      .eq("round_number", round)
      .maybeSingle();
    if (qErr) throw qErr;

    if (exist?.is_manual) {
      return json({ ok: true, round, status: "manual_locked_skip" });
    }
    if (exist) {
      return json({ ok: true, round, status: "already_exists_skip" });
    }

    // 随机生成结果
    const num = Math.floor(Math.random() * 10); // 0-9
    const color = COLORS[num];

    // 插入
    const { error: insErr } = await sb.from("color2m_rounds").insert([{
      round_number: round,
      result_color: color,
      result_number: num,
      is_manual: false
    }]);
    if (insErr) throw insErr;

    return json({ ok: true, round, status: "auto_insert", result_number: num, result_color: color });
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
