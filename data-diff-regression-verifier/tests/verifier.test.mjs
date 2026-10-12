import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compare} from '../scripts/compare.mjs';
import {parseJSON,parseCSV,validateConfig,InputError} from '../scripts/normalize.mjs';
const cfg={key:['/id']};
const row=(v)=>[{id:1,value:v}];
const run=(a,b,rule={},extra={})=>compare(row(a),row(b),{...cfg,rules:{'/value':rule},...extra});
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,[path.join(root,'scripts/cli.mjs'),...args],{encoding:'utf8',timeout:10000});

test('crossing wildcard policies are rejected regardless of order',()=>{
  const entries=[['/items/*/score',{tolerance:2}],['/items/0/*',{allow_change:true}]];
  for(const list of [entries,[...entries].reverse()])assert.throws(()=>validateConfig({...cfg,rules:Object.fromEntries(list)}),InputError);
});
test('disjoint wildcard policies remain usable',()=>{
  const r=compare([{id:1,a:{score:1},b:{score:1}}],[{id:1,a:{score:2},b:{score:3}}],{...cfg,rules:{'/a/*':{tolerance:1},'/b/*':{tolerance:2}}});
  assert.equal(r.status,'PASS');assert.equal(r.summary.tolerated,2);
});
test('whole-parent allow and nested tolerance are conflicting in either order',()=>{
  for(const rule of [{tolerance:2},{tolerance_percent:1}]){
    const entries=[['/p',{allow_change:true}],['/p/score',rule]];
    for(const list of [entries,[...entries].reverse()])assert.throws(()=>validateConfig({...cfg,rules:Object.fromEntries(list)}),InputError);
  }
});
test('whole-parent allow cannot bypass nested transition policy',()=>{
  assert.throws(()=>validateConfig({...cfg,rules:{'/p':{allow_change:true},'/p/status':{transitions:[['pending','active']]}}}),InputError);
});
test('wildcard parent intersection detects nested conflicting tolerance',()=>{
  for(const rules of [{'/items/*':{allow_change:true},'/items/0/score':{tolerance:2}},{'/items/0':{allow_change:true},'/items/*/score':{tolerance:2}}])assert.throws(()=>validateConfig({...cfg,rules}),InputError);
});
test('parent permission and separate branch tolerance do not conflict',()=>{
  const r=compare([{id:1,p:{label:'old'},q:{score:1}}],[{id:1,p:{label:'new'},q:{score:2}}],{...cfg,rules:{'/p':{allow_change:true},'/q/score':{tolerance:2}}});
  assert.equal(r.status,'PASS');assert.equal(r.summary.expected,1);assert.equal(r.summary.tolerated,1);
});
test('absent wildcard leaf is not a regression when container expands or shrinks',()=>{
  const a=[{id:1,items:[]}],b=[{id:1,items:[{label:'new'}]}],c={...cfg,rules:{'/items/*/plan':{allow_change:false}}};
  for(const [x,y] of [[a,b],[b,a]]){const r=compare(x,y,c);assert.equal(r.status,'WARN');assert.equal(r.summary.regressions,0);assert.deepEqual(r.unmatched_rules,['/items/*/plan']);}
});
test('existing wildcard protected leaf still blocks deletion and addition',()=>{
  const a=[{id:1,items:[]}],b=[{id:1,items:[{plan:'pro'}]}],c={...cfg,rules:{'/items/*/plan':{allow_change:false}}};
  for(const [x,y] of [[a,b],[b,a]])assert.equal(compare(x,y,c).status,'FAIL');
});
test('null protected wildcard values are present, unlike missing values',()=>{
  const c={...cfg,rules:{'/items/*/plan':{allow_change:false}}};
  const a=[{id:1,items:[{}]}],b=[{id:1,items:[{plan:null}]}];
  for(const [x,y] of [[a,b],[b,a]])assert.equal(compare(x,y,c).status,'FAIL');
});
test('parent allow still honors protected descendants without phantom missing fields',()=>{
  const c={...cfg,rules:{'/items':{allow_change:true},'/items/*/plan':{allow_change:false}}};
  const a=[{id:1,items:[]}],missing=[{id:1,items:[{label:'new'}]}],present=[{id:1,items:[{plan:'pro'}]}];
  assert.equal(compare(a,missing,c).summary.regressions,0);
  assert.equal(compare(a,present,c).status,'FAIL');
});

