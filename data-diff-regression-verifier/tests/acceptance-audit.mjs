// Independent CLI acceptance cases, synthetic input only; no network or credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'data-verifier-acceptance-'));
const results=[];
const config={key:['/id']};
let serial=0;
function run(before,after,c=config,settings={}) {
  const dir=path.join(temp,String(++serial));fs.mkdirSync(dir);
  const b=path.join(dir,'before.'+(settings.beforeFormat||'json')),a=path.join(dir,'after.'+(settings.afterFormat||'json')),f=path.join(dir,'config.json');
  fs.writeFileSync(b,settings.rawBefore?before:JSON.stringify(before));
  fs.writeFileSync(a,settings.rawAfter?after:JSON.stringify(after));
  fs.writeFileSync(f,JSON.stringify(c));
  const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const hashes=[b,a,f].map(digest),start=performance.now();
  const p=spawnSync(process.execPath,[path.join(root,'scripts/cli.mjs'),'--baseline',b,'--current',a,'--config',f,'--json'],{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});
  assert.equal(p.error,undefined);assert.deepEqual([b,a,f].map(digest),hashes,'CLI altered an input');
  assert.equal(fs.readdirSync(dir).length,3,'CLI wrote an unexpected artifact');
  return {exit:p.status,report:JSON.parse(p.stdout),output:p.stdout,ms:Math.round(performance.now()-start)};
}
function check(name,fn) {try{const detail=fn();results.push({name,passed:true,...detail});}catch(e){results.push({name,passed:false,evidence:e.message});}}
function verdict(r,status,exit){assert.equal(r.report.status,status);assert.equal(r.exit,exit);return {status:r.report.status,ms:r.ms};}
try {
  check('A01 keyed reorder and property order',()=>verdict(run([{id:1,a:1},{id:2,a:2}],[{a:2,id:2},{a:1,id:1}]),'PASS',0));
  check('A02 one policy violation and one tolerated value',()=>{const r=run([{id:1,plan:'pro',score:10}],[{id:1,plan:'free',score:11}],{...config,rules:{'/plan':{allow_change:false},'/score':{tolerance:2}}});assert.equal(r.report.summary.regressions,1);assert.equal(r.report.summary.tolerated,1);return verdict(r,'FAIL',2);});
  check('A03 ignore timestamp without mutating input',()=>verdict(run([{id:1,updated:'old'}],[{id:1,updated:'new'}],{...config,ignore:['/updated']}),'PASS',0));
  check('A04 composite typed keys',()=>verdict(run([{a:'1',b:2},{a:1,b:2}],[{a:1,b:2},{a:'1',b:2}],{key:['/a','/b']}),'PASS',0));
  check('A05 duplicate keys stop comparison',()=>verdict(run([{id:1}],[{id:1},{id:1}]),'ERROR',64));
  check('A06 invalid UTF8 rejected without echo',()=>verdict(run(Buffer.from([0xff,0xfe]),[],config,{rawBefore:true}),'ERROR',64));
  check('A07 CSV versus JSON explicit typing',()=>verdict(run('id,score\r\n1,12\r\n',[{id:1,score:12}],{...config,csv_types:{'/id':'number','/score':'number'}},{beforeFormat:'csv',rawBefore:true}),'PASS',0));
  check('A08 nested protected field survives parent allow',()=>verdict(run([{id:1,p:{plan:'pro'}}],[{id:1,p:{plan:'free'}}],{...config,rules:{'/p':{allow_change:true},'/p/plan':{allow_change:false}}}),'FAIL',2));
  check('A09 missing parent of protected field',()=>verdict(run([{id:1,p:{plan:'pro'}}],[{id:1}],{...config,rules:{'/p/plan':{allow_change:false}}}),'FAIL',2));
  check('A10 unruled difference needs review',()=>verdict(run([{id:1,score:10}],[{id:1,score:11}]),'WARN',1));
  check('A11 input values and identifying keys hidden',()=>{const r=run([{id:'SYNTHETIC-PRIVATE-ID',note:'SYNTHETIC-PRIVATE-A'}],[{id:'SYNTHETIC-PRIVATE-ID',note:'SYNTHETIC-PRIVATE-B'}]);assert.ok(!r.output.includes('SYNTHETIC-PRIVATE'));return verdict(r,'WARN',1);});
  check('A12 allowed additions and forbidden removals',()=>verdict(run([{id:1}],[{id:2}],{...config,records:{added:'allow',removed:'forbid'}}),'FAIL',2));
  check('A13 fifty thousand records, reversed order, one violation',()=>{const a=Array.from({length:50000},(_,i)=>({id:i,plan:'pro',score:i%100}));const b=a.map(x=>({...x})).reverse();b[123].plan='free';const r=run(a,b,{...config,rules:{'/plan':{allow_change:false}}});assert.equal(r.report.summary.matched_records,50000);assert.equal(r.report.summary.regressions,1);return verdict(r,'FAIL',2);});
  check('A14 over-limit data rejected',()=>verdict(run(Array.from({length:50001},(_,id)=>({id})),[]),'ERROR',64));
  check('A15 document positional array difference',()=>verdict(run([1,2],[2,1],{mode:'document'}),'WARN',1));
  check('A16 ignored array slots preserve position',()=>verdict(run([{id:1,a:[1,2]}],[{id:1,a:[9,2]}],{...config,ignore:['/a/0']}),'PASS',0));
  check('A17 overlapping wildcard policies rejected',()=>verdict(run([{id:1,items:[{score:10}]}],[{id:1,items:[{score:20}]}],{...config,rules:{'/items/*/score':{tolerance:2},'/items/0/*':{allow_change:true}}}),'ERROR',64));
  check('A18 swapping ambiguous policy order still rejected',()=>verdict(run([{id:1,items:[{score:10}]}],[{id:1,items:[{score:20}]}],{...config,rules:{'/items/0/*':{allow_change:true},'/items/*/score':{tolerance:2}}}),'ERROR',64));
  check('A19 nested tolerance must not silently disappear under parent allow',()=>{const r=run([{id:1,p:{score:10}}],[{id:1,p:{score:100}}],{...config,rules:{'/p':{allow_change:true},'/p/score':{tolerance:2}}});assert.ok(['FAIL','ERROR'].includes(r.report.status),'Expected policy violation or conflicting-config ERROR; actual '+r.report.status);return {status:r.report.status};});
  check('A20 absent protected wildcard field is not an invented change',()=>{const r=run([{id:1,items:[]}],[{id:1,items:[{label:'new'}]}],{...config,rules:{'/items/*/plan':{allow_change:false}}});assert.equal(r.report.summary.regressions,0,'The protected plan field is missing on both sides');return verdict(r,'WARN',1);});
  console.log(JSON.stringify({date:'2026-10-11',node:process.version,total:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,inputIntegrity:'Every completed invocation preserved input hashes and directory contents.',results},null,2));
  process.exitCode=results.some(x=>!x.passed)?1:0;
} finally {
  const target=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(target),parent);assert.ok(path.basename(target).startsWith('data-verifier-acceptance-'));
  fs.rmSync(target,{recursive:true});
}
