import {isDeepStrictEqual} from 'node:util';
import {MISSING,own,type,segments,match,prefix,get,escape,invalid,validateConfig,csvConvert,normalize} from './normalize.mjs';

function projections(o,pattern,p=[],out=[]) {
  // Only existing values establish protection. Missing leaves from newly
  // enumerated wildcard containers are not data changes; null remains present.
  if(!pattern.length){if(o!==MISSING)out.push([p,type(o),o]);return out;}
  const [head,...tail]=pattern;
  if(head==='*'){if(o!==null&&typeof o==='object')for(const k of Object.keys(o).sort())projections(o[k],tail,[...p,k],out);}
  else projections(own(o,head)?o[head]:MISSING,tail,[...p,head],out);
  return out;
}
const sensitive = p => p.some(s=>/password|secret|token|api.?key|authorization|cookie|email|phone|address/i.test(s));
const within = (delta,limit) => Number.isFinite(delta) && (delta<=limit || (limit>0 && delta-limit<=Number.EPSILON*8*Math.max(delta,limit)));
const safeValue = (v,p) => sensitive(p)||['object','array'].includes(type(v)) ? '[REDACTED]' : v===MISSING ? '[MISSING]' : typeof v==='string' && (v.length>160||/sk-|gh[pousr]_|github_pat_|Bearer |-----BEGIN|eyJ[A-Za-z0-9_-]+\./.test(v)) ? '[REDACTED]' : v;

