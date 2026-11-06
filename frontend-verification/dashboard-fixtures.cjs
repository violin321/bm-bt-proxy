// Deliberately synthetic. Used only by local preview and browser verification.
function fixtureStats(sources, url) {
  const week = url.searchParams.get('window') === 'week';
  const now = new Date(), start = new Date(now); start.setHours(0,0,0,0); if(week) start.setDate(start.getDate()-6);
  const enabled = sources.filter(s=>s.enabled);
  const count = enabled.length ? (week ? 864 : 128) : 0;
  const names = ['星际穿越','流浪地球','三体','Interstellar','沙丘','阿凡达'];
  const logs = Array.from({length:count},(_,i)=>{
    const success = i%37===1 ? 0 : i%11===1 ? Math.max(0,enabled.length-1) : enabled.length;
    const outcome = success===enabled.length ? 'complete' : success ? 'partial' : 'failed';
    const at = new Date(now.getTime()-i*Math.max(1,(now-start)/(count+1))).toISOString();
    const details = enabled.map((s,j)=>({id:s.id,name:s.name,success:j<success,status_code:j<success?200:503,latency_ms:j<success?180+j*160:10000,count:j<success?20:0,error:j<success?null:'样例：上游暂不可用'}));
    return {id:count-i,at,origin:i%4===2?'test':'api',keyword:names[i%names.length],outcome,latency_ms:outcome==='complete'?600+i%13*30:10012,raw_count:success*20,unique_count:success?success*16:0,target_count:enabled.length,success_count:success,details};
  });
  const summary={requests:logs.length,complete:0,partial:0,failed:0,raw_count:0,unique_count:0,duplicate_count:0,success_rate:null,average_ms:null,p95_ms:null};
  logs.forEach(r=>{summary[r.outcome]++;summary.raw_count+=r.raw_count;summary.unique_count+=r.unique_count;});
  summary.duplicate_count=summary.raw_count-summary.unique_count;
  if(count){summary.success_rate=+(summary.complete/count*100).toFixed(1);summary.average_ms=Math.round(logs.reduce((a,r)=>a+r.latency_ms,0)/count);summary.p95_ms=logs.map(r=>r.latency_ms).sort((a,b)=>a-b)[Math.ceil(count*.95)-1];}
  const buckets=Array.from({length:week?7:24},(_,i)=>{const d=new Date(start);if(week)d.setDate(d.getDate()+i);return {label:week?`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`:String(i).padStart(2,'0')+':00',requests:0,latency_ms:0};});
  logs.forEach(r=>{const d=new Date(r.at),i=week?Math.floor((new Date(d.getFullYear(),d.getMonth(),d.getDate())-start)/86400000):d.getHours();if(buckets[i]){buckets[i].requests++;buckets[i].latency_ms+=r.latency_ms;}});
  buckets.forEach(b=>b.latency_ms=b.requests?Math.round(b.latency_ms/b.requests):null);
  const states=Object.fromEntries(sources.map(s=>{const matching=logs.flatMap(r=>r.details.filter(d=>d.id===s.id).map(d=>({...d,at:r.at})));return [s.id,{last:matching[0]||null,history:matching.slice(0,30).map(d=>({at:d.at,success:d.success}))}];}));
  const before = Number(url.searchParams.get('before')) || Infinity;
  const filtered=logs.filter(r=>r.id<before&&(url.searchParams.get('errors_only')!=='true'||r.outcome!=='complete'));
  return {window:week?'week':'today',utc_offset:-now.getTimezoneOffset(),start:start.toISOString(),updated_at:now.toISOString(),first_record_at:logs.at(-1)?.at||null,retention_days:30,max_records:50000,write_error:false,summary,buckets,sources:states,requests:filtered.slice(0,20),next_before:filtered.length>20?filtered[19].id:null};
}
module.exports = {fixtureStats};