test('unchanged records PASS regardless of row/property order',()=>{
  const r=compare([{id:1,a:2},{id:2,a:3}],[{a:3,id:2},{a:2,id:1}],cfg);
  assert.equal(r.status,'PASS');assert.equal(r.summary.matched_records,2);assert.equal(r.findings.length,0);
});
test('example has one protected regression and one tolerated change',()=>{
  const read=n=>parseJSON(fs.readFileSync(path.join(root,'examples',n),'utf8'));
  const r=compare(read('baseline.json'),read('current.json'),read('verifier.json'));
  assert.equal(r.status,'FAIL');assert.equal(r.summary.regressions,1);assert.equal(r.summary.tolerated,1);
  assert.equal(r.summary.ignored_baseline,2);assert.equal(r.findings[0].record.current_index,1);
});
test('unruled changes WARN, never automatically regressions',()=>{
  const r=compare(row('a'),row('b'),cfg);assert.equal(r.status,'WARN');assert.equal(r.summary.regressions,0);
});
test('explicit allowed change PASS',()=>assert.equal(run('a','b',{allow_change:true}).status,'PASS'));
test('protected field FAIL',()=>assert.equal(run('a','b',{allow_change:false}).status,'FAIL'));
test('protected field nullification FAIL',()=>{const r=run('a',null,{allow_change:false});assert.equal(r.findings[0].kind,'nullified');assert.equal(r.status,'FAIL');});
test('missing field differs from null',()=>{const r=compare([{id:1}],[{id:1,a:null}],cfg);assert.equal(r.findings[0].kind,'field_added');});
test('number/string type drift not tolerated',()=>{const r=run(1,'1',{tolerance:2});assert.equal(r.status,'FAIL');assert.equal(r.findings[0].kind,'type_changed');});
test('boolean/number remain distinct',()=>assert.equal(run(false,0,{tolerance:2}).status,'FAIL'));
test('absolute tolerance inclusive, below and above',()=>{assert.equal(run(65,67,{tolerance:2}).status,'PASS');assert.equal(run(65,62,{tolerance:2}).status,'FAIL');});
test('decimal boundary avoids binary rounding false alarm',()=>assert.equal(run(1,1.1,{tolerance:0.1}).status,'PASS'));
test('zero tolerance remains exact',()=>assert.equal(run(0,Number.EPSILON,{tolerance:0}).status,'FAIL'));
test('tiny tolerances do not inherit an absolute epsilon',()=>assert.equal(run(0,1e-20,{tolerance:1e-21}).status,'FAIL'));
test('percent tolerance uses absolute baseline including negative values',()=>{assert.equal(run(-100,-100.5,{tolerance_percent:0.5}).status,'PASS');assert.equal(run(100,101,{tolerance_percent:0.5}).status,'FAIL');});
test('zero baseline percent does not divide by zero',()=>assert.equal(run(0,1,{tolerance_percent:100}).status,'FAIL'));
test('overflowing percent ratio cannot accidentally pass',()=>assert.equal(run(1e-320,1,{tolerance_percent:1}).status,'FAIL'));
test('numeric rules cannot be bypassed by changing object children',()=>assert.equal(run({a:1},{a:2},{tolerance:2}).status,'FAIL'));
test('explicit whole-object allowed change remains expected',()=>assert.equal(run({a:1},{a:2},{allow_change:true}).status,'PASS'));
test('when both tolerances supplied both must pass',()=>assert.equal(run(100,102,{tolerance:3,tolerance_percent:1}).status,'FAIL'));
test('allowed transitions are directional',()=>{const r={transitions:[['pending','active']]};assert.equal(run('pending','active',r).status,'PASS');assert.equal(run('active','pending',r).status,'FAIL');});
test('null transition may be explicitly allowed',()=>assert.equal(run('active',null,{transitions:[['active',null]]}).status,'PASS'));
test('composite keys resist concatenation collisions',()=>{const a=[{a:'a:b',b:'c'},{a:'a',b:'b:c'}];assert.equal(compare(a,[...a].reverse(),{key:['/a','/b']}).status,'PASS');});
test('typed record keys are distinct',()=>{const r=compare([{id:1},{id:'1'}],[{id:'1'},{id:1}],cfg);assert.equal(r.status,'PASS');});
for(const [label,data] of [['duplicate',[{id:1},{id:1}]],['missing',[{}]],['null',[{id:null}]],['empty',[{id:''}]],['object',[{id:{}}]],['nonrecord',[1]]])test(label+' record keys stop verification',()=>assert.throws(()=>compare(data,[],cfg),InputError));
test('added and removed rows count independently; default review',()=>{const r=compare([{id:1}],[{id:2}],cfg);assert.equal(r.status,'WARN');assert.equal(r.summary.added_records,1);assert.equal(r.summary.removed_records,1);});
test('record policy allows adds and forbids removals',()=>{const c={...cfg,records:{added:'allow',removed:'forbid'}};assert.equal(compare([],[{id:1}],c).status,'PASS');assert.equal(compare([{id:1}],[],c).status,'FAIL');});
test('protected child removal through parent deletion is caught',()=>{const c={...cfg,rules:{'/profile/plan':{allow_change:false}}};const a=[{id:1,profile:{plan:'pro'}}];for(const b of [[{id:1}],[{id:1,profile:null}],[{id:1,profile:[]}],[]])assert.equal(compare(a,b,c).status,'FAIL');});
test('protected parent catches child changes',()=>assert.equal(run({a:1},{a:2},{allow_change:false}).status,'FAIL'));
test('missing optional protected child does not falsely block sibling',()=>{
  const r=compare([{id:1,p:{x:1}}],[{id:1,p:null}],{...cfg,rules:{'/p/plan':{allow_change:false}}});assert.equal(r.summary.regressions,0);assert.equal(r.status,'WARN');
});
test('ignore nondeterministic fields and count omissions',()=>{const r=compare([{id:1,t:1}],[{id:1,t:2}],{...cfg,ignore:['/t']});assert.equal(r.status,'PASS');assert.equal(r.summary.ignored_current,1);});
test('nested wildcard ignore and rule',()=>{
  const c={...cfg,ignore:['/parts/*/time'],rules:{'/parts/*/n':{tolerance:1}}};
  const r=compare([{id:1,parts:[{n:2,time:'x'}]}],[{id:1,parts:[{n:3,time:'y'}]}],c);assert.equal(r.status,'PASS');assert.equal(r.summary.tolerated,1);
});
test('escaped pointers match slash/tilde/dot fields',()=>assert.equal(compare([{id:1,'a/b':{'~x.y':2}}],[{id:1,'a/b':{'~x.y':3}}],{...cfg,rules:{'/a~1b/~0x.y':{allow_change:false}}}).status,'FAIL'));
test('nested arrays remain order-sensitive and count changes are explicit',()=>{const r=compare(row([1,2]),row([2,1,3]),cfg);assert.equal(r.status,'WARN');assert.ok(r.findings.some(f=>f.kind==='array_count_changed'));});
test('document mode supports nested objects and scalar roots',()=>{assert.equal(compare({a:1},{a:2},{mode:'document'}).status,'WARN');assert.equal(compare(3,3,{mode:'document'}).status,'PASS');});
test('unmatched rule path warns instead of suggesting verified coverage',()=>{const r=compare([{id:1}],[{id:1}],{...cfg,rules:{'/typo':{allow_change:false}}});assert.equal(r.status,'WARN');assert.deepEqual(r.unmatched_rules,['/typo']);});
test('empty records do not claim verification',()=>assert.equal(compare([],[],cfg).status,'WARN'));
test('inputs/config are not mutated',()=>{const a=row(1),b=row(2),c={...cfg,rules:{'/value':{tolerance:2}}};const before=JSON.stringify([a,b,c]);compare(a,b,c);assert.equal(JSON.stringify([a,b,c]),before);});
test('values and identifying keys hidden by default',()=>{const a=[{id:'person-private',email:'before-private',value:'sensitive-private'}],b=[{id:'person-private',email:'after-private',value:'next-private'}];const out=JSON.stringify(compare(a,b,cfg));for(const x of ['person-private','before-private','after-private','sensitive-private','next-private'])assert.ok(!out.includes(x));});
test('opt-in values redact sensitive paths, token-like text and containers',()=>{
  const a=[{id:1,email:'private-a',data:'sk-not-a-real-secret-token',x:{a:1},public:'ok'}],b=[{id:1,email:'private-b',data:'sk-not-a-real-other-token',x:null,public:'new'}];
  const r=compare(a,b,cfg,{includeValues:true});const out=JSON.stringify(r);assert.ok(!out.includes('private-a'));assert.ok(!out.includes('not-a-real'));assert.equal(r.findings.find(f=>f.path==='/public').after,'new');assert.equal(r.findings.find(f=>f.path==='/x').before,'[REDACTED]');
});
test('CSV quoting, CRLF, embedded newline, escaped quote, BOM',()=>{const rows=parseCSV('\uFEFFid,note\r\n1,"a,b\r\nc"\r\n2,"He said ""yes"""\r\n');assert.equal(rows.length,2);assert.equal(rows[0].note,'a,b\r\nc');assert.equal(rows[1].note,'He said "yes"');});
test('CSV values are strings until explicitly typed',()=>{const a=parseCSV('id,value\n1,65'),b=parseCSV('id,value\n1,66');const c={...cfg,rules:{'/value':{tolerance:2}}};assert.equal(compare(a,b,c,{baselineFormat:'csv',currentFormat:'csv'}).status,'FAIL');assert.equal(compare(a,b,{...c,csv_types:{'/value':'number'}},{baselineFormat:'csv',currentFormat:'csv'}).status,'PASS');});
test('CSV null marker and booleans explicit',()=>{const r=compare(parseCSV('id,value\n1,true'),parseCSV('id,value\n1,NULL'),{...cfg,csv_types:{'/value':'boolean'},csv_null:'NULL'},{baselineFormat:'csv',currentFormat:'csv'});assert.equal(r.findings[0].kind,'nullified');});
for(const [name,text] of [['duplicate headers','id,id\n1,2'],['empty header','id,\n1,2'],['ragged row','id,x\n1'],['unclosed quote','id\n"1'],['trailing quote text','id\n"1"z'],['unescaped quote','id\n1"2'],['empty','']])test('reject CSV '+name,()=>assert.throws(()=>parseCSV(text),InputError));
for(const [name,text] of [['duplicate key','{"id":1,"id":2}'],['escaped duplicate','{"a":1,"\\u0061":2}'],['unsafe integer','9007199254740993'],['infinity','1e999'],['trailing data','true false'],['trailing comma','[1,]'],['unescaped control','"a\nb"']])test('reject JSON '+name,()=>assert.throws(()=>parseJSON(text),InputError));
test('JSON accepts BOM, escapes and prototype keys without pollution',()=>{const x=parseJSON('\uFEFF{"__proto__":{"polluted":true},"x":"a\\nb"}');assert.equal(x.x,'a\nb');assert.equal({}.polluted,undefined);assert.equal(Object.getPrototypeOf(x),null);});
test('JSON excessive nesting rejected',()=>assert.throws(()=>parseJSON('['.repeat(66)+'0'+']'.repeat(66)),InputError));
test('JSON underflow cannot silently convert a nonzero number to zero',()=>{assert.throws(()=>parseJSON('1e-999'),InputError);assert.equal(parseJSON('0e-999'),0);});
for(const [name,c] of Object.entries({missingKey:{},unknown:{...cfg,typo:true},ignoreKey:{...cfg,ignore:['/id']},ignoreRule:{...cfg,ignore:['/value'],rules:{'/value':{tolerance:2}}},negative:{...cfg,rules:{'/value':{tolerance:-1}}},badRule:{...cfg,rules:{'/value':{allowed_changes:false}}},emptyRule:{...cfg,rules:{'/value':{}}},ambiguous:{...cfg,rules:{'/*':{tolerance:1},'/value':{tolerance:2}}},conflict:{...cfg,rules:{'/value':{allow_change:false,tolerance:2}}},badPointer:{key:['id']},wildKey:{key:['/*']},badTransition:{...cfg,rules:{'/value':{transitions:['a -> b']}}}}))test('reject invalid configuration '+name,()=>assert.throws(()=>validateConfig(c),InputError));
test('CLI example JSON/CSV parity, expected FAIL exit 2',()=>{
  const outputs=['json','csv'].map(ext=>{const p=cli('--baseline',path.join(root,'examples/baseline.'+ext),'--current',path.join(root,'examples/current.'+ext),'--config',path.join(root,'examples/verifier.json'),'--json');assert.equal(p.status,2,p.stderr);return JSON.parse(p.stdout);});assert.deepEqual(outputs[0],outputs[1]);
});
test('CLI invalid flags/files produce redacted ERROR not a pass',()=>{const p=cli('--baseline','secret-path.json','--current','secret-path.json','--config','secret-path.json','--json');assert.equal(p.status,64);assert.equal(JSON.parse(p.stdout).status,'ERROR');assert.ok(!p.stdout.includes('secret-path'));assert.equal(cli('--wat','--json').status,64);});
test('CLI exit codes and malformed input do not leak data; inputs remain unchanged',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'data-verifier-test-'));
  try{const b=path.join(temp,'b.json'),n=path.join(temp,'n.json'),c=path.join(temp,'c.json');fs.writeFileSync(b,'[{"id":1,"value":1}]');fs.writeFileSync(c,JSON.stringify(cfg));
    for(const [body,exit] of [['[{"id":1,"value":1}]',0],['[{"id":1,"value":2}]',1],['{"private-input-do-not-echo":',64]]){fs.writeFileSync(n,body);const before=[b,n,c].map(f=>fs.readFileSync(f,'utf8'));const p=cli('--baseline',b,'--current',n,'--config',c,'--json');assert.equal(p.status,exit);assert.ok(!p.stdout.includes('private-input-do-not-echo'));assert.deepEqual([b,n,c].map(f=>fs.readFileSync(f,'utf8')),before);assert.equal(fs.readdirSync(temp).length,3);}
  }finally{const resolved=fs.realpathSync(temp);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('data-verifier-test-'));fs.rmSync(resolved,{recursive:true});}
});
