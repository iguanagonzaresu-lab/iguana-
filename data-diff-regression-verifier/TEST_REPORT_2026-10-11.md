# Data Diff Regression Verifier — verification report

Date: 2026-10-11. Environment: Windows, Node.js v24.21.0.

## Latest result after correction: 109 checks passed, zero failed

The three reported defect classes have been corrected. This result supersedes the historical BLOCK below; it is scoped to the local deterministic verifier and synthetic acceptance fixtures, not a guarantee for all datasets or hosted skill activation.

| Post-fix suite | Passed | Failed | Total |
|---|---:|---:|---:|
| Existing 79 cases plus 10 focused regression controls | 89 | 0 | 89 |
| Original acceptance audit, inputs and expectations unchanged | 20 | 0 | 20 |
| Total | 109 | 0 | 109 |

- A17/A18 now both produce ERROR/64: crossing wildcard intersections are rejected independently of rule insertion order.
- A19 now produces ERROR/64: a whole-parent allow and an overlapping numeric/transition descendant policy conflict. Configuration must be clarified instead of silently bypassing the child policy. This precedence decision is documented in `references/config.md`.
- A20 now produces WARN/1 with zero regressions: projections ignore missing leaves while retaining actual values, including null. Existing protected-field deletion and addition still produce FAIL as expected.
- Ten new controls cover both configuration orders, wildcard intersections, separate branches, parent/child transition policies, absent wildcard fields on additions/removals, actual protected leaf addition/removal, and null versus missing. Before the implementation change, six of these ten failed; after correction all ten passed.
- The 50,000-record acceptance case still detects exactly one violation (376 ms in the recorded local run; not a general performance guarantee).
- Every acceptance invocation preserved SHA-256 hashes and directory contents of its inputs. No runtime write, network/API operation, dependency installation, commit or push was added.
- Node syntax checks passed for six script/test files. Node-based frontmatter/name/description and the two linked references passed basic validation. The skill-creator Python quick validator was attempted but could not run: the installed WindowsApps Python alias returned exit 1 (`Python`). This is not reported as a successful Python validation.

Changed implementation: `scripts/normalize.mjs`, `scripts/compare.mjs`. Also updated focused tests, config documentation and this report. SkillScout and other products were not modified.

## Historical pre-fix result: BLOCK (not ready for general use)

The existing suite passed, but additional CLI acceptance cases reproduced three defect classes across four failing cases. This is a test/diagnostic run only: implementation and policies were not modified.

| Suite | Passed | Failed | Total |
|---|---:|---:|---:|
| Existing `node --test tests/verifier.test.mjs` | 79 | 0 | 79 |
| Additional `node tests/acceptance-audit.mjs` | 16 | 4 | 20 |
| Total | 95 | 4 | 99 |

An intentional verifier verdict FAIL/exit 2 counts as a successful test when the fixture violates policy. The four failures below are discrepancies from the expected behavior, not ordinary detected data regressions.

## BLOCK 1 — crossing wildcard policies depend on insertion order

Evidence: A17 and A18. For `items[0].score: 10 -> 20`, configure both `/items/*/score: {tolerance:2}` and `/items/0/*: {allow_change:true}`. Both apply to the same value. Config documentation promises overlapping equal-depth wildcard rules are rejected. Instead, putting tolerance first yields FAIL, and putting allow first yields PASS. Expected: ERROR for ambiguous configuration in both orders.

Cause: `scripts/normalize.mjs`, `validateConfig`, tests wildcard overlap with directional `match` calls. Crossing wildcards do not satisfy either directional match. `scripts/compare.mjs`, `emit`, then selects the first matching rule.

Risk: a forbidden change can pass after merely reordering configuration keys.

Proposed fix: detect nonempty intersection of equal-depth path patterns (each segment equal or either side wildcard), reject conflicting overlaps before comparing. Do not silently choose precedence.

Verify: A17/A18 should both return ERROR/64, and the existing wildcard tests should remain passing.

## BLOCK 2 — parent allow bypasses nested numeric rule

Evidence: A19. Baseline `[{"id":1,"p":{"score":10}}]`; current `[{"id":1,"p":{"score":100}}]`; rules `/p: {allow_change:true}` and `/p/score: {tolerance:2}`. Actual PASS; acceptable outcome is FAIL for the explicit child policy or ERROR for conflicting configuration, never an unqualified PASS.

Cause: `scripts/compare.mjs`, `walk`, reports a whole-object change and returns for a direct permissive parent rule, without visiting numeric child rules. Explicit `allow_change:false` child protections are separately checked and do work (A08); numeric policies are not.

Risk: a configured numeric bound can be silently unenforced.

Proposed fix: define and enforce parent/child precedence, either rejecting incompatible nested policies or evaluating more-specific child constraints before allowing the parent change. Document the chosen contract.

Verify: A19 must cease returning PASS; A08 and whole-object allow controls should still behave as specified.

## BLOCK 3 — missing wildcard field reported as changed

Evidence: A20. Baseline `[{"id":1,"items":[]}]`; current `[{"id":1,"items":[{"label":"new"}]}]`; rule `/items/*/plan: {allow_change:false}`. No `plan` field exists on either side. Expected: WARN for the unruled structural addition and unmatched rule, zero protected-field regressions. Actual: FAIL with two regression events.

Cause: `scripts/compare.mjs`, `projections` and protection check, compare an empty projection against an expanded missing-value projection as if the protected data changed.

Risk: harmless container additions can be misreported as protected-data regressions.

Proposed fix: distinguish absent protected values from existing protected values, without losing detection when an actually existing protected value is deleted/nullified.

Verify: A20 returns WARN with zero regressions; protected parent/child deletion controls A08/A09 still FAIL as intended.

## Passed checks and boundaries

- Keyed reorder, composite typed keys, changed values, absolute tolerance, protected fields and ignored timestamps.
- Duplicate keys and invalid UTF-8 safely rejected; unruled differences remain WARN.
- JSON/CSV mixed-format equivalence with explicit CSV types.
- Default report omitted synthetic private values and identifying key values.
- CLI preserved SHA-256 hashes of all synthetic input/config files and wrote no unexpected files for every invocation.
- 50,000 records, reverse order, one protected-field violation: exactly one regression detected; approximately 310 ms in this local synthetic run (not a general benchmark or guarantee).
- 50,001 records rejected by the configured MVP limit.
- Input generation/test helpers created temporary fixtures and removed only their own validated temporary directory. No customer data, API keys, network calls, live DB/API operations or deployment were used.

## Static preflight

Used the installed preflight-regression skill against the containing business repository, HEAD `975421d00239f38b45a0c4be7a9310d61c72c493` to current working tree including untracked files. Scanner status WARN; Content and Deploy packs selected. Target-specific warnings were unclassified CSV sample files; these were covered by the CLI format checks above. The broad repository also contains unrelated changes: they are outside this report's behavioral verdict and were not modified.

No root npm commands, installation, automatic fixes, Git commit, push or publication were performed. Python quick_validate was not rerun; this report validates CLI behavior, not hosted skill discovery or autonomous model activation. The original 79 tests alone were insufficient to establish the nested-rule behavior.

## Reproduction

From this skill folder:

```sh
node --test tests/verifier.test.mjs
node tests/acceptance-audit.mjs
```

The acceptance runner currently exits 1 because four expectations fail. Preserve those failing expectations when fixing the implementation; do not change them simply to obtain a green result.
