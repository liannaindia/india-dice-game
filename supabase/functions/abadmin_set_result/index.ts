// supabase/functions/abadmin_set_result/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Env =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "admin@gmail.com")
  .split(",").map(s=>s.trim().toLowerCase());
const DEBUG = (Deno.env.get("DEBUG") ?? "true").toLowerCase()==="true";

// ===== CORS =====
const CORS = {
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST, OPTIONS",
  "access-control-allow-headers":"authorization, x-client-info, apikey, content-type",
};

// ===== Supabase clients =====
const sbSvc  = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });
const sbAnon = createClient(SUPABASE_URL, ANON_KEY,    { auth:{ persistSession:false } });

// ===== utils =====
const j = (status:number, body:Record<string,unknown>) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

async function getUserEmail(req:Request){
  const h=req.headers.get("authorization")||"";
  if(!h.toLowerCase().startsWith("bearer ")) return null;
  const token=h.slice(7);
  const {data, error}=await sbAnon.auth.getUser(token);
  if(error) throw new Error("auth.getUser: "+error.message);
  return data.user?.email?.toLowerCase() ?? null;
}

// ---- 计算“当前 IST 期号(yyyyMMddHHmm)”并用于时序比较 ----
function istNowRound(): string {
  // IST = UTC+5:30
  const now = new Date(Date.now() + (5*60+30)*60*1000);
  const y = now.getUTCFullYear();
  const m = (now.getUTCMonth()+1).toString().padStart(2,"0");
  const d = now.getUTCDate().toString().padStart(2,"0");
  const hh= now.getUTCHours().toString().padStart(2,"0");
  const mm= now.getUTCMinutes().toString().padStart(2,"0");
  return `${y}${m}${d}${hh}${mm}`; // 每分钟一期开
}

type Payload = {
  round_number: string;               // 期号: yyyyMMddHHmm
  result_side: "andar"|"bahar";       // 结果
  match_index?: number|null;          // 可选：第几张
  force?: boolean;                    // 可选：越权允许改历史（默认不允许）
};

serve(async (req)=>{
  try{
    if(req.method==="OPTIONS") return new Response(null,{headers:CORS});
    if(req.method!=="POST")    return j(405,{ok:false,error:"Use POST"});

    if(!SUPABASE_URL||!SERVICE_KEY||!ANON_KEY){
      throw new Error("Missing env: SUPABASE_URL / SERVICE_ROLE / ANON");
    }

    const email = await getUserEmail(req);
    if(!email)  return j(401,{ok:false,error:"Unauthorized"});
    if(!ADMIN_EMAILS.includes(email)) return j(403,{ok:false,error:`Forbidden: ${email}`});

    let p:Payload;
    try{ p = await req.json(); }catch{
      const raw = await req.text();
      return j(400,{ok:false,error:"Body must be JSON",raw});
    }

    const { round_number, result_side, match_index=null, force=false } = p;

    if(!/^\d{12}$/.test(round_number)) {
      return j(400,{ok:false,error:"round_number must be 'yyyyMMddHHmm' 12 digits"});
    }
    if(result_side!=="andar" && result_side!=="bahar"){
      return j(400,{ok:false,error:"result_side must be 'andar'|'bahar'"});
    }

    // === 关键规则：只允许“当前期 & 未来期” ===
    const curr = istNowRound();               // 当前 IST 期号
    // 字符串比较可用，因为固定格式且等长
    const isPast = round_number < curr;

    if(isPast && !force){
      // 禁止修改历史期（除非 force）
      return j(409,{
        ok:false,
        error:"Past round is not editable without force=true",
        now_curr_ist: curr,
        your_round: round_number
      });
    }

    // === 写入结果（存在则更新，不存在则插入） ===
    const now = new Date().toISOString();
    const { data: up, error: upErr } = await sbSvc
      .from("ab_rounds")
      .upsert(
        { round_number, result_side, is_manual:true, match_index, result_set_at: now },
        { onConflict: "round_number" }
      )
      .select("*")
      .single();
    if(upErr) throw new Error("upsert ab_rounds: "+upErr.message);

    // === 可选：立即结算（如果你有对应存储过程） ===
    let settle:unknown=null;
    if(p.force){
      const { data: d, error: e } = await sbSvc.rpc("ab_settle_round", {
        p_round_number: round_number, p_force: true
      });
      settle = e ? { ok:false, rpc:"ab_settle_round", error:e.message } : { ok:true, data:d };
    }

    return j(200,{ ok:true, admin:email, saved:up, settle });
  }catch(err){
    console.error("abadmin_set_result:", err);
    return j(500,{
      ok:false,
      error: (err as Error).message || String(err),
      stack: DEBUG ? (err as Error).stack : undefined
    });
  }
});
