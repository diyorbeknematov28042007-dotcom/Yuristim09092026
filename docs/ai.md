# Yuristim AI

## Runtime boundary

```text
HTTP/SSE yoki Bot HMAC request
  → AiService
  → context + versioned system policy
  → AiGateway mode router
  → shared circuit breaker
  → provider adapter/failover attempt
  → normalized content + usage
  → atomic message completion + credit ledger debit
```

Bot database'ga kirmaydi. Public va internal transportlar bir xil `AiService` va
ownership qoidalaridan foydalanadi. Public response provider/model, raw provider
error, internal UUID, pricing internals yoki system promptni bermaydi.

## Mode routing

- `fast`: faqat Gemini. Same-provider transient retry bounded; boshqa providerga
  fallback yo‘q.
- `expert/auto`: enabled, configured va healthy providerlar orasida
  `AI_EXPERT_PROVIDER_ORDER` (`bai,openai,anthropic`) tartibida failover. B.AI
  OpenAI-compatible Responses transportini reuse qiladi, lekin metadata'da `bai`
  sifatida saqlanadi.
- `expert/fixed`: `AI_EXPERT_PROVIDER_MODE=fixed` va `AI_EXPERT_PROVIDER` bilan
  faqat tanlangan B.AI, OpenAI yoki Anthropic ishlaydi; cross-provider fallback yo'q.
  Backward compatibility uchun eski deployment'da faqat `AI_EXPERT_PROVIDER` mavjud
  bo‘lsa ham u fixed routing deb talqin qilinadi. Yangi deployment mode'ni explicit
  belgilashi kerak.

Model, token pricing, markup, context va timeout `.env.example`dagi `AI_*`
variable'lar bilan markazdan boshqariladi. `/ready` Fast/Expert availability'ni
sanitized boolean sifatida ko‘rsatadi, lekin optional provider yo‘qligi butun API'ni
down qilmaydi.

Provider kill-switch'lari `AI_PROVIDER_*_ENABLED`; shared runtime state esa
`ai_provider_runtime_state` jadvalida saqlanadi. Threshold ichidagi timeout, network,
5xx, malformed response, 429 yoki auth/config failure circuit'ni `OPEN` qiladi.
Cooldown'dan keyin bitta `HALF_OPEN` probe ishlaydi. `ai_provider_attempts` har bir
internal urinishni saqlaydi, ammo public API'da expose qilinmaydi. Failover attempt
charge qilmaydi; faqat yakuniy successful provider usage'i bo‘yicha bitta debit bor.
Streaming'da biror delta yuborilgach cross-provider failover to‘xtaydi, shuning uchun
bitta javobda provider outputlari aralashmaydi.

Provider-specific inference mapping:

- Gemini `gemini-3.8-flash`: `thinkingConfig.thinkingLevel=low`;
- B.AI `DeepSeek-V4.1-Flash`: Responses API `reasoning.effort=high`;
- OpenAI `gpt-5.6-sol`: Responses API `reasoning.effort=high`;
- Anthropic `claude-opus-5`: adaptive thinking va `output_config.effort=high`.

## Persistence va context

Conversation va message'lar Supabase'da saqlanadi. Context faqat conversation
egasining successful history'sidan, tartibli va token-budgetga mos quriladi. Mode
switch shu conversationni saqlaydi; yangi chat tarixni ko‘chirmaydi. Title birinchi
user message'dan Unicode-safe truncation bilan olinadi.

Assistant lifecycle: `RUNNING/STREAMING → COMPLETED | FAILED | CANCELLED`.
Invalid transition database trigger bilan bloklanadi. System prompt user-visible
message sifatida saqlanmaydi; faqat version metadata saqlanadi.

## Credits

Requestdan oldin deterministic estimate balance bilan solishtiriladi. Successful
response uchun actual normalized input/output token usage va centralized pricing
asosida fractional charge hisoblanadi; minimum 1 credit. Completion va ledger debit
bitta RPC transactionida. Idempotency key va message ledger reference duplicate
charge'ni to‘xtatadi. Provider/stream failure charge qilmaydi; final deliverydan
keyingi xatoda append-only reversal ishlaydi.

## Streaming va sources

Web/Mini App endpointi SSE orqali `started`, `delta`, `completed`, `done` eventlarini
beradi. Disconnect provider call'ni cancel qiladi; usable final delivery bo‘lmasa
charge yo‘q yoki reversal bor. Telegram token stream qilmaydi: localized progress
xabarini final plain-text chunks bilan almashtiradi.

`ai_message_sources` Phase 8 uchun schema foundation. Phase 7 retrieval qilmaydi va
bo‘sh source listni saqlaydi. Versioned policy qonun/modda/URL yoki LexUZ qidiruvini
o‘ylab topishni taqiqlaydi.
