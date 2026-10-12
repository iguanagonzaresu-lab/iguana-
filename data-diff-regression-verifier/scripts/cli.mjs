import {readInput,InputError,invalid} from './normalize.mjs';
import {compare} from './compare.mjs';
import {render} from './report.mjs';

const args=process.argv.slice(2),opts={};
try{
  if(args.length===1&&args[0]==='--help'){
    console.log('node scripts/cli.mjs --baseline baseline.json --current current.json --config verifier.json [--json] [--include-values]\nRead-only JSON/CSV verification. Exit: PASS 0, WARN 1, FAIL 2, ERROR 64. Values hidden by default.');
  }else{
    for(let i=0;i<args.length;i++){
      const k=args[i];if(!['--baseline','--current','--config','--json','--include-values'].includes(k)||Object.hasOwn(opts,k))invalid('Unknown or duplicate command option.');
      if(k==='--json'||k==='--include-values')opts[k]=true;
      else{if(!args[i+1]||args[i+1].startsWith('--'))invalid('Missing command option value.');opts[k]=args[++i];}
    }
    if(!opts['--baseline']||!opts['--current']||!opts['--config'])invalid('Baseline, current and config files are required.');
    if(!/\.json$/i.test(opts['--config']))invalid('Configuration must be JSON; YAML is not supported in v0.1.');
    const baseline=readInput(opts['--baseline']),current=readInput(opts['--current']),config=readInput(opts['--config']).data;
    const result=compare(baseline.data,current.data,config,{baselineFormat:baseline.format,currentFormat:current.format,includeValues:!!opts['--include-values']});
    console.log(opts['--json']?JSON.stringify(result,null,2):render(result));process.exitCode={PASS:0,WARN:1,FAIL:2}[result.status];
  }
}catch(e){const error={version:1,status:'ERROR',message:e instanceof InputError?e.message:'Verification could not complete; inspect input size, structure and permissions.'};console.log(args.includes('--json')?JSON.stringify(error):render(error));process.exitCode=64;}
