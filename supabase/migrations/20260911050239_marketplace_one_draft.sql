create unique index marketplace_posts_one_draft_per_user on public.marketplace_posts (user_id) where status = 'draft';
