// supabase/functions/color2m_autodraw/index.ts
// 作用：计算“刚刚结束的 2 分钟期(IST)”并调用 RPC color2m_settle_period
// 可选强制结果：POST /functions/v1/color2m_autodraw?result=red|green|violet

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function pad(n: number) { return n.toString().padStart(2, "0"); }

function lastEnded2MinPeriodIST(nowUtc = new Date()): string {
  // UTC->IST (+5:30)
  const istMs = nowUtc.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getFullYear();
  const mon = pad(ist.getMonth() + 1);
  const d = pad(ist.getDate());
  const h = pad(ist.getHours());
  const m = ist.getMinutes();
  const evenMin = m - (m % 2);       // 最近的偶数分钟 = 最近一个2分钟窗口结束时刻
  return `${y}${mon}${d}${h}${pad(evenMin)}`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST", { status: 405 });
  }
  try {
    const url = new URL(req.url);
    const forced = url.searchParams.get("result"); // red|green|violet|null

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const period = lastEnded2MinPeriodIST();
    const { data, error } = await supabase.rpc("color2m_settle_period", {
      _period: period,
      _result: forced
    });

    if (error) {
      return new Response(JSON.stringify({ ok: false, period, error: error.message }), {
        status: 500, headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: true, period, data }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
});
