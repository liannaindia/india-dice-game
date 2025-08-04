// supabase-config.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://gtoofdphwneqpwsmjcwl.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0b29mZHBod25lcXB3c21qY3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyOTYwODEsImV4cCI6MjA2OTg3MjA4MX0.XOlnadAyNTMLy8W-JQLyA7Kmh0dKBRslL3vXvx_ebj4'

export const supabase = createClient(supabaseUrl, supabaseKey)
