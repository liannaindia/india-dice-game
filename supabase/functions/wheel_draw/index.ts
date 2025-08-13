// 只需把 URL/ANON KEY 用环境变量，和你之前 diceautodraw 的做法一致
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

function istKey(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  const y=ist.getFullYear(), m=("0"+(ist.getMonth()+1)).slice(-2), d=("0"+ist.getDate()).slice(-2);
  const h=("0"+ist.getHours()).slice(-2), mi=("0"+ist.getMinutes()).slice(-2);
  return `${y}${m}${d}${h}${mi}`;
}

serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 结算“上一分钟”
  const now = new Date();
  const prev = new Date(now.getTime() - 60_000);
  const round = istKey(prev);

  // 调用数据库函数结算
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/wheel_settle_round`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ p_round: round })
  });

  return new Response(res.ok ? "ok" : await res.text(), { status: res.status });
});
