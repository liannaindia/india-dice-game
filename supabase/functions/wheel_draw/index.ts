// supabase/functions/wheel_draw/index.ts
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

function istDate(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 60 * 60 * 1000);
}
function istKey2m(d: Date) {
  const t = istDate(d);
  const evenMin = t.getMinutes() - (t.getMinutes() % 2); // 桶起始偶数分
  t.setMinutes(evenMin, 0, 0);
  const y=t.getFullYear(), m=("0"+(t.getMonth()+1)).slice(-2), day=("0"+t.getDate()).slice(-2);
  const h=("0"+t.getHours()).slice(-2), mi=("0"+t.getMinutes()).slice(-2);
  return `${y}${m}${day}${h}${mi}`;
}

serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 结算“上一桶”（2分钟）
  const prevBucket = new Date(Date.now() - 120_000);
  const round = istKey2m(prevBucket);

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/wheel_settle_round`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ p_round: round })
  });

  const body = await res.text();
  return new Response(JSON.stringify({ round, upstream: res.status, body: body || null }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
});
