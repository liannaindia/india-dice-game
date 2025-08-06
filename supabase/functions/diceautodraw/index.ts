// supabase/functions/diceautodraw/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // 获取印度时间
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istTime = new Date(now.getTime() + istOffset)

  // 生成期号（例如 202508061406）
  const period = istTime.toISOString().replace(/[-:T.Z]/g, "").slice(0, 12)

  // 查询当前期是否已存在
  const { data: existing, error: checkError } = await supabase
    .from("game_rounds")
    .select("period")
    .eq("period", period)
    .maybeSingle()

  if (checkError) {
    return new Response(JSON.stringify({ error: checkError.message }), { status: 500 })
  }

  if (existing) {
    return new Response(JSON.stringify({ message: "This period already exists." }), { status: 200 })
  }

  // 生成3个骰子，范围 1~6
  const dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1)
  const total = dice.reduce((a, b) => a + b, 0)

  // 写入 game_rounds 表
  const { error: insertError } = await supabase.from("game_rounds").insert([{
    period,
    dice1: dice[0],
    dice2: dice[1],
    dice3: dice[2],
    total,
    created_at: istTime.toISOString()
  }])

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500 })
  }

  return new Response(JSON.stringify({
    message: "Result generated",
    period,
    dice,
    total
  }), { status: 200 })
})
