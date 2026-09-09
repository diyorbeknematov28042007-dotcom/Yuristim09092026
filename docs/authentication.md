# Core authentication

## Identity

Bir Telegram account (`telegram_user_id`) bitta Yuristim accountga teng. Telegram
username identity emas va Bot orqali yangilanadigan metadata hisoblanadi. Har user
Telegram ID, UUID va DUID'ga ega; DUID provisional `yr_` + 16 ta base64url belgi.

## Telegram login

1. Web `POST /auth/telegram/start`dan request ID va opaque challenge oladi.
2. User challenge'ni Telegram Botda tasdiqlaydi.
3. Bot Telegram identity bilan `/internal/telegram/auth/confirm`ga HMAC-imzolangan
   so‘rov yuboradi.
4. Web `POST /auth/telegram/confirm` orqali challenge'ni bir marta consume qiladi.
5. API raw session tokenni HttpOnly, SameSite=Lax cookie orqali beradi; productionda
   cookie Secure bo‘ladi.

Challenge 10 daqiqada tugaydi, bir martalik va database'da faqat HMAC hash sifatida
saqlanadi. Takroriy Bot confirmation ayni Telegram user uchun idempotent; consume
takrorlanmaydi.

## PIN

PIN aynan to‘rtta raqamli string, shu sabab `0001` valid. Database faqat Argon2id
hashni saqlaydi. Ketma-ket besh noto‘g‘ri urinishdan keyin PIN verification 15
daqiqaga qulflanadi. PIN reset yangi Telegram login challenge bilan tasdiqlanadi.

## Session

Session token 32 random byte'dan generatsiya qilinadi. Database'da raw token emas,
server secret bilan HMAC-SHA-256 hash saqlanadi. Default TTL 30 kun; logout sessionni
revoke qiladi va cookie'ni o‘chiradi. Expired, revoked yoki blocked user sessioni
qabul qilinmaydi.

## Profile va role

Public response `pin_hash`, token/challenge hash va lock state'ni bermaydi. User
faqat allowlist qilingan `fullName`, language, terms, role va mode amallarini
o‘zgartira oladi. Lawyer role niyati uchun F.I.Sh. talab qilinadi; lawyer mode Phase
4 verificationgacha `409 LAWYER_NOT_VERIFIED` bilan rad etiladi.

## Internal Bot auth

Internal so‘rovlar body va Unix timestamp ustidan HMAC-SHA-256 bilan imzolanadi.
API besh daqiqalik vaqt oynasini, constant-time signature comparisonni va strict
request schemani tekshiradi. Shared secret hech qachon response yoki logga kirmaydi.
