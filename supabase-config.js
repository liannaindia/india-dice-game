// supabase-config.js  —— 直接覆盖这个文件即可
// 说明：前端只用 anon key；千万不要把 service_role 放到前端！

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ====== 你的项目配置（已填好）======
const supabaseUrl = 'https://gtoofdphwneqpwsmjcwl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTYwODEsImV4cCI6MjA2OTg3MjA4MX0.XOlnadAyNTMLy8W-JQLyA7Kmh0dKBRslL3vXvx_ebj4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
  }
});

/* ===================================================================
 *                       Common helpers（可选）
 * =================================================================== */

// 当前登录用户
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// 用户余额
export async function getUserBalance(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data?.balance ?? 0;
}

/* ===================================================================
 *                 Andar Bahar API（使用 RPC，避免直插）
 * =================================================================== */

// 原子下注（扣款 + 封盘校验 + 写注单）
// side: 'andar' | 'bahar'
export async function placeABBetNow({ userId, email, side, amount, odds }) {
  return await supabase.rpc('place_ab_bet_now', {
    _user_id: userId,
    _email: email,
    _side: side,
    _amount: amount,
    _odds: odds
  });
}

// 上一期结果（传入上一期 round_number，返回 'andar' | 'bahar' | null）
export async function getABPrevResult(prevRoundNumber) {
  const { data, error } = await supabase
    .from('ab_rounds')
    .select('result_side')
    .eq('round_number', prevRoundNumber)
    .maybeSingle();
  if (error) throw error;
  return data?.result_side ?? null;
}

// 用户最近 N 条 AB 注单（只读）
export async function getABUserBets(userId, limit = 10) {
  const { data, error } = await supabase
    .from('ab_bets')
    .select('round_number, side, amount, status, payout, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// （可选）读取某个期号详情
export async function getABRound(roundNumber) {
  const { data, error } = await supabase
    .from('ab_rounds')
    .select('*')
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
