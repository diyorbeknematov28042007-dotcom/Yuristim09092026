# Yuristim09092026 → Cloudflare: audit va migratsiya nazorati

Asos: `main` commit `0f08023`. Migratsiya branch'i: `migration/cloudflare-full-infrastructure`.
Bu hujjat yangi repositoryga tegishli. `Yuristimbot07082026` Worker/D1 resurslaridan foydalanilmaydi.

## Koddan tekshirilgan holat

| Qism          | Hozirgi implementatsiya                                                                                 | Cloudflare uchun ish                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`    | Fastify 5, Node HTTP server, `node:crypto`, `@node-rs/argon2`, startdagi admin bootstrap, `setInterval` | Fetch-based Worker transport; barcha route contractlarini saqlash; Web Crypto va xavfsiz Argon2id muqobili; bootstrap va interval vazifalarini xavfsiz Cron/idempotent operatsiyaga ko‘chirish |
| `apps/bot`    | grammY + `@grammyjs/runner` polling, 16 concurrency, ichki HMAC API client                              | Webhook secret, per-user persistent tartib/dedupe, mavjud bot handlerlarini qayta ishlatish, ichki API contractlarini saqlash                                                                  |
| `apps/web`    | Next.js 16, public DUID sahifasida runtime API fetch va dynamic image; `next/image`                     | Hozirgi vazifa doirasidan chiqarildi: mavjud frontend fayllari va hostingga tegilmaydi. Kelajakdagi yangi UI uchun backend API va Telegram initData verification saqlanadi.                    |
| `packages/db` | Supabase JS client va PostgREST/RPC repositorylari                                                      | D1 repository implementatsiyasi; RLS o‘rniga faqat Worker binding + har route'da actor/owner tekshiruvi                                                                                        |
| `packages/ai` | Gemini/OpenAI/Anthropic/B.AI gateway, routing, failover, circuit breaker, streaming                     | Mavjud model/router/policy qiymatlarini saqlash; D1 AI repository; streaming va charge/refund atomikligi                                                                                       |
| SQL           | 26 migration; 31 jadval; 40+ business/RPC function; trigger, RLS va private Storage                     | SQLite schema + invariant triggers + server-side authorization; RPC semantikasini alohida port va testlash                                                                                     |
| Testlar       | 40 test fayli, mavjud unit/integration testlar                                                          | Biznes qoida testlarini D1 real SQL va Worker transport testlari bilan davom ettirish                                                                                                          |

## Qattiq invariantlar

1. Kredit `numeric(14,3)` → butun **milli-credit**; pul `numeric(14,2)` → butun tiyin/cent birligi. Decimal/floating-point hisob yoki `Number` bilan konvertatsiya moliyaviy yo‘lda ishlatilmaydi.
2. Ledger immutable; debit bo‘yicha barcha bucketlar va balance bir transaction ichida. Bitta payment provider reference va idempotency key bir marta grant yaratadi. D1 `batch`/SQL triggerlar va unikal indekslar orqali fail-closed; faqat Durable Object navbatiga tayanish yetarli emas.
3. Telegram auth challenge va session faqat HMAC hash holida; replay hamda expiry tekshiruvlari saqlanadi. PIN Argon2id himoyasi pasaytirilmaydi. Xavfsiz Worker-mos Argon2id porti isbotlanmaguncha production auth ko‘chirilmaydi.
4. Lawyer `active_mode=lawyer` faqat verifikatsiya tasdiqlanganidan keyin. Document bucket private; R2 obyektlari API orqali actor/owner/admin tekshiruvlaridan keyin beriladi.
5. API, Bot, Web orasidagi mavjud contractlar va AI provider model identifikatorlari o‘zgarmaydi. Secretlar faqat server-side Cloudflare bindings'da turadi.

## Yangi muhit holati

- Cloudflare accountdagi eski `yuristim-staging` va `yuristim-production` D1 bazalariga tegilmadi.
- Yangi `yuristim-v2-staging` D1 (`5b79bbfe-c43f-41f6-9dd8-a36b5a700972`) alohida yaratildi. `0001`–`0011` migratsiyalari ketma-ket qo‘llandi. Remote D1 32 jadval, 12 seeded specializations, 4 inactive credit product, 1 active sandbox accept product va 4 AI provider holatini tasdiqladi. Local SQLite invariant testlari 30/30 o‘tdi. Baza hali haqiqiy foydalanuvchi yoki to‘lov ma’lumotini olmayapti.
- `0004` kredit va to‘lov qiymatlarini integer milli-credit/UZS hundredths tarzida saqlaydi; immutable ledger, idempotency va to‘lov holati/grantni bitta SQLite statementida atomik bajaruvchi triggerlar qo‘shildi. `0005` mavjud checkoutning `pending` boshlang‘ich holatini ruxsatli qiladi. PostgreSQL RPC’larining to‘liq D1 repository/business porti va parallel Worker testlari hali bajarilmagan.
- `0006` admin bonus auditini grantga, `0007` marketplace qabulining accept debitini bir atomik yozuvga bog‘laydi. `0008` persistent AI suhbat/holat, provider diagnostikasi va bitta faol so‘rov cheklovini yaratadi. `0009` maxfiy hujjat metadata/state; `0010` Founding 100 capacity va event ingress qoidalarini yaratadi. R2 obyektlari va bu jadvallarga API kirishi hali ulanmagan.
- `packages/db/src/d1-core-repository.ts` asosiy auth repository contractini D1 prepared SQL bilan ifodalaydi; login challenge `UPDATE ... WHERE status ... AND expires_at > now RETURNING` bir martalik ishlash uchun atomik. Repository API runtime’ga ulanmagan: avval lawyer va finance sxema/triggerlari hamda welcome credit invariantini ko‘chirish shart.
- `packages/db/src/d1-finance-repository.ts` original FinanceRepository contracti uchun integer konvertatsiya, grant/debit, weekly credit, accept va payment webhook yo‘lini yozadi. Real SQLite bilan testlar o‘tgan; Cloudflare Worker runtime’ga eksport/ulash va D1 integration hamda boshqa repositorylar bilan to‘liq tranzaksion tekshiruv qolgan.
- `packages/db/src/d1-marketplace-repository.ts` post/draft/accept/selection/review kontraktini D1 bilan ifodalaydi; real SQLite testlari capacity, takroriy qabul va selection/review’ni tekshiradi. Worker’ga hali ulanmagan.
- Cloudflare hisobida R2 subscription yoqilmagan (`GET /r2/buckets` 403, code 10042). R2 faollashtirish usage-based billing shartlarini qabul qilishni anglatadi; ruxsatsiz yoqilmadi. 5 MB xususiy hujjatlar uchun R2 zarur. Workers Free 10 ms CPU cheklovi mavjud Argon2id PIN himoyasiga xavf tug‘diradi; native Node Argon2 Workers’da qo‘llanmaydi. Bu masala hal qilinmaguncha production auth deploy qilinmaydi.
- Bu **to‘liq biznes migratsiyasi emas**. Schema jadvallari qo‘llangan, lekin PostgreSQL RPC’larining qolgan server-side ekvivalentlari, API/Bot va R2 hali yangi D1’ga ulanmagan va yangi Worker deploy qilinmagan. Web va Mini App frontendlari shu vazifada ko‘chirilmaydi. Eski staging bot yoki production domenlari almashtirilmagan. Barcha RPC/auth va xavfsizlik qoidalari ko‘chmaguncha endpointni jonli trafik uchun yoqmaslik kerak.

## Ish tartibi va gate'lar

1. 31 jadval/relationship/constraint/triggerning so‘nggi holatini D1 migrationlarda ifodalash; har bosqichda haqiqiy D1 va SQLite invariant testlari.
2. Auth, lawyer verification va private R2 fayllar; eski sessiya/PIN xavfsizligini teng darajada saqlash.
3. Finance/payment/marketplace uchun integer accounting va transaction/idempotency testlarini port qilish. Pul va kredit yo‘lida muvaffaqiyatsiz test bo‘lsa deploy qilmaslik.
4. AI repository, failover, history, streaming, charging/refund; bot webhook va kelajakdagi Web/Mini App uchun API contractlarni ulash.
5. Build/lint/typecheck/unit/integration/security hamda live staging smoke; Free quota sarfini o‘lchash; shundan keyin production secretlar va alohida webhook/domen tasdig‘i.

## Limit va rollout qarori

Cloudflare rasmiy Free limitlarini deploy oldidan yana tekshirish: Workers 100 000 request/kun va 10 ms CPU/request; D1 5 mln row read/kun, 100 000 row write/kun, 500 MB/baza; Durable Objects Free quota. Kredit ledger, AI history va provider attemptlari yozuv sonini oshiradi; haqiqiy trafik o‘lchanmaguncha Free sig‘imiga aniq kafolat berilmaydi. R2/Workers Builds/Next adapter narxi va mosligini ham alohida tekshirish kerak. Pullik resurs yoqilmagan.

Rollback: eski hosting/webhook/domenni ishlayotgan holda saqlash; yangi Worker trafikni qabul qilmaguncha cutover qilmaslik. D1 schema rollbacki eski Supabase biznes holatini avtomatik tiklamaydi. Production cutover oldidan eski webhook, DNS va deploy versiyasi qayd etiladi.
