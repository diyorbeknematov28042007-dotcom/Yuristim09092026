export const AI_FAILURE_REASONS = [
  'http_error',
  'rate_limit',
  'quota_exhausted',
  'authentication_failed',
  'permission_denied',
  'timeout',
  'request_budget',
  'network_error',
  'missing_finish',
  'output_limit',
  'incomplete_response',
  'malformed_response',
  'empty_response',
  'invalid_usage',
  'circuit_open',
  'not_configured',
  'cancelled',
  'internal_error',
  'database_error',
  'delivery_failed',
  'client_timeout',
  'client_stream_closed',
  'client_network_error',
  'proxy_timeout',
  'proxy_network_error',
  'proxy_stream_closed',
  'request_processing',
  'unknown',
] as const;
export const AI_FAILURE_STAGES = [
  'prepare',
  'generation',
  'finalize',
  'delivery',
  'proxy',
  'client',
] as const;
export const AI_FAILURE_OPERATIONS = [
  'load_conversation',
  'load_history',
  'load_balance',
  'begin_message',
  'request_provider',
  'route_message',
  'complete_message',
  'reload_conversation',
  'write_stream',
  'connect_backend',
  'read_backend_stream',
  'read_client_stream',
  'send_telegram_message',
] as const;
export interface AiFailureDiagnostic {
  reason: (typeof AI_FAILURE_REASONS)[number];
  stage: (typeof AI_FAILURE_STAGES)[number];
  operation?: (typeof AI_FAILURE_OPERATIONS)[number];
  databaseCode?: string;
  requestId?: string;
  messageId?: string;
  upstreamStatus?: number;
  elapsedMilliseconds?: number;
  receivedCharacters?: number;
}

// Only allow known, non-sensitive fields across the public API boundary.
export function parseAiFailure(value: unknown): AiFailureDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !AI_FAILURE_REASONS.includes(record.reason as AiFailureDiagnostic['reason']) ||
    !AI_FAILURE_STAGES.includes(record.stage as AiFailureDiagnostic['stage'])
  )
    return undefined;
  const result: AiFailureDiagnostic = {
    reason: record.reason as AiFailureDiagnostic['reason'],
    stage: record.stage as AiFailureDiagnostic['stage'],
  };
  if (
    AI_FAILURE_OPERATIONS.includes(
      record.operation as NonNullable<AiFailureDiagnostic['operation']>,
    )
  )
    result.operation = record.operation as NonNullable<AiFailureDiagnostic['operation']>;
  if (
    typeof record.databaseCode === 'string' &&
    /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(record.databaseCode)
  )
    result.databaseCode = record.databaseCode;
  for (const key of ['requestId', 'messageId'] as const) {
    if (typeof record[key] === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(record[key]))
      result[key] = record[key];
  }
  for (const key of ['upstreamStatus', 'elapsedMilliseconds', 'receivedCharacters'] as const) {
    const number = record[key];
    if (
      typeof number === 'number' &&
      Number.isSafeInteger(number) &&
      number >= 0 &&
      number <= 1_000_000_000 &&
      (key !== 'upstreamStatus' || (number >= 100 && number <= 599))
    )
      result[key] = number;
  }
  return result;
}

