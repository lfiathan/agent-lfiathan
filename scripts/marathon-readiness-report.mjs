import 'dotenv/config';
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function pad(n){ return String(n).padStart(2,'0'); }
function fmtDateWIB(d){ const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d); const o=Object.fromEntries(p.map(x=>[x.type,x.value])); return `${o.year}-${o.month}-${o.day}`; }
function wibParts(d){ const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d); return Object.fromEntries(p.map(x=>[x.type,x.value])); }
function utcForWib(y,m,d,h=0,mi=0,s=0,ms=0){ return new Date(Date.UTC(y,m-1,d,h-7,mi,s,ms)); }
function currentWibYMD(){ const p=wibParts(new Date()); return [Number(p.year),Number(p.month),Number(p.day)]; }
function addDaysYMD(y,m,d,delta){ const x = utcForWib(y,m,d+delta,0,0,0,0); const p=wibParts(x); return [Number(p.year),Number(p.month),Number(p.day)]; }
function dayOfWeekWIB(d){ // Mon=1..Sun=7
  const wd = wibParts(d).weekday; return {Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[wd];
}
function secToHMS(sec){ sec=Math.round(sec||0); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return `${h}:${pad(m)}:${pad(s)}`; }
function pace(sec, km){ if(!km) return 'missing'; const ps=sec/km; const m=Math.floor(ps/60), s=Math.round(ps%60); return `${m}:${pad(s)}/km`; }
function bar(score){ const filled=Math.max(0,Math.min(10,Math.round(score))); return '▰'.repeat(filled)+'▱'.repeat(10-filled); }
function km(n){ return `${(Math.round((n||0)*10)/10).toFixed(1)}`; }
function percent(n){ if(n===null || !Number.isFinite(n)) return 'missing'; const r=Math.round(n); return `${r>=0?'+':''}${r}%`; }
function getRaw(a){ if(!a.raw) return {}; if(typeof a.raw==='object') return a.raw; try{return JSON.parse(a.raw)}catch{return {}} }
function isRun(a){ return /run/i.test(a.sport_type||'') || /run/i.test(getRaw(a).type||''); }
function summarize(rows){ const runs=rows.filter(isRun); const distKm=runs.reduce((s,a)=>s+Number(a.distance_m||0)/1000,0); const time=runs.reduce((s,a)=>s+Number(a.moving_time_s||0),0); const elev=runs.reduce((s,a)=>s+Number(a.total_elevation_gain_m||0),0); const longest=runs.reduce((m,a)=>Math.max(m,Number(a.distance_m||0)/1000),0); let hrs=[], maxhrs=[], speeds=[]; let bestSpeed=null;
  for(const a of runs){ const r=getRaw(a); if(r.average_heartrate!=null) hrs.push(Number(r.average_heartrate)); if(r.max_heartrate!=null) maxhrs.push(Number(r.max_heartrate)); if(r.average_speed!=null) speeds.push(Number(r.average_speed)); if(r.max_speed!=null) bestSpeed=Math.max(bestSpeed??0, Number(r.max_speed)); }
  return {runs, distKm,time,elev,longest, avgPace: pace(time,distKm), hrAvg: hrs.length?Math.round(hrs.reduce((a,b)=>a+b,0)/hrs.length):null, hrMax: maxhrs.length?Math.max(...maxhrs):null, bestPace: bestSpeed?pace(1000/bestSpeed,1):null};
}
function noteForRun(a){ const d=Number(a.distance_m||0)/1000; const r=getRaw(a); const bits=[]; if(d>=18) bits.push('long-run stimulus'); else if(d>=10) bits.push('aerobic volume'); else if(d>0) bits.push('short aerobic'); if(r.average_heartrate) bits.push(`HR ${Math.round(r.average_heartrate)} avg`); if(a.total_elevation_gain_m>50) bits.push(`${Math.round(a.total_elevation_gain_m)} m gain`); return bits.join(', ') || 'no extra signals'; }
function scoreReport(cur, prev, stale){ const dist=cur.distKm, runs=cur.runs.length, long=cur.longest; let endurance=Math.min(10, (dist/45)*5 + (long/24)*5); let consistency=Math.min(10, runs*2.2 + (dist>=25?1:0)); let injury=7; if(prev.distKm>0){ const ch=(dist-prev.distKm)/prev.distKm; if(ch>0.25) injury-=2; if(ch>0.5) injury-=2; if(ch<-0.4) injury-=1; } if(long>0 && dist>0 && long/dist>0.55) injury-=1.5; if(runs<=1 && dist>12) injury-=1; injury=Math.max(1,Math.min(10,injury)); let recovery=cur.hrAvg? (cur.hrAvg>155?5:7) : 6; if(stale) recovery-=1; const overall=Math.round((endurance*0.35+consistency*0.25+injury*0.25+recovery*0.15)*10)/10; return {overall,endurance,consistency,injury,recovery}; }
function status(score, injury){ if(score>=7 && injury>=6) return '🟢 Good'; if(score>=5 && injury>=4) return '🟡 Caution'; return '🔴 Risk'; }
function prescription(cur, prev){ const base = cur.distKm>0?cur.distKm:(prev.distKm||20); const target=Math.max(12, Math.round(base*1.05)); const freq=Math.max(3, Math.min(5, cur.runs.length+1 || 3)); const easy=Math.round(target*0.75); const long=Math.max(8, Math.round(target*0.35)); let intensity = cur.runs.length<3 ? 'skip hard work; rebuild frequency first' : '1 controlled tempo or strides session; no racing efforts'; return {freq,easy,long,intensity}; }
function dayName(a){ const wd=wibParts(new Date(a.start_date)).weekday; return wd; }
async function fetchJson(url, init={}, timeoutMs=15000){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {...init, signal: controller.signal});
    const text = await res.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return {ok: res.ok, status: res.status, body};
  } finally { clearTimeout(t); }
}
async function checkStravaWebhookFreshness(){
  if(!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET || !process.env.STRAVA_WEBHOOK_VERIFY_TOKEN){
    return {ok:false, reason:'missing Strava webhook env'};
  }
  const params = new URLSearchParams({client_id:process.env.STRAVA_CLIENT_ID, client_secret:process.env.STRAVA_CLIENT_SECRET});
  const listed = await fetchJson(`https://www.strava.com/api/v3/push_subscriptions?${params}`);
  if(!listed.ok) return {ok:false, reason:`subscription list HTTP ${listed.status}`};
  const subs = Array.isArray(listed.body) ? listed.body : [];
  if(!subs.length) return {ok:false, reason:'no Strava push subscription'};
  const callback = subs[0]?.callback_url;
  if(!callback) return {ok:false, reason:'subscription has no callback_url'};
  const challenge = `audit-${Date.now()}`;
  const probeUrl = new URL(callback);
  probeUrl.searchParams.set('hub.mode','subscribe');
  probeUrl.searchParams.set('hub.verify_token',process.env.STRAVA_WEBHOOK_VERIFY_TOKEN);
  probeUrl.searchParams.set('hub.challenge',challenge);
  const probed = await fetchJson(probeUrl.toString(), {}, 20000);
  if(!probed.ok || probed.body?.['hub.challenge'] !== challenge){
    return {ok:false, reason:`callback probe failed HTTP ${probed.status}`, callback};
  }
  return {ok:true, reason:'webhook subscription reachable', callback, subscriptionId:subs[0]?.id};
}
async function queryWindow(curStart, curEnd, prevStart, prevEnd){
  const q = `select user_id,name,sport_type,distance_m,moving_time_s,elapsed_time_s,total_elevation_gain_m,start_date,raw,updated_at from strava_activities where start_date >= $1 and start_date < $2 order by start_date desc`;
  const curRows=(await pool.query(q,[curStart.toISOString(),curEnd.toISOString()])).rows;
  const prevRows=(await pool.query(q,[prevStart.toISOString(),prevEnd.toISOString()])).rows;
  const fresh=(await pool.query(`select max(start_date) latest_start, max(updated_at) latest_update from strava_activities`)).rows[0];
  return {curRows, prevRows, latestStart:fresh?.latest_start, latestUpdate:fresh?.latest_update};
}
function syncStravaUsers(userIds){
  const errors=[];
  for(const uid of userIds){
    try {
      execFileSync('curl',['-sS','-X','POST',`http://127.0.0.1:3000/api/strava/${uid}/sync`,'-H','Content-Type: application/json','-d','{"page":1,"perPage":50}'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
    } catch(e){ errors.push(`${uid}: ${e.stderr?.toString().trim() || e.stdout?.toString().trim() || e.message}`); }
  }
  return errors;
}

try {
  const health = execFileSync('curl',['-sS','http://127.0.0.1:3000/health'],{encoding:'utf8'}).trim();
  const usersRes = await pool.query('select user_id from strava_connections order by user_id');
  const userIds = usersRes.rows.map(r=>r.user_id);
  const now=new Date(); const dow=dayOfWeekWIB(now); const [cy,cm,cd]=currentWibYMD(); const [sy,sm,sd]=addDaysYMD(cy,cm,cd,-(dow-1)); const curStart=utcForWib(sy,sm,sd); const curEnd=now; const [pSy,pSm,pSd]=addDaysYMD(sy,sm,sd,-7); const prevStart=utcForWib(pSy,pSm,pSd); const prevEnd=curStart;
  let syncStatus='webhook-db'; let syncErrors=[]; let freshness = {ok:false, reason:'not checked'};
  let {curRows, prevRows, latestStart, latestUpdate} = await queryWindow(curStart, curEnd, prevStart, prevEnd);
  try { freshness = await checkStravaWebhookFreshness(); } catch(e) { freshness = {ok:false, reason:e.message}; }
  if(!freshness.ok || (curRows.length === 0 && prevRows.length === 0)){
    syncErrors = syncStravaUsers(userIds);
    ({curRows, prevRows, latestStart, latestUpdate} = await queryWindow(curStart, curEnd, prevStart, prevEnd));
    syncStatus = syncErrors.length ? 'fallback-sync-failed' : 'fallback-synced';
  }
  const cur=summarize(curRows), prev=summarize(prevRows); const delta=prev.distKm>0?((cur.distKm-prev.distKm)/prev.distKm*100):null; const scores=scoreReport(cur,prev,syncStatus==='fallback-sync-failed');
  const rx=prescription(cur,prev);
  const recent=cur.runs.slice(0,6).map(a=>`• ${dayName(a)} — ${km(Number(a.distance_m)/1000)} km — ${noteForRun(a)}`);
  const green=[]; const watch=[];
  if(cur.runs.length>=3) green.push('Frequency is present; aerobic habit is intact.'); else watch.push(`Only ${cur.runs.length} run(s) logged in the current WIB week.`);
  if(cur.longest>=16) green.push(`Long run reached ${km(cur.longest)} km.`); else watch.push(`Long run is ${cur.longest?km(cur.longest)+' km':'missing'}; marathon-specific endurance is not yet proven this week.`);
  if(prev.distKm>0 && delta!==null && delta<=20 && delta>=-20) green.push(`Mileage change is controlled at ${percent(delta)} vs previous week.`); else if(delta!==null) watch.push(`Mileage changed ${percent(delta)} vs previous week; monitor load.`); else watch.push('Previous-week comparison is missing.');
  if(cur.hrAvg) green.push(`Average HR signal available: ${cur.hrAvg} bpm.`); else watch.push('Heart-rate and recovery signals are missing from stored raw data.');
  const recoveryNote = cur.hrAvg ? `avg HR ${cur.hrAvg} bpm; max ${cur.hrMax ?? 'missing'}` : 'HR/recovery unavailable';
  const enduranceNote = cur.longest>=18?'long-run base present':cur.distKm>0?'base building, long run limited':'no current-week running data';
  const consistencyNote = cur.runs.length>=3?'enough touchpoints':cur.runs.length?'needs more run frequency':'no frequency signal';
  const injuryNote = scores.injury>=7?'load appears controlled':scores.injury>=5?'watch load distribution':'elevated load-risk pattern';
  const latestLine = latestUpdate ? `latest DB update ${new Date(latestUpdate).toLocaleString('en-GB',{timeZone:'Asia/Jakarta',hour12:false})} WIB` : 'no DB update timestamp';
  const staleLine = syncStatus==='webhook-db'
    ? `DB-first via webhook (${freshness.reason}; ${latestLine})`
    : syncStatus==='fallback-synced'
      ? `fallback Strava sync used (${freshness.reason}; ${latestLine})`
      : `fallback sync failed — data may be stale (${freshness.reason}; ${syncErrors.join('; ')})`;
  const lines=[];
  lines.push('🏃 **Marathon Readiness**');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`**Score**: ${scores.overall.toFixed(1)}/10  ${bar(scores.overall)}`);
  lines.push(`**Status**: ${status(scores.overall,scores.injury)}`);
  lines.push(`**Period**: ${fmtDateWIB(curStart)} → ${fmtDateWIB(curEnd)} WIB`);
  lines.push(`**Sync**: ${staleLine}`);
  lines.push('');
  lines.push('📊 **Snapshot**');
  lines.push(`Distance   : ${km(cur.distKm)} km`);
  lines.push(`Runs       : ${cur.runs.length} sessions`);
  lines.push(`Long run   : ${cur.longest?km(cur.longest)+' km':'missing'}`);
  lines.push(`Time       : ${secToHMS(cur.time)}`);
  lines.push(`Pace       : ${cur.avgPace} avg`);
  lines.push(`Elevation  : ${Math.round(cur.elev)} m`);
  lines.push(`Week Δ     : ${percent(delta)}`);
  lines.push('');
  lines.push('🧭 **Signal Map**');
  lines.push(`Endurance  ${bar(scores.endurance)} ${enduranceNote}`);
  lines.push(`Consistency ${bar(scores.consistency)} ${consistencyNote}`);
  lines.push(`Injury risk ${bar(scores.injury)} ${injuryNote}`);
  lines.push(`Recovery   ${bar(scores.recovery)} ${recoveryNote}`);
  lines.push('');
  lines.push('✅ **Green Signals**');
  (green.length?green:['No strong green signal from current-week rows yet.']).forEach(x=>lines.push(`• ${x}`));
  lines.push('');
  lines.push('⚠️ **Watch List**');
  (watch.length?watch:['No major watch item detected from available rows.']).forEach(x=>lines.push(`• ${x}`));
  lines.push(`• Best pace: ${cur.bestPace ?? 'missing'}; zone durations: missing; recovery indicators: ${cur.hrAvg?'partial HR only':'missing'}.`);
  lines.push('');
  lines.push("🎯 **This Week's Prescription**");
  lines.push(`• Frequency: ${rx.freq} runs`);
  lines.push(`• Easy work: ${rx.easy} km conversational pace`);
  lines.push(`• Long run: ${rx.long} km`);
  lines.push(`• Intensity: ${rx.intensity}`);
  lines.push('• Recovery: 1–2 easy/rest days; stop escalation if soreness changes gait.');
  lines.push('');
  lines.push('🗓 **Recent Runs**');
  (recent.length?recent:['• missing — no current-week runs in DB rows']).forEach(x=>lines.push(x));
  lines.push('');
  lines.push('🔎 **Bottom Line**');
  const bottom = cur.runs.length===0 ? 'No current-week run data is available yet after sync. Treat readiness as unconfirmed until the next completed run appears.' : scores.overall>=7 ? 'Continue the plan with controlled progression. Preserve the easy volume; do not buy fitness with abrupt intensity.' : 'Build frequency before intensity. The smallest useful next step is an easy run, then a controlled long run if recovery remains normal.';
  lines.push(bottom);
  console.log(lines.join('\n'));
} finally { await pool.end(); }
