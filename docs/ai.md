# Yuristim AI

## Runtime boundary

```text
HTTP/SSE yoki Bot HMAC request
  → AiService
  → context + versioned system policy
  → AiGateway mode router
  → provider adapter
  → normalized content + usage
  → atomic message completion + credit ledger debit
```

Bot database'ga kirmaydi. Public va internal transportlar bir xil `AiService` va
ownership qoidalaridan foydalanadi. Public response provider/model, raw provider
error, internal UUID, pricing internals yoki system promptni bermaydi.

## Mode routing

- `fast`: faqat Gemini. Same-provider transient retry bounded; boshqa providerga
  fallback yo‘q.
- `expert`: `AI_EXPERT_PROVIDER` bilan OpenAI yoki Anthropic. Provider nomi UX'da
  yashirin.

Model, token pricing, markup, context va timeout `.env.example`dagi `AI_*`
variable'lar bilan markazdan boshqariladi. `/ready` Fast/Expert availability'ni
sanitized boolean sifatida ko‘rsatadi, lekin optional provider yo‘qligi butun API'ni
down qilmaydi.

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
