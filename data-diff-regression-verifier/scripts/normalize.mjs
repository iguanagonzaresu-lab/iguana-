import fs from 'node:fs';

export class InputError extends Error {}
export const invalid = message => { throw new InputError(message); };
export const MISSING = Symbol('missing');
export const own = (o,k) => o !== null && typeof o === 'object' && Object.hasOwn(o,k);
export const type = v => v === MISSING ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
export const escape = s => s.replace(/~/g,'~0').replace(/\//g,'~1');
export function segments(pointer) {
  if(typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])/u.test(pointer)) invalid('Invalid JSON pointer in configuration.');
  return pointer === '' ? [] : pointer.slice(1).split('/').map(s => s.replace(/~1/g,'/').replace(/~0/g,'~'));
}
export const match = (pattern,p) => pattern.length === p.length && pattern.every((s,i) => s === '*' || s === p[i]);
export const prefix = (a,b) => a.length <= b.length && a.every((s,i) => s === '*' || b[i] === '*' || s === b[i]);
export function get(o,parts) { for(const s of parts) { if(!own(o,s)) return MISSING; o=o[s]; } return o; }

// Reject duplicate keys instead of silently allowing JSON.parse's last-value wins.
export function parseJSON(source) {
  const text=source.replace(/^\uFEFF/,''); let i=0;
  const ws=()=>{while(/[ \t\r\n]/.test(text[i]||'!'))i++;};
  function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"'){try{return JSON.parse(text.slice(start,i));}catch{break;}}}invalid('Invalid JSON string.');}
  function value(depth=0){
    if(depth>64)invalid('JSON nesting exceeds 64 levels.');ws();const c=text[i];
    if(c==='"')return string();
    if(c==='{'||c==='['){const obj=c==='{',out=obj?Object.create(null):[],seen=new Set();i++;ws();if(text[i]===(obj?'}':']')){i++;return out;}
      while(i<text.length){ws();let key;if(obj){if(text[i]!=='"')invalid('Invalid JSON object.');key=string();if(seen.has(key))invalid('Duplicate JSON object key.');seen.add(key);ws();if(text[i++]!==':')invalid('Invalid JSON object.');}
        const v=value(depth+1);if(obj)out[key]=v;else out.push(v);ws();const end=text[i++];if(end===(obj?'}':']'))return out;if(end!==',')invalid('Invalid JSON separator.');}
      invalid('Unterminated JSON container.');
    }
    for(const [word,v] of [['true',true],['false',false],['null',null]])if(text.startsWith(word,i)){i+=word.length;return v;}
    const n=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if(n){i+=n[0].length;const v=Number(n[0]);if(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v))||(v===0&&/[1-9]/.test(n[0].split(/[eE]/)[0])))invalid('Unsafe JSON number; use strings for values outside the supported numeric range.');return v;}
    invalid('Invalid JSON value.');
  }
  const result=value();ws();if(i!==text.length)invalid('Unexpected trailing JSON content.');return result;
}

export function parseCSV(source) {
  const s=source.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',state='start';
  const cell=()=>{row.push(field);field='';state='start';};
  const end=()=>{cell();rows.push(row);row=[];};
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(state==='quoted'){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else state='closed';}else field+=c;continue;}
    if(c===','){cell();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;end();continue;}
    if(state==='closed')invalid('Unexpected character after a CSV quote.');
    if(c==='"'){if(state!=='start')invalid('Unexpected quote in CSV field.');state='quoted';continue;}
    field+=c;state='plain';
  }
  if(state==='quoted')invalid('Unterminated CSV quote.');
  if(row.length||state!=='start'||field)end();
  if(!rows.length)invalid('CSV must contain a header.');
  const headers=rows.shift();if(headers.some(h=>!h)||new Set(headers).size!==headers.length)invalid('CSV headers must be nonempty and unique.');
  return rows.map(r=>{if(r.length!==headers.length)invalid('CSV row has a different number of columns.');const o=Object.create(null);headers.forEach((h,i)=>o[h]=r[i]);return o;});
}

export function readInput(file) {
  let buffer;try{const st=fs.statSync(file);if(!st.isFile()||st.size>10*1024*1024)invalid('Input must be a file no larger than 10 MiB.');buffer=fs.readFileSync(file);}catch(e){if(e instanceof InputError)throw e;invalid('Cannot read an input file.');}
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{invalid('Input must be UTF-8.');}
  if(/\.csv$/i.test(file))return {data:parseCSV(text),format:'csv'};
  if(/\.json$/i.test(file))return {data:parseJSON(text),format:'json'};
  invalid('Only .json and .csv inputs are supported.');
}

