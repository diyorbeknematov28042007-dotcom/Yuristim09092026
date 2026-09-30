# AI failure diagnostics (v1)

Every known AI failure returns a safe `diagnostic` in the JSON error or SSE `error` event. Web, Mini App and Bot can display the same explanation. It includes reason, stage, exact operation when available, request reference, elapsed time, received text length, upstream HTTP status and safe SQLSTATE. It never includes prompt/answer text, raw provider bodies, model/provider identities, cookies or credentials.

Examples: `missing_finish` (provider EOF without terminal completion), `output_limit` (explicit output limit), `rate_limit` (429 without proof of exhausted quota), `quota_exhausted` (explicit structured quota error), `authentication_failed` (upstream 401), `timeout` (attempt timeout), `request_budget` (overall gateway deadline), `database_error` plus `complete_message` and SQLSTATE.

The terminal completion markers required for streams are Gemini `STOP`, Responses `response.completed`, and Messages `message_stop`. Partial output is not marked completed if the marker is missing. Client disconnection alone does not prove that upstream generation failed.

Safe reason, stage, operation, HTTP status and SQLSTATE are encoded in the existing `ai_messages.error_code` field (lowercase, <=80 characters). No migration is required. Owner-authorized conversation/history and request-status endpoints reconstruct these diagnostics; live-only elapsed/length/requestId fields are not invented when absent from storage. Historical generic failures remain `unknown`.

Structured runtime events remain available on the existing backend logger. Use the displayed request reference or message public ID to correlate. A hard process kill or network disconnect can prevent the final error event from reaching a client; the client explains the observed missing completion and polls the backend status instead of inventing a provider cause.

Frontend compatibility: its public diagnostic contract mirrors `packages/types/src/ai-diagnostics.ts`; unknown/new fields are stripped and unknown reasons are rejected. Keep the allowed reasons/operations synchronized if the contract changes. Deploy backend first, then Web and Mini App. Never re-send the same prompt automatically just to diagnose it.
