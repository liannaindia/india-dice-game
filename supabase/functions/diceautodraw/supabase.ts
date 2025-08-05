// supabase.ts - 服务端连接客户端
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

export function createClient() {
  return createClient(
    'https://gtoofdphwneqpwsmjcwl.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDI5NjA4MSwiZXhwIjoyMDY5ODcyMDgxfQ.FeSWIwT8kAdX6jfYK5LHridORHJXg0VGeqEQOFE1WSQ'
  )
}