export function validateConfig(raw={}) {
  if(type(raw)!=='object')invalid('Configuration must be an object.');
  const allowed=['version','mode','key','ignore','rules','records','csv_types','csv_null'];
  if(Object.keys(raw).some(k=>!allowed.includes(k)))invalid('Unknown configuration option.');
  const c={version:1,mode:'records',key:[],ignore:[],rules:{},records:{added:'review',removed:'review'},csv_types:{},csv_null:null,...raw};
  if(c.version!==1||!['records','document'].includes(c.mode))invalid('Unsupported config version or mode.');
  for(const k of ['key','ignore']){if(!Array.isArray(c[k])||c[k].length!==new Set(c[k]).size)invalid('Keys and ignore paths must be unique arrays.');c[k].forEach(segments);}
  if(c.mode==='records'&&!c.key.length)invalid('Records mode requires an explicit comparison key.');
  if(c.mode==='document'&&c.key.length)invalid('Document mode does not accept record keys.');
  if(c.key.some(k=>!k||segments(k).includes('*'))||c.ignore.some(k=>!k))invalid('Invalid key or ignore path.');
  for(const k of ['rules','records','csv_types'])if(type(c[k])!=='object')invalid('Rules, records and CSV types must be objects.');
  c.records={added:'review',removed:'review',...c.records};
  if(Object.keys(c.records).some(k=>!['added','removed'].includes(k))||Object.values(c.records).some(v=>!['allow','forbid','review'].includes(v)))invalid('Invalid record policy.');
  if(c.csv_null!==null&&typeof c.csv_null!=='string')invalid('CSV null marker must be a string or null.');
  for(const [p,t] of Object.entries(c.csv_types)){if(segments(p).length!==1||!['string','number','boolean'].includes(t))invalid('CSV types require top-level column pointers and string/number/boolean types.');}
  for(const [p,r] of Object.entries(c.rules)){
    segments(p);if(type(r)!=='object'||!Object.keys(r).length||Object.keys(r).some(k=>!['allow_change','severity','tolerance','tolerance_percent','transitions'].includes(k)))invalid('Invalid rule option.');
    if(own(r,'allow_change')&&typeof r.allow_change!=='boolean')invalid('allow_change must be boolean.');
    if(own(r,'severity')&&!['low','medium','high','critical'].includes(r.severity))invalid('Invalid severity.');
    for(const k of ['tolerance','tolerance_percent'])if(own(r,k)&&(typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0))invalid('Tolerance must be a finite nonnegative number.');
    if(own(r,'transitions')&&(!Array.isArray(r.transitions)||r.transitions.some(t=>!Array.isArray(t)||t.length!==2||t.some(v=>!['string','number','boolean','null'].includes(type(v))))))invalid('Transitions must be pairs of scalar values.');
    if(!['allow_change','tolerance','tolerance_percent','transitions'].some(k=>own(r,k)))invalid('A rule requires a comparison policy.');
    if(own(r,'allow_change')&&['tolerance','tolerance_percent','transitions'].some(k=>own(r,k)))invalid('allow_change cannot be combined with tolerance or transitions.');
    if(own(r,'transitions')&&['tolerance','tolerance_percent'].some(k=>own(r,k)))invalid('Transitions cannot be combined with numeric tolerance.');
  }
  const checks=[...c.key,...Object.keys(c.rules)];
  for(const i of c.ignore)for(const p of checks)if(prefix(segments(i),segments(p))||prefix(segments(p),segments(i)))invalid('Ignored paths overlap comparison keys or rules.');
  const paths=Object.keys(c.rules);
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
    const a=segments(paths[i]),b=segments(paths[j]);
    // Intersection, not directional matching: /items/*/score overlaps /items/0/*.
    if(a.length===b.length&&prefix(a,b))invalid('Overlapping wildcard rules are ambiguous.');
    const [parent,child,parentPath,childPath]=a.length<b.length
      ? [a,b,paths[i],paths[j]] : [b,a,paths[j],paths[i]];
    if(parent.length<child.length&&prefix(parent,child)&&c.rules[parentPath].allow_change===true&&
       ['tolerance','tolerance_percent','transitions'].some(k=>own(c.rules[childPath],k)))
      invalid('Whole-parent allow conflicts with a nested numeric or transition rule; remove the parent allow or use non-overlapping paths.');
  }
  return c;
}

export function csvConvert(rows,c) {
  return rows.map(row=>{const o=Object.create(null);for(const [k,v] of Object.entries(row)){
    const t=c.csv_types['/'+escape(k)]||'string';
    if(c.csv_null!==null&&v===c.csv_null)o[k]=null;
    else if(t==='string')o[k]=v;
    else if(t==='boolean'){if(v!=='true'&&v!=='false')invalid('Invalid CSV boolean; use true or false.');o[k]=v==='true';}
    else{if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v))invalid('Invalid CSV number.');o[k]=parseJSON(v);}
  }return o;});
}

export function normalize(value,patterns,p=[],counts={ignored:0}) {
  if(patterns.some(x=>match(x,p))){counts.ignored++;return MISSING;}
  if(Array.isArray(value))return value.map((v,i)=>normalize(v,patterns,[...p,String(i)],counts));
  if(type(value)==='object'){const out=Object.create(null);for(const k of Object.keys(value).sort()){const v=normalize(value[k],patterns,[...p,k],counts);if(v!==MISSING)out[k]=v;}return out;}
  return value;
}
