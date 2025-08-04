// index.ts - 自动开奖逻辑
import { createClient } from './supabase.ts'

const supabase = createClient()

Deno.serve(async () => {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const yyyy = ist.getFullYear()
  const mm = String(ist.getMonth() + 1).padStart(2, '0')
  const dd = String(ist.getDate()).padStart(2, '0')
  const hh = String(ist.getHours()).padStart(2, '0')
  const min = String(ist.getMinutes()).padStart(2, '0')
  const periodId = `${yyyy}${mm}${dd}${hh}${min}`

  const dice = [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1
  ]
  const total = dice.reduce((a, b) => a + b, 0)

  const { error } = await supabase.from('game_rounds').insert({
    round_number: parseInt(periodId),
    result_dice: dice,
    total: total
  })

  if (error) {
    console.error('Insert error:', error)
    return new Response('Error inserting result', { status: 500 })
  }

  return new Response('Draw success')
})
