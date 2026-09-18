begin;

alter table public.ai_messages
  drop constraint ai_message_success_usage,
  add constraint ai_message_success_usage check (
    role <> 'assistant'
    or status <> 'completed'
    or (
      char_length(btrim(content)) > 0
      and input_tokens is not null
      and output_tokens is not null
      and provider_cost_usd is not null
      and charged_credits >= 1
      and refunded_credits = 0
      and error_code is null
    )
  );

commit;
