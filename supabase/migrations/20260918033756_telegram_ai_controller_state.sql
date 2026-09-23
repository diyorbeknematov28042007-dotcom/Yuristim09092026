alter table public.ai_user_states
  add column telegram_control_message_id bigint;

alter table public.ai_user_states
  add constraint ai_user_states_telegram_control_message_id_check
  check (telegram_control_message_id is null or telegram_control_message_id > 0);

comment on column public.ai_user_states.telegram_control_message_id is
  'Telegram message id of the single active Yuristim AI controller sent by the bot.';
