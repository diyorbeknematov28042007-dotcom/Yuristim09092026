# YURISTIM — B1 BACKEND/BOT/AI DEEP AUDIT REPORT

Overall: PARTIAL — code repairs validated; production release and real AI acceptance require Railway source/config access and a controlled Telegram session.

Repository: `diyorbeknematov28042007-dotcom/Yuristim09092026`.
Source baseline: live main `790affb011c0535ef07e72a997d87b96c50a661e` (all 216 files and Git tree/commit hashes verified).
Repair branch: `work/b1-bot-ai-reliability`.
PR/merge: linked in the accompanying delivery message.
No frontend repository changes, product features, key rotation, data deletion, or production migration.

## Incident summary and evidence window

Initial evidence: 2026-09-17 18:00 UTC through 2026-09-24 18:30 UTC, then a bounded 24-hour log query for 2026-09-24 03:25–2026-09-25 03:25 UTC. DB first snapshot covered the preceding seven days at audit start. Counts below refer to that fixed initial snapshot; a later rolling seven-day query naturally excludes the earliest samples.

Reported: intermittent absent/incomplete answers and temporary-unavailable messages.
Confirmed: 3 failed Fast requests with 6 unsuccessful Gemini attempts (`unavailable`); 1 historical Expert request failed with `invalid_request` on BAI. 5 Fast requests succeeded. Last 24-hour bounded sample: one Fast success, one Fast failure. This very small sample cannot establish a stable success-rate target.

### Exact failed-request trace, 2026-09-24

- Bot correlation: `tg_b87525f6-ac63-4163-931e-28e04c281189`.
- API AI request: `7576143a-c25e-4a55-b9bb-32cd07678bd6`.
- Runtime context: 1,214.3 ms; AI context reads: 199 ms.
- Gateway entered 1,719 ms after AI service start.
- Gemini attempt 1: 13,470 ms, failed `unavailable`.
- Gemini attempt 2: 503 ms, failed `unavailable`.
- Failure finalization: 179 ms. Service total: 16,715 ms; API handler: 16,891.8 ms, HTTP 503.
- Bot received HTTP 503 in 16,905 ms; sent the localized error successfully and published its controller. Total Bot handling: 19,757 ms.
- Assistant row: `failed`, charge 0. Circuit remained ACTIVE, consecutive failures 1.

This incident was not an observed Bot 60-second timeout, conversation busy error, circuit OPEN event, or Telegram delivery failure. Historic telemetry collapses HTTP 5xx, network TypeError, empty/malformed output and invalid usage into `unavailable`; it did not retain the upstream HTTP status. Its deeper upstream cause remains UNKNOWN, not a proven 429, quota, model, or network diagnosis.

## Root causes and confirmed code defects

| ID    | Severity / evidence                                                                                                                                | Frequency and confidence                                                                   | Repair / validation                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RC-01 | P1 diagnostic loss: provider HTTP status/reason absent; Bot console objects split into many Railway lines                                          | Observed in the failed production trace, HIGH                                              | Safe HTTP status and enumerated reason on provider attempt/final events; one-line Bot JSON, request ID, error category, delivery/refund outcomes. Status mapping and privacy tests pass.                           |
| RC-02 | P0 in-flight duplicate assigns another invocation's assistant row to cleanup; catch calls `failMessage` on it                                      | Reproduced: expected `running`, actual `failed`; production occurrence NOT established     | Cleanup requires ownership of a newly started operation. In-flight replay returns 409 without touching original. Regression passes, one provider execution.                                                        |
| RC-03 | P1 successful generation discarded on attempt/success-state persistence failure; failure-state writes or admission failure stop all Expert routing | Four injected failures reproduced, production occurrence NOT established                   | Attempt and post-attempt state writes best-effort with safe diagnostics. Admission still fails closed for affected provider; Expert tries another provider with its own shared admission check. Regression passes. |
| RC-04 | P1 timeout hierarchy: 45-second attempts × 2 × up to 3 Expert providers exceeds Bot's 60-second default                                            | Static/config-default proof and mocked budget tests; NOT the observed 16.9-second incident | Shared 90-second gateway provider budget, Bot default 105 seconds; Expert prefers failover before retry when a configured fallback remains. Backoff consumes remaining budget. Half-open lease covers 95 seconds.  |
| RC-05 | P2 callback ACK happens behind same-user sequentialization                                                                                         | Test fails while earlier AI handler is held pending; production frequency unavailable      | ACK moved before sequencing; state-changing callback handling remains ordered. Regression passes.                                                                                                                  |
| RC-06 | P1 release drift: both Railway services source `phase/07-yuristim-ai`, not main                                                                    | Live config and deployment metadata, HIGH                                                  | Code prepared on current main. Source change/deploy remains blocked by available connector fields and unauthenticated dashboard; do not redeploy old SHA or fast-forward an old phase branch as a workaround.      |

