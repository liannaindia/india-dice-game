// supabase-config.js  —— 用户端（前台站点）
// 使用 CDN ESM 版 supabase-js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ⚠️ 前端只能使用 anon 公钥，千万不要用 service_role
const supabaseUrl = 'https://gtoofdphwneqpwsmjcwl.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTYwODEsImV4cCI6MjA2OTg3MjA4MX0.XOlnadAyNTMLy8W-JQLyA7Kmh0dKBRslL3vXvx_ebj4'

// 自定义一个独立的 storageKey，避免与“管理员项目”的会话冲突
const AUTH_STORAGE_KEY = 'dice_user_supabase_auth_v1'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'public',
  },
  auth: {
    // 前端需要自动续期与持久化登录
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: AUTH_STORAGE_KEY,
  },
  global: {
    // 可选的全局 fetch/headers。不要带多余的自定义 Header，以免触发 CORS 预检或 4xx。
    headers: {
      'X-Client-Info': 'india-dice-frontend',
    },
  },
  // 可选：限制实时事件速率，稳定一些浏览器环境
  realtime: {
    params: { eventsPerSecond: 2 },
  },
})

// 可选：导出一个小工具，检查连接是否可用（调试用）
export async function pingSupabase() {
  try {
    const { data, error } = await supabase.from('_ping').select('*').limit(1)
    // 大多数项目没有 _ping 表，这里只验证 SDK 是否正常工作
    return { ok: !error, error }
  } catch (e) {
    return { ok: false, error: e }
  }
}