export function formatAiFailure(
  language: 'uz' | 'ru' | 'en',
  failure: AiFailureDiagnostic,
): string {
  const index = language === 'ru' ? 1 : language === 'en' ? 2 : 0;
  const messages: Record<AiFailureDiagnostic['reason'], [string, string, string]> = {
    http_error: [
      'Ko‘rsatilgan bosqichdagi server so‘rovni HTTP xatosi bilan rad etdi.',
      'Сервер на указанном этапе отклонил запрос с HTTP-ошибкой.',
      'The server at the indicated stage rejected the request with an HTTP error.',
    ],
    rate_limit: [
      'AI xizmati so‘rovlar tezligi limitini qaytardi (429). Quota tugagani tasdiqlanmagan.',
      'AI-сервис вернул ограничение частоты (429). Исчерпание квоты не подтверждено.',
      'The AI service returned a rate limit (429). Quota exhaustion is not confirmed.',
    ],
    quota_exhausted: [
      'AI xizmati quota yoki hisob limiti tugaganini aniq qaytardi.',
      'AI-сервис явно сообщил об исчерпании квоты или лимита счёта.',
      'The AI service explicitly reported exhausted quota or account limits.',
    ],
    authentication_failed: [
      'AI xizmatiga ulanish credential’i rad etildi. Bu sizning login xatoyingiz emas.',
      'AI-сервис отклонил учётные данные сервера. Это не ошибка вашего входа.',
      'The AI service rejected the server credential, not your login.',
    ],
    permission_denied: [
      'AI xizmati ushbu so‘rovga ruxsat bermadi (403).',
      'AI-сервис запретил этот запрос (403).',
      'The AI service denied permission for this request (403).',
    ],
    timeout: [
      'AI xizmatidan javob olish uchun ajratilgan vaqt tugadi.',
      'Истекло время ожидания ответа AI-сервиса.',
      'The AI service response deadline was reached.',
    ],
    request_budget: [
      'AI gateway’ning umumiy kutish muddati tugadi.',
      'Истекло общее время ожидания AI-шлюза.',
      'The overall AI gateway deadline was reached.',
    ],
    network_error: [
      'Backend bilan AI xizmati o‘rtasida transport xatosi yuz berdi. Tarmoqdagi aniq uzilish sababi qayd etilmagan.',
      'Ошибка транспорта между backend и AI-сервисом. Точная сетевая причина не зафиксирована.',
      'A transport error occurred between the backend and AI service. The underlying network cause was not recorded.',
    ],
    missing_finish: [
      'AI javob oqimi yakuniy tugash belgisisiz yopildi. Kelgan matn to‘liq javob deb tasdiqlanmadi.',
      'Поток AI закрылся без подтверждения завершения. Полученный текст не признан полным ответом.',
      'The AI stream closed without a completion marker. Received text was not confirmed as a complete answer.',
    ],
    output_limit: [
      'AI javobni belgilangan output token limitiga yetgani uchun to‘xtatdi.',
      'AI остановил ответ из-за лимита выходных токенов.',
      'The AI stopped at the configured output token limit.',
    ],
    incomplete_response: [
      'AI xizmati javobni normal yakunlamaganini bildirdi.',
      'AI-сервис сообщил, что ответ не завершён нормально.',
      'The AI service reported that the response did not finish normally.',
    ],
    malformed_response: [
      'Javob oqimidagi ma’lumot formati buzilgan yoki JSON sifatida o‘qilmadi.',
      'Формат данных потока повреждён или не читается как JSON.',
      'The response stream contained malformed or unreadable JSON data.',
    ],
    empty_response: [
      'AI xizmati javob qaytardi, lekin foydalanuvchiga ko‘rsatiladigan matn bo‘sh edi.',
      'AI-сервис ответил, но отображаемый текст был пустым.',
      'The AI service responded but returned no visible answer text.',
    ],
    invalid_usage: [
      'Javob bilan kelgan token hisobi yaroqsiz yoki yo‘q edi.',
      'Учёт токенов в ответе отсутствует или недействителен.',
      'Token accounting in the response was missing or invalid.',
    ],
    circuit_open: [
      'Oldingi muvaffaqiyatsiz urinishlardan keyin AI yo‘li vaqtincha yopilgan; yangi so‘rov yuborilmadi.',
      'После предыдущих сбоев маршрут AI временно закрыт; новый запрос не отправлен.',
      'The AI route is temporarily paused after prior failures; no new request was sent.',
    ],
    not_configured: [
      'Tanlangan AI yo‘li yoqilmagan yoki ulanish sozlamasi mavjud emas.',
      'Выбранный маршрут AI отключён или не настроен.',
      'The selected AI route is disabled or its connection is not configured.',
    ],
    cancelled: [
      'Javob yetkazish ulanishi yopildi yoki so‘rov bekor qilindi. Kim yopgani tasdiqlanmagan.',
      'Соединение доставки закрылось или запрос отменён. Инициатор не подтверждён.',
      'The delivery connection closed or the request was cancelled. The initiator is not confirmed.',
    ],
    internal_error: [
      'Ko‘rsatilgan backend bosqichida ichki xato yuz berdi. Ichki sabab logda tekshirilishi kerak.',
      'В указанном этапе backend произошла внутренняя ошибка. Причину нужно проверить в логах.',
      'An internal error occurred at the indicated backend stage. Its cause requires log inspection.',
    ],
    database_error: [
      'Database ko‘rsatilgan operatsiyani xato kodi bilan rad etdi.',
      'База данных отклонила указанную операцию с кодом ошибки.',
      'The database rejected the indicated operation with an error code.',
    ],
    delivery_failed: [
      'Tayyor javobni foydalanuvchiga yetkazish muvaffaqiyatsiz bo‘ldi.',
      'Не удалось доставить готовый ответ пользователю.',
      'Delivery of the generated answer to the user failed.',
    ],
    client_timeout: [
      'Client javob oqimini kutish muddati tugadi. Backend natijasi qayta tekshiriladi.',
      'Истекло время ожидания потока на клиенте. Результат backend проверяется повторно.',
      'The client stream deadline was reached. The backend result is rechecked.',
    ],
    client_stream_closed: [
      'Clientga kelayotgan oqim completed xabarisiz yopildi. Bu AI umuman javob yaratmaganini isbotlamaydi.',
      'Поток к клиенту закрылся без события completed. Это не доказывает отсутствие ответа AI.',
      'The client stream closed without a completed event. This does not prove that the AI generated no answer.',
    ],
    client_network_error: [
      'Client bilan server o‘rtasidagi ulanish ishlamadi. Tarmoqdagi aniq sabab qayd etilmagan.',
      'Сбой соединения клиента с сервером. Точная сетевая причина не зафиксирована.',
      'The client-to-server connection failed. The underlying network cause was not recorded.',
    ],
    proxy_timeout: [
      'Vercel proxy’ning backend javobini kutish muddati tugadi.',
      'Истекло время ожидания backend в прокси Vercel.',
      'The Vercel proxy deadline for the backend response was reached.',
    ],
    proxy_network_error: [
      'Vercel proxy backend bilan ulana olmadi. Asosiy tarmoq sababi aniqlanmagan.',
      'Прокси Vercel не смог подключиться к backend. Причина сетевого сбоя неизвестна.',
      'The Vercel proxy could not connect to the backend. The underlying network cause is unknown.',
    ],
    proxy_stream_closed: [
      'Vercel proxy orqali javob oqimi uzildi.',
      'Поток ответа через прокси Vercel прервался.',
      'The response stream through the Vercel proxy was interrupted.',
    ],
    request_processing: [
      'Backend so‘rov hali ishlanayotganini tasdiqladi; yakuniy natija hozircha yo‘q.',
      'Backend подтвердил, что запрос ещё обрабатывается; итогового результата нет.',
      'The backend confirmed that the request is still processing; no final result is available yet.',
    ],
    unknown: [
      'Xato qayd etildi, lekin uning aniq sababi ushbu javobda mavjud emas.',
      'Ошибка зафиксирована, но точная причина в этом ответе отсутствует.',
      'An error was recorded, but its exact cause is unavailable in this response.',
    ],
  };
  const stages: Record<AiFailureDiagnostic['stage'], [string, string, string]> = {
    prepare: ['so‘rovni tayyorlash', 'подготовка запроса', 'request preparation'],
    generation: ['AI javobini olish', 'получение ответа AI', 'AI generation'],
    finalize: [
      'javobni saqlash/yakunlash',
      'сохранение/завершение ответа',
      'answer persistence/finalization',
    ],
    delivery: ['javobni yetkazish', 'доставка ответа', 'answer delivery'],
    proxy: ['Vercel → backend', 'Vercel → backend', 'Vercel → backend'],
    client: ['server → client', 'сервер → клиент', 'server → client'],
  };
  const details = [
    `${['Bosqich', 'Этап', 'Stage'][index]}: ${stages[failure.stage][index]}`,
    `Code: ${failure.reason.toUpperCase()}`,
  ];
  if (failure.operation) details.push(`Step: ${failure.operation.toUpperCase()}`);
  if (failure.databaseCode) details.push(`DB: ${failure.databaseCode}`);
  if (failure.upstreamStatus !== undefined) details.push(`HTTP: ${failure.upstreamStatus}`);
  if (failure.elapsedMilliseconds !== undefined)
    details.push(`${(failure.elapsedMilliseconds / 1000).toFixed(1)} s`);
  if (failure.receivedCharacters !== undefined)
    details.push(
      `${['Kelgan matn', 'Полученный текст', 'Received text'][index]}: ${failure.receivedCharacters} ${['belgi', 'символов', 'characters'][index]}`,
    );
  const reference = failure.requestId ?? failure.messageId;
  if (reference) details.push(`Ref: ${reference}`);
  const databaseMessages: Record<string, [string, string, string]> = {
    '23505': [
      'Database’da takroriy qiymat unique constraint’ni buzdi.',
      'Повторное значение нарушило уникальность в базе данных.',
      'A duplicate database value violated a unique constraint.',
    ],
    '23503': [
      'Database’da bog‘langan yozuv mavjud emas (foreign key).',
      'Связанная запись отсутствует (foreign key).',
      'A referenced database record is missing (foreign key).',
    ],
    '23514': [
      'Saqlanayotgan qiymat database check constraint’iga mos kelmadi.',
      'Значение не соответствует check constraint базы данных.',
      'A value failed a database check constraint.',
    ],
    '42501': [
      'Database ushbu operatsiyaga ruxsat bermadi (permission/RLS).',
      'База данных запретила операцию (permission/RLS).',
      'The database denied this operation (permission/RLS).',
    ],
    '42P01': [
      'Database’da talab qilingan jadval topilmadi.',
      'Нужная таблица не найдена в базе данных.',
      'The required database table was not found.',
    ],
    '42883': [
      'Database’da chaqirilgan funksiya yoki RPC topilmadi.',
      'Вызванная функция или RPC не найдена.',
      'The called database function or RPC was not found.',
    ],
    '57014': [
      'Database so‘rovi bekor qilindi yoki statement timeout’ga yetdi.',
      'Запрос базы данных отменён или достиг statement timeout.',
      'The database query was cancelled or reached its statement timeout.',
    ],
    '40001': [
      'Bir vaqtdagi transactionlar database serialization xatosiga olib keldi.',
      'Конкурирующие транзакции вызвали ошибку serialization.',
      'Concurrent transactions caused a database serialization failure.',
    ],
  };
  const databaseMessage = failure.databaseCode ? databaseMessages[failure.databaseCode] : undefined;
  const message =
    failure.reason === 'database_error' && databaseMessage
      ? databaseMessage[index]
      : messages[failure.reason][index];
  return `${message}\n${details.join(' · ')}`;
}