export function compare(baseline,current,rawConfig,options={}) {
  const c=validateConfig(rawConfig),patterns=c.ignore.map(segments),rules=Object.entries(c.rules).map(([p,r])=>({p,parts:segments(p),...r}));
  if(options.baselineFormat==='csv')baseline=csvConvert(baseline,c);
  if(options.currentFormat==='csv')current=csvConvert(current,c);
  const ignoredBefore={ignored:0},ignoredAfter={ignored:0};
  const prep=(data,count)=>c.mode==='records' ? data.map(v=>normalize(v,patterns,[],count)) : normalize(data,patterns,[],count);
  if(c.mode==='records'&&(!Array.isArray(baseline)||!Array.isArray(current)))invalid('Records mode requires arrays of objects.');
  if(c.mode==='records'&&(baseline.length>50000||current.length>50000))invalid('Maximum 50000 records per input.');
  baseline=prep(baseline,ignoredBefore);current=prep(current,ignoredAfter);
  const report={version:1,status:'PASS',mode:c.mode,summary:{baseline_records:c.mode==='records'?baseline.length:1,current_records:c.mode==='records'?current.length:1,matched_records:0,added_records:0,removed_records:0,affected_records:0,differences:0,regressions:0,suspicious:0,expected:0,tolerated:0,ignored_baseline:ignoredBefore.ignored,ignored_current:ignoredAfter.ignored},findings:[],limitations:['Results are relative to the supplied baseline and explicit rules, not proof of production correctness.','Unruled differences require human review. Nested arrays remain order-sensitive.'],values_included:!!options.includeValues};
  let record,oldRecord,newRecord;const affected=new Set();
  function emit(kind,p,a,b,override){
    let classification='suspicious',severity='medium',reason='Unruled difference; confirm intent.',rule=null;
    const protect=rules.find(r=>r.allow_change===false&&(prefix(r.parts,p)||prefix(p,r.parts))&&!isDeepStrictEqual(projections(oldRecord,r.parts),projections(newRecord,r.parts)));
    const r=rules.find(r=>match(r.parts,p));
    if(protect){classification='regression';severity=protect.severity||'high';reason='Protected data changed.';rule=protect.p;}
    else if(override){classification=override==='allow'?'expected':override==='forbid'?'regression':'suspicious';severity=override==='forbid'?'high':'medium';reason='Record membership policy.';rule='records.'+(kind==='record_added'?'added':'removed');}
    else if(r){rule=r.p;severity=r.severity||'high';
      if(r.allow_change===true){classification='expected';reason='Explicitly allowed change.';}
      else if(r.transitions){classification=r.transitions.some(([x,y])=>isDeepStrictEqual(a,x)&&isDeepStrictEqual(b,y))?'expected':'regression';reason='Configured transition policy.';}
      else if(own(r,'tolerance')||own(r,'tolerance_percent')){
        let allowed=false;
        if(type(a)==='number'&&type(b)==='number'){
          const delta=Math.abs(b-a),checks=[];
          if(own(r,'tolerance'))checks.push(within(delta,r.tolerance));
          if(own(r,'tolerance_percent'))checks.push(a===0 ? b===0 : within(delta/Math.abs(a),r.tolerance_percent/100));
          allowed=checks.every(Boolean);
        }
        classification=allowed?'tolerated':'regression';reason='Numeric tolerance policy (no type coercion).';
      }
    }
    const item={kind,path:p.length?'/'+p.map(escape).join('/'):'',record:{...record},classification,severity,reason,rule,before_type:type(a),after_type:type(b)};
    if(options.includeValues){item.before=safeValue(a,p);item.after=safeValue(b,p);}
    report.findings.push(item);report.summary.differences++;
    report.summary[{regression:'regressions',suspicious:'suspicious',expected:'expected',tolerated:'tolerated'}[classification]]++;
    affected.add(JSON.stringify(record));
  }
  function walk(a,b,p=[]){
    if(isDeepStrictEqual(a,b))return;
    if(a===MISSING){emit('field_added',p,a,b);return;}
    if(b===MISSING){emit('field_removed',p,a,b);return;}
    if(b===null&&a!==null){emit('nullified',p,a,b);return;}
    if(type(a)!==type(b)){emit('type_changed',p,a,b);return;}
    const direct=rules.find(r=>match(r.parts,p));
    if(direct&&direct.allow_change!==false&&['object','array'].includes(type(a))){emit('value_changed',p,a,b);return;}
    if(type(a)==='object'){for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())walk(own(a,k)?a[k]:MISSING,own(b,k)?b[k]:MISSING,[...p,k]);}
    else if(Array.isArray(a)){if(a.length!==b.length)emit('array_count_changed',p,a.length,b.length);for(let i=0;i<Math.max(a.length,b.length);i++)walk(i<a.length?a[i]:MISSING,i<b.length?b[i]:MISSING,[...p,String(i)]);}
    else emit('value_changed',p,a,b);
  }
  function index(rows){const map=new Map();rows.forEach((row,i)=>{
    if(type(row)!=='object')invalid('Each record must be an object.');
    const keys=c.key.map(p=>get(row,segments(p)));
    if(keys.some(k=>!['string','number','boolean'].includes(type(k))||k===''))invalid('Record key is missing, null, empty or not scalar.');
    const id=JSON.stringify(keys.map(k=>[type(k),k]));if(map.has(id))invalid('Duplicate record key; comparison is ambiguous.');map.set(id,{row,i});
  });return map;}
  if(c.mode==='document'){record={baseline_index:0,current_index:0};oldRecord=baseline;newRecord=current;report.summary.matched_records=1;walk(baseline,current);}
  else {
    const left=index(baseline),right=index(current);
    for(const [id,{row:a,i}] of left){const b=right.get(id);record={baseline_index:i,current_index:b?.i??null};oldRecord=a;newRecord=b?.row??MISSING;
      if(!b){report.summary.removed_records++;emit('record_removed',[],a,MISSING,c.records.removed);}
      else{report.summary.matched_records++;walk(a,b.row);}
    }
    for(const [id,{row:b,i}] of right)if(!left.has(id)){record={baseline_index:null,current_index:i};oldRecord=MISSING;newRecord=b;report.summary.added_records++;emit('record_added',[],MISSING,b,c.records.added);}
  }
  report.summary.affected_records=affected.size;
  report.status=report.summary.regressions?'FAIL':report.summary.suspicious?'WARN':'PASS';
  const records=c.mode==='records'?[...baseline,...current]:[baseline,current];
  report.unmatched_rules=rules.filter(r=>!records.some(row=>projections(row,r.parts).some(([,t])=>t!=='missing'))).map(r=>r.p);
  if(report.unmatched_rules.length){if(report.status==='PASS')report.status='WARN';report.limitations.push('Some rules matched no fields; check rule paths before accepting the verdict.');}
  if(c.mode==='records'&&baseline.length===0&&current.length===0){report.status='WARN';report.limitations.push('Both datasets are empty; there is no record-level verification evidence.');}
  return report;
}
