// supabase/functions/diceautodraw/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 初始化 Supabase
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// 获取印度时间（UTC+5:30）
function getIndianTime(offset = 0): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + (5.5 + offset) * 60 * 60 * 1000);
}

// 生成格式化期号（YYYYMMDDHHmm）
function getRoundNumber(time: Date): string {
  const year = time.getFullYear();
  const month = String(time.getMonth() + 1).padStart(2, "0");
  const day = String(time.getDate()).padStart(2, "0");
  const hour = String(time.getHours()).padStart(2, "0");
  const minute = String(time.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

// 主函数
serve(async () => {
  const now = getIndianTime();

  let insertCount = 0;
  for (let i = 0; i < 5; i++) {
    const roundTime = new Date(now.getTime() + i * 60 * 1000); // 每分钟递增
    const round_number = getRoundNumber(roundTime);

    const { data: existing } = await supabase
  .from("game_rounds")
  .select("id, is_manual")
  .eq("round_number", round_number)
  .maybeSingle();

if (!existing || !existing.is_manual) {
  // 写入结果
}


    if (!existing) {
      const result = Math.floor(Math.random() * 6) + 1;

      const { error } = await supabase.from("game_rounds").insert([
        {
          round_number,
          result,
          created_at: roundTime.toISOString(), // 写入印度时间
        },
      ]);

      if (!error) insertCount++;
    }
  }

  // ✅ 删除 1 天前的开奖数据
  const cleanTime = new Date(now);
  cleanTime.setMinutes(0, 0, 0);
  cleanTime.setDate(cleanTime.getDate() - 1);
  const threshold = getRoundNumber(cleanTime);

  await supabase
    .from("game_rounds")
    .delete()
    .lt("round_number", threshold);

  return new Response(`✅ Generated ${insertCount} new rounds & cleaned old`, { status: 200 });
});

