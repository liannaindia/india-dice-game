// supabase-config-admin.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

export const supabase = createClient(
  'https://gtoofdphwneqpwsmjcwl.supabase.co', // 你的 Supabase 管理后台项目 URL
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTYwODEsImV4cCI6MjA2OTg3MjA4MX0.XOlnadAyNTMLy8W-JQLyA7Kmh0dKBRslL3vXvx_ebj4' // 对应后台项目 anon 公钥
)
