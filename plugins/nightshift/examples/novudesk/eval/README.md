# NovuDesk planted-vuln eval (report-only)

FPR counts **false positives only**, so a reviewer prompt or model change that makes the
reviewer *miss* real issues would read as an improving FPR. This eval is the
false-negative counterweight (plan §9.17, task T14). It **never gates** CI or a run.

```
eval/
  answer-key.yml   # 4 planted vulns + 3 clean controls, each mapped to a registry vector
  target/          # the code under review: a small NovuDesk rails tree + a fresh pack
    .nightshift/   #   manifest (K = 7) + the 7 keyed vectors, never reviewed
    app/...        #   planted surfaces and clean control surfaces, no hints in the source
```

| Key | Vector | What |
|---|---|---|
| PV-01 | ASVS-INPV-04 | SQL injection in ticket search |
| PV-02 | ND-SEC-03 | SSRF in the webhook-monitor URL fetcher |
| PV-03 | ND-SEC-05 | Cross-workspace ticket read (IDOR) |
| PV-04 | ND-SEC-06 | Webhook signature skipped when the header is absent |
| clean | ND-SEC-01, ND-SEC-02, ND-SEC-07 | Encrypted token storage, signed + replay-protected dispatch, escaped review queue |

The key lives **outside** `target/` so the reviewer can never read it. Keep it that way:
only `target/` is copied into the scratch repo.

## Running it (operator, paid)

A run is a real security-lane run — seven surfaces on your subscription — so it is
started by hand, never by CI.

```sh
# 1. A fresh scratch repo from the target (re-copy for every run: a run stamps the
#    registry and appends findings, so a second run in the same copy scores differently).
cp -R plugins/nightshift/examples/novudesk/eval/target ~/scratch/novudesk-eval
git -C ~/scratch/novudesk-eval init -q
git -C ~/scratch/novudesk-eval add -A
git -C ~/scratch/novudesk-eval commit -qm "planted-vuln eval target"

# 2. Point $OPS/config.yml at it:
#      - path: ~/scratch/novudesk-eval
#        lanes: [security]
#        name: novudesk-eval
ns run novudesk-eval security --no-open

# 3. Score the run.
node plugins/nightshift/bin/eval-planted.mjs \
  --key plugins/nightshift/examples/novudesk/eval/answer-key.yml \
  --findings ~/scratch/novudesk-eval/.nightshift/metrics/findings
```

`--findings` also takes a run's final `candidates.tier2.json` or a whole directory
(recursive; non-finding JSON and the pre-refutation `candidates.proposed.json`,
`candidates.json`, `tier2.pending.json` and `tier2.survivors.json` are skipped, so a
vuln the refuter killed never counts as caught). `--run-id <id>` scores one run, `--json` emits the report
as JSON, and `--slack <n>` (default 3) widens each planted line range.

## Scoring

- **Caught** — a logged finding's `location` cites a planted file with a line inside the
  planted range (± slack), or cites the file with no line while filed under the planted
  vector. Score what was *logged*: a vuln the refuter killed is a miss to the operator.
- **False positive on clean** — any finding filed under a clean vector, or citing a clean file.
- **Other** — everything else (findings on the planted surfaces' other lines, on
  unkeyed files). Reported, not scored.

The vitest suite (`src/lib/planted-eval.test.ts`) keeps the key honest: every range must
point at real lines, every keyed vector must be selected by one run, and the target must
not contain the key or eval vocabulary. Edit a target file → update its range.
