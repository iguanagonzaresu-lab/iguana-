# Configuration v1

Use a UTF-8 JSON configuration. Unknown options, conflicting rules and invalid paths stop verification rather than being silently ignored. YAML is intentionally unsupported in v0.1.

```json
{
  "version": 1,
  "mode": "records",
  "key": ["/id"],
  "ignore": ["/updated_at", "/request_id"],
  "rules": {
    "/plan": {"allow_change": false, "severity": "critical"},
    "/status": {"transitions": [["pending", "active"], ["active", "suspended"]]},
    "/score": {"tolerance": 2},
    "/price": {"tolerance_percent": 0.5},
    "/email": {"allow_change": false},
    "/label": {"allow_change": true}
  },
  "records": {"added": "review", "removed": "forbid"},
  "csv_types": {"/id": "string", "/score": "number", "/price": "number"},
  "csv_null": null
}
```

## Mode and keys

- `records` (default): both inputs must be arrays of objects. CSV yields such an array. A nonempty `key` list is mandatory. Matching ignores root record order; it does not sort or modify input files. Composite keys use typed tuples, so number 1 and string "1" are distinct.
- Missing, null, empty-string, nonscalar or duplicate keys stop the entire comparison with ERROR. Do not arbitrarily select a duplicate. Changing a key becomes a removed record plus an added record, not a value update.
- `document`: arbitrary JSON roots, including arrays and scalars. Omit `key`. Arrays are position-sensitive; use this explicitly when position is part of the contract. Example: `{"mode":"document","rules":{"/settings/plan":{"allow_change":false}}}`.
- Root shape mismatch in records mode is ERROR; shape changes inside documents/records are findings.

## Paths and normalization

Paths are JSON pointers relative to each record, or to the root in document mode. `/profile/plan` addresses a nested field. Escape literal `~` as `~0` and `/` as `~1`; dots have no special meaning. The empty pointer addresses the root for rules, not keys/ignores.

`*` matches one path segment in `ignore` and `rules`, e.g. `/items/*/updated_at`. Literal `*` field names cannot be targeted unambiguously in wildcard configuration. Keys never accept wildcards. Overlapping equal-depth wildcard rules are rejected, including crossing patterns such as `/items/*/score` and `/items/0/*`, regardless of their order.

Ignored fields are removed from object comparison. Ignored array positions use internal placeholders without shifting indexes; array-length changes remain visible. Report counts are fields omitted on each side, **not** the number of ignored changes. The tool does not inspect whether omitted fields were equal. Key/rule paths cannot overlap ignored paths. JSON object field order is normalized; strings are not trimmed, lowercased or Unicode-normalized, and dates/time zones are not converted.

## Rules

No implicit rules are inferred from field names such as plan, price or email.

- `allow_change:false`: any modification under this path is a regression, including deletion/nullification of an ancestor or deletion of a containing record. Protection wins over permissive nested rules and record membership policies. Only existing values are projected: adding/removing a wildcard container with no protected leaf does not invent a protected change. Null is an existing value, not a missing field.
- `allow_change:true`: changes at exactly this path are expected, including whole-object changes. It does not override a protected descendant. A parent-wide allow combined with a potentially overlapping descendant numeric tolerance or transition rule is rejected as conflicting configuration (ERROR), including wildcard intersections. Remove the broad allow or restrict it to unrelated fields; no child constraint is silently skipped. Use cautiously.
- `transitions`: ordered `[before,after]` scalar pairs. A reverse transition is not allowed unless separately listed. A forbidden transition is a regression. Missing fields are not equivalent to null.
- `tolerance`: absolute delta, inclusive.
- `tolerance_percent`: `abs(after-before) / abs(before) * 100`, inclusive. With a zero baseline only zero is within relative tolerance. Both absolute and relative limits, if present, must hold.
- Numeric rules never coerce strings, booleans, objects or null. Type changes fail numeric policies. A tiny relative floating-point allowance handles boundaries; a zero limit stays exact. Exact monetary calculations should use integer minor units.
- `severity`: low/medium/high/critical; default high for explicit rule violations. Severity alone is not a rule.
- `allow_change` cannot combine with tolerance/transitions. Transitions cannot combine with numeric limits. Rules with no matching fields on either side cause WARN and appear in `unmatched_rules`.
- Policies act on changed values. They are not a schema validator that enforces types on unchanged data. A rule appearing on some records does not prove coverage on every record.

Record `added` / `removed` each accept `allow`, `review` (default) or `forbid`. Explicitly protected fields still block removal/addition where their protected value appears/disappears. Root counts are reported separately. Nested array counts produce events alongside element differences; findings are events, not unique records.

## CSV and JSON constraints

- UTF-8, optional BOM. CSV supports commas, CRLF/LF, quoted delimiters, escaped quotes and quoted newlines. Semicolon dialects are not auto-detected. Duplicate/empty headers, ragged rows, stray quotes and unterminated fields are errors. Blank data lines are treated as rows, not silently skipped. Header-only CSV yields zero records.
- CSV cells default to strings, preserving leading zeros. `csv_types` maps exact top-level column pointers to string/number/boolean. Numbers use strict JSON number syntax; boolean values must be exactly true or false. `csv_null` defaults to null (disabled); a configured string marker maps matching cells, quoted or not, to null before type conversion. Empty string is not null by default.
- JSON rejects duplicate keys, trailing data, invalid syntax, non-finite numbers and unsafe integer values. Use strings for IDs beyond the safe integer range. No automatic YAML parsing, formula evaluation, URL fetching or object deserialization occurs.
- Limits: 10 MiB per file, JSON depth 64, 50,000 records per input. This is an in-memory MVP, not a streaming database comparator. Files should be stable local snapshots; concurrently changing files are not a transactional snapshot.

## CLI and output

```sh
node scripts/cli.mjs --baseline before.csv --current after.csv --config verifier.json --json
```

Only `--baseline`, `--current`, `--config`, `--json`, `--include-values`, and standalone `--help` are supported. All three input paths are required. Output is stdout; shell redirection to a new report is a user choice, not an automatic file write. Do not redirect over an input file.

Exit codes: PASS 0, WARN 1, FAIL 2, ERROR 64. A sample FAIL is a successful detection, not a script crash. Technical/parser details and input contents are omitted on error. Unknown internal errors become a generic ERROR.

`record.baseline_index` and `record.current_index` are zero-based array/data-row indexes (not CSV physical lines); absent records use null. Reports hide before/after values unless opted in. Text output also JSON-escapes paths/values to avoid terminal-control sequences. Field names remain visible; sanitize sensitive property names before sharing reports.
