// supabase/functions/diceautodraw/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function getIndianTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 19800000); // +5:30 (印度标准时间)
}

serve(async () => {
  const now = getIndianTime();

  const minutes = now.getMinutes().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const year = now.getFullYear();

  const round_number = `${year}${month}${day}${hours}${minutes}`;

  // 查询是否已经存在该期
  const { data: existing } = await supabase
    .from("game_rounds")
    .select("id")
    .eq("round_number", round_number)
    .maybeSingle();

  if (existing) {
    return new Response("Already drawn", { status: 200 });
  }

  // 随机生成一个骰子结果（1-6）
  const result = Math.floor(Math.random() * 6) + 1;

  const { error } = await supabase.from("game_rounds").insert([
    {
      round_number,
      result,
    },
  ]);

  if (error) {
    return new Response("Error inserting result: " + error.message, { status: 500 });
  }

  return new Response(`Drawn round ${round_number} with result ${result}`, { status: 200 });
});