Initial regression run: 6 failures / 74 passes. All six pass after repairs. The aggregate budget regression additionally caught backoff exceeding the remaining deadline; fixed and passing.

## AI failure breakdown

Initial seven-day DB snapshot (assistant requests unless explicitly attempts):

| Category               | Count / evidence                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| AI_CONVERSATION_BUSY   | 0 observed in retrieved incident evidence; concurrency defect reproduced locally             |
| PROVIDER_RATE_LIMIT    | 0 persisted attempts in snapshot                                                             |
| PROVIDER_TIMEOUT       | 0 persisted attempts in snapshot                                                             |
| PROVIDER_UNAVAILABLE   | 3 Fast requests / 6 attempts                                                                 |
| PROVIDER_CONFIGURATION | 0 classified configuration attempts; historical BAI invalid_request = 1                      |
| CIRCUIT_OPEN           | No observed affected request; all four runtime rows ACTIVE                                   |
| BOT_TO_API_TIMEOUT     | None confirmed in retrieved incident logs; default mismatch exists                           |
| DATABASE_ERROR         | None confirmed as production incident cause; dependency-failure injection reproduces defects |
| CREDIT_ERROR           | 0 failed/cancelled rows with nonzero net charge; ledger/debit checks clean                   |
| TELEGRAM_SEND_ERROR    | No confirmed AI answer delivery failure in incident sample                                   |
| STUCK_MESSAGE          | 0 pending/running/streaming rows at both checks                                              |
| DEPLOYMENT/NETWORK     | Source drift confirmed; provider network subtype not historically retained                   |
| UNKNOWN                | Exact upstream reason for 6 unavailable attempts cannot be recovered                         |

Do not interpret missing telemetry as proof that an error never occurred.

## Timeout budget

| Setting                    | Baseline                                                      | Repair                                                                   |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Per provider attempt       | 45,000 ms default; override name absent in live API variables | 45,000 ms unchanged                                                      |
| Same-provider retry        | 1 default; override name absent                               | Fast/fixed: 1; Expert auto: prefer next configured provider before retry |
| Fast maximum provider path | Approximately 90.1 seconds plus DB operations                 | Total gateway provider/backoff budget 90 seconds                         |
| Expert theoretical path    | Approximately 270.3 seconds plus DB operations                | Shared provider/backoff budget 90 seconds across all routes              |
| Bot AI HTTP request        | 60,000 ms default; override name absent                       | 105,000 ms default                                                       |
| Bot ordinary API           | 5,000 ms default; live override exists, value withheld        | Unchanged                                                                |
| Half-open admission lease  | Default 50 seconds vs retries up to 90 seconds                | 95 seconds by default                                                    |

The 15-second outer margin allows normal DB/context/finalization overhead; it is not a hard bound on a stalled DB call. A pathological DB stall can still exceed it. Native fetch abort bounds provider I/O, but DB calls do not receive the provider abort signal. Do not claim a full distributed request deadline. Explicit live overrides must be verified from safe startup logs after deployment.

## Provider health and configuration mismatch list

| Provider  | Configured / enabled                                                        | Model evidence                        | State / issue                                                                                         |
| --------- | --------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Gemini    | Key name present and real successful calls; enabled inferred from execution | `gemini-3.8-flash` in attempts        | ACTIVE; last failure unavailable; 3 failed requests                                                   |
| BAI       | Key and enabled-setting names present; exact current values withheld        | Historical `DeepSeek-V4.1-Flash`      | ACTIVE; one earlier invalid_request; present live routing unverified                                  |
| OpenAI    | Key and enabled-setting names present; values withheld                      | Model variable present, value unknown | ACTIVE; no real attempts in initial snapshot                                                          |
| Anthropic | API key variable absent; enabled-setting name present                       | Model variable present, value unknown | ACTIVE DB row does not prove configuration; appears unconfigured unless supplied outside rendered env |

