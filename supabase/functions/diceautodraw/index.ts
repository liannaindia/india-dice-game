// supabase/functions/diceautodraw/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// 获取印度时间（UTC + 5:30）
function getIndianTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 60 * 60 * 1000);
}

serve(async () => {
  const now = getIndianTime();

  const minutes = now.getMinutes().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const year = now.getFullYear();

  const round_number = `${year}${month}${day}${hours}${minutes}`;

  // 检查过去60秒是否已写入任何记录（避免重复开奖）
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from("game_rounds")
    .select("id")
    .gte("created_at", oneMinuteAgo)
    .maybeSingle();

  if (recent) {
    return new Response("Already drawn (time window)", { status: 200 });
  }

  // 生成一个 1~6 的随机骰子结果
  const result = Math.floor(Math.random() * 6) + 1;

  const { error } = await supabase.from("game_rounds").insert([
    {
      round_number,
      result,
      created_at: now.toISOString(),  // 👈 手动写入印度时间
    },
  ]);

  if (error) {
    return new Response("Error inserting result: " + error.message, { status: 500 });
  }

  return new Response(`✅ Drawn round ${round_number} with result ${result}`, { status: 200 });
});
