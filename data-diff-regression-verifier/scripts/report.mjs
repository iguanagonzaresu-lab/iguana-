export function render(report){
  if(report.status==='ERROR')return `DATA REGRESSION VERIFICATION: ERROR\n${report.message}\nNo verdict was produced.`;
  const s=report.summary;
  return [`DATA REGRESSION VERIFICATION: ${report.status}`,
    `Records: ${s.baseline_records} -> ${s.current_records}; matched ${s.matched_records}; added ${s.added_records}; removed ${s.removed_records}`,
    `Differences: ${s.differences}; regressions ${s.regressions}; suspicious ${s.suspicious}; expected ${s.expected}; tolerated ${s.tolerated}`,
    `Ignored fields: baseline ${s.ignored_baseline}; current ${s.ignored_current}`,
    ...report.findings.map(f=>`${f.classification.toUpperCase()} [${f.severity}] ${f.kind} ${JSON.stringify(f.path||'/')} (baseline row ${f.record.baseline_index??'-'}, current row ${f.record.current_index??'-'})\n  ${f.reason} Rule: ${JSON.stringify(f.rule)}${report.values_included?'\n  '+JSON.stringify(f.before)+' -> '+JSON.stringify(f.after):''}`),
    ...report.limitations.map(x=>'Note: '+x)].join('\n');
}