Production API has `AI_EXPERT_PROVIDER_MODE` and `AI_EXPERT_PROVIDER_ORDER`; legacy `AI_EXPERT_PROVIDER` is absent. Accidental legacy fixed routing is NOT established. No provider/model string was changed. Model availability cannot be fully verified without the actual authorized runtime configuration.

Railway OAuth lists names only (`valuesRedacted=true`). Dashboard is unauthenticated. Safe startup logs now report effective model/configured/enabled/routing/timeouts without keys; no env dumps or credentials were added.

## Circuit breaker

Baseline and retained policy: failure threshold 3 / window 120 seconds / cooldown 300 seconds / max cooldown 1,800 seconds (code defaults; live setting values withheld). One rate-limit response opens the circuit immediately. Retry-After is parsed (seconds or HTTP date); baseline policy applies the maximum of base cooldown and retry-after, capped at configured maximum. Half-open failures back off exponentially. No production 429 evidence justified changing that cooldown policy.

OPEN, HALF_OPEN, threshold, manual pause, Retry-After, success recovery and two logical gateway instances sharing one state store are covered. A failed admission read never bypasses the shared gate. Post-attempt write failures do not discard successful content. No production provider state was reset; timestamp remained `2026-09-24T10:55:18.416Z` after DB smoke.

## Conversation locking and idempotency

Actual statuses: pending, running, streaming, completed, failed, cancelled. SQL begin locks the owned conversation and detects an active assistant; unique conversation/idempotency index plus request_message_id uniqueness protects duplicates. Bot key is based on Telegram chat/message identity; legitimate subsequent message IDs are distinct.

Same-user rule: intentional FIFO sequencing; question B waits for A, then executes using current state. Other users run concurrently. Callback UI is acknowledged before entering FIFO. API-level same-key replay returns busy while the original runs and cannot fail it.

No stale processing found. No recovery migration added, per evidence-first requirement. Process death can leave a running row; existing schema has no durable processing lease/reaper. This remains a documented untested production restart risk, not a confirmed incident root cause. Completed/failed replay UX and balance prechecks also merit future targeted acceptance; do not advertise all replay scenarios as resolved.

## Credits

- Failure = no charge: PASS, live rows and rollback SQL.
- Duplicate = no double debit: PASS for tested normal duplicate and in-flight replay; SQL complete is idempotent.
- Delivery reversal: PASS in rollback SQL, including repeated reversal; exact fractional balance restored.
- Live ledger consistency: PASS, 0 mismatches joining ledger reference to message public_id; 0 duplicate per-bucket AI debit groups.
- Partial Telegram delivery: existing policy refunds the entire answer; new diagnostics retain sent/total chunk counts. No automatic resend was added, avoiding ambiguous duplicate delivery.
- Refund API failure: now logged explicitly; durable refund retry/reconciliation is not implemented, and no production instance was confirmed.

## Bot and Telegram

Runner concurrency remains 16. Constraints remain user and chat; no competing production polling process started. 1/5/16/32 mocked concurrent gateway requests complete without loss; actual multiuser Telegram load/latency is not claimed. Existing Bot tests prove independent users proceed and same-user messages stay ordered.

Controller compare-and-swap and cleanup exceptions remain graceful. Sticker send/delete exceptions are caught; pending sticker cleanup still can delay answer dispatch until the Telegram call settles. Message chunks retain 3,800 UTF-16-unit safety limit and plain text (no Markdown parse failures); all chunk failures attempt refund. No observed Telegram 429 justified adding blanket send retries.

Error handler logs safe correlation-bound failure events and tolerates failure to send the error message itself. Runner transport retry is retained; no update replay/queue redesign.

## Performance and networking

Observed failed trace: runtime context 1.214 s; AI context 0.199 s; provider attempts 13.470 / 0.503 s; failed finalize 0.179 s; total user-visible Bot handling 19.757 s. Successful September 24 AI service request: 14.034 s.

Railway API/Bot are SFO; Supabase is ap-southeast-2 (Sydney). Cross-region network cost exists; no region move or custom fetch pool introduced. Native fetch reuse is retained. The observed internal-route log host and earlier health probes establish private networking usage historically; exact current API_BASE_URL value is withheld. No URL change.

