import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg'; import dotenv from 'dotenv'; dotenv.config();
const exec = promisify(execFile);
const PX = process.env.WB_SEARCH_PROBE_PROXY;
const CHANGE = process.env.WB_PROXY_CHANGEIP;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FULL = 'ab_testing=false&appType=1&curr=rub&dest=-1257786&hide_dtype=13&lang=ru&page=1&resultset=catalog&sort=popular&spp=30&suppressSpellcheck=false';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function curl(args){ try { const {stdout}=await exec('curl',args,{maxBuffer:50*1024*1024}); return stdout; } catch(e){ return 'ERR:'+e.message; } }
async function ipNow(){ const o=await curl(['-s','--max-time','25','-x',PX,'https://api.ipify.org']); return o.trim(); }
async function rotate(){ const o=await curl(['-s','--max-time','40',CHANGE]); return o.slice(0,120).replace(/\s+/g,' '); }
async function searchCode(kw){
  const enc=encodeURIComponent(kw);
  const out=await curl(['-s','--max-time','30','--compressed','-x',PX,'-w','\nHTTPCODE:%{http_code}',
    `https://search.wb.ru/exactmatch/ru/common/v13/search?${FULL}&query=${enc}`,
    '-H','Accept: */*','-H','Origin: https://www.wildberries.ru','-H','User-Agent: '+UA]);
  const m=out.match(/HTTPCODE:(\d+)/); const code=m?m[1]:'000';
  let kind='other'; if(code==='429')kind='429'; else if(/catalog_type":"preset"/.test(out))kind='preset'; else if(/"products":\[\{/.test(out))kind='products'; else if(/"products":\[\]/.test(out))kind='empty';
  return {code,kind};
}
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect();
const {rows}=await c.query(`SELECT DISTINCT query_text FROM wb_cabinet_cluster_queries WHERE monthly_frequency BETWEEN 5000 AND 80000 AND query_text ~ ' .* ' LIMIT 80`);
await c.end();
const queries=rows.map(r=>r.query_text);
console.log('загружено запросов:',queries.length);
console.log('\nIP до ротации:', await ipNow());
console.log('ротация:', await rotate());
await sleep(8000);
console.log('IP после ротации:', await ipNow());
let qi=0;
for(let cycle=1; cycle<=2; cycle++){
  console.log(`\n--- цикл ${cycle} (свежий IP) ---`);
  const t0=Date.now(); let ok=0, n=0; const kinds={};
  while(qi<queries.length){
    const {code,kind}=await searchCode(queries[qi++]); n++;
    kinds[kind]=(kinds[kind]||0)+1;
    if(code==='429'){ console.log(`  429 на запросе #${n} (served ${ok})`); break; }
    ok++; await sleep(1000);
    if(n>=40) break;
  }
  const sec=((Date.now()-t0)/1000).toFixed(0);
  console.log(`  served до 429: ${ok} | попыток: ${n} | время: ${sec}с | типы:`, JSON.stringify(kinds));
  if(cycle<2){ console.log('  ротация:', await rotate()); await sleep(8000); console.log('  новый IP:', await ipNow()); }
}
