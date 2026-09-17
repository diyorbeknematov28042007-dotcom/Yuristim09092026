begin;

create index if not exists marketplace_posts_selected_acceptance_idx
  on public.marketplace_posts (selected_acceptance_id)
  where selected_acceptance_id is not null;

create index if not exists marketplace_posts_specialization_id_idx
  on public.marketplace_posts (specialization_id)
  where specialization_id is not null;

create index if not exists marketplace_reviews_user_id_idx
  on public.marketplace_reviews (user_id);

commit;
