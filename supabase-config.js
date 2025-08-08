import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://gtoofdphwneqpwsmjcwl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTYwODEsImV4cCI6MjA2OTg3MjA4MX0.XOlnadAyNTMLy8W-JQLyA7Kmh0dKBRslL3vXvx_ebj4';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  }
});
// ====== Andar Bahar Functions ======

// 创建下注
export async function placeABBet(userId, roundNumber, side, amount) {
  try {
    const { error } = await supabase
      .from('ab_bets')
      .insert([{
        user_id: userId,
        round_number: roundNumber,
        side,
        amount,
        status: 'pending'
      }]);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Error placing AB bet:", err.message);
    return { success: false, message: err.message };
  }
}

// 获取当前回合信息
export async function getABCurrentRound() {
  const { data, error } = await supabase
    .from('ab_rounds')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) {
    console.error("Error fetching AB current round:", error.message);
    return null;
  }
  return data;
}

// 获取用户最近 N 条 Andar Bahar 下注记录
export async function getABUserBets(userId, limit = 10) {
  const { data, error } = await supabase
    .from('ab_bets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Error fetching AB bets:", error.message);
    return [];
  }
  return data;
}