Context/history is read before estimate and again after begin; this protects against concurrent history changing before the conversation admission lock. No unsafe snapshot reuse or speculative query rewrite. SQL statement statistics are aggregate samples, not a per-request RTT trace. No proven DB lock-contention incident.

## Railway and readiness

Existing API deployment: `9bf5f5d5-bf14-41d5-8064-e2827a8a07a2`, SUCCESS.
Existing Bot deployment: `e3122e62-946b-48be-a1e8-f62899880a3a`, SUCCESS.
Both created 2026-09-23 17:29 UTC from `1efb4b0bbe81319aebacecf0f025a9ab096109d0`, source `phase/07-yuristim-ai`.

Seven-day metrics snapshot: API memory average 0.182 GB / maximum 0.353 GB; Bot average 0.144 GB / maximum 0.313 GB. CPU maxima approximately 0.0283 and 0.0263 cores. No resource-saturation evidence. Logs show deploy-associated SIGTERM; do not label normal replacement as spontaneous crash. One older failed API build is present in deployment history.

/health is liveness. /ready reports mode availability without external provider calls; it is not a complete DB-health 503 gate. Startup config diagnostics improve missing-key visibility. No readiness behavior change was made without dependency-availability acceptance.

## Database and security

All 6 AI tables: RLS enabled AND forced. Client-denial privileges and service-role functions checked in rollback smoke. No RLS weakening, schema migration, key rotation, provider reset or user-data deletion. No prompt, document, raw provider body, token or key is intentionally added to logs. API automatic raw URL request logs are disabled; structured route templates preserve correlation without Telegram ID path leakage. Existing non-AI console warnings have not all been converted; no repository-wide secret audit certification is claimed.

## Observability

Bot→API correlation existed and was observed. Repair adds Bot requestId/error category and single-line records; provider attempt events now include provider/status/HTTP status/reason; final AI failures retain safe reason; DB telemetry persistence failures, answer delivery and refund outcomes are explicit.

Provider-attempt DB schema remains unchanged. New diagnostic detail is in structured logs; historical rows cannot be retroactively enriched. First-response metric remains streaming-only; Telegram buffered generate records total attempt time.

## Validation

- `pnpm install --frozen-lockfile`: PASS, pinned pnpm 11.19.0, lockfile unchanged.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`, `git diff --check`: PASS locally.
- Unit/integration count: 238 (AI 61, Bot 75, API 98, config 2, DB package 2).
- Live rollback-only database smoke: PASS, 10 check groups plus in-flight conflict/replay and repeated refund assertions; fixture absence verified afterward.
- Complete pgTAP suite: 7 files / 211 planned assertions; isolated CI job added using Supabase CLI 2.117.0. Status to be confirmed by GitHub CI before merge.
- Local Docker/Postgres unavailable; package installation hit OS privilege restrictions. No sandbox/security workaround attempted.

## Real production smoke and acceptance

| Test                                            | Result                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tezkor Q1 / Q2 / Q3                             | NOT RUN after repair; historical success and failure do not substitute                |
| Ekspert Q1 / Q2 / Q3                            | NOT RUN after repair                                                                  |
| Same-user quick repeat / new chat / mode switch | Mocked regression coverage; real Telegram acceptance pending                          |
| AI answers reliably                             | NOT YET VERIFIED in repaired production                                               |
| Unexplained temporary busy eliminated           | NO — historic provider-unavailable cause unresolved; diagnostics prepared             |
| No stuck conversation                           | PASS at two DB snapshots; restart recovery not certified                              |
| No double credit                                | PASS for examined ledger and tested flows                                             |
| Provider failover correct                       | PASS mocked supported error classes; invalid_request intentionally does not fail over |
| Fast Gemini-only preserved                      | PASS                                                                                  |
| Production deployed                             | NO for B1                                                                             |
| Post-deploy logs clean                          | NOT TESTED                                                                            |

READY FOR NEXT BACKEND PHASE: NO.

Exact blockers: authenticate Railway dashboard or expose authorized source-update capability to switch both existing services to main; inspect effective safe runtime config; deploy merged B1 SHA to both services; run the six controlled real questions and conversation actions via an authorized test account; correlate logs and debit/refund ledger. Do not claim the upstream unavailable incident repaired until new diagnostics establish its HTTP/network/malformed-output cause and real acceptance succeeds.
