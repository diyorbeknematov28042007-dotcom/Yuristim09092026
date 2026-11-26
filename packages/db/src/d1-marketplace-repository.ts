import type {
  MarketplaceAcceptResult,
  MarketplaceDraftRow,
  MarketplaceLawyerAcceptanceRow,
  MarketplacePostRow,
  MarketplaceRepository,
  MarketplaceReviewRow,
  MarketplaceSelectionResult,
} from './marketplace-repository.js';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1MarketplaceBinding {
  prepare(sql: string): Statement;
}
function required<T>(row: T | null): T {
  if (row === null) throw new Error('Marketplace row missing');
  return row;
}
function domainFail(code: string): never {
  throw Object.assign(new Error(`Marketplace operation failed (${code})`), {
    databaseCode: code,
    databaseMessage: code,
  });
}
function opaque(prefix: 'mp' | 'ma'): string {
  return `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const postSelect = `SELECT p.id,p.public_id public_identifier,p.user_id,
  coalesce(p.specialization_id,'') specialization_id,coalesce(s.code,'') specialization_code,
  coalesce(s.name_uz,'') specialization_name_uz,coalesce(s.name_ru,'') specialization_name_ru,
  coalesce(s.name_en,'') specialization_name_en,coalesce(p.description,'') description,
  p.region,p.additional_details,p.status,p.max_acceptances,
  (SELECT count(*) FROM marketplace_acceptances a WHERE a.marketplace_post_id=p.id) acceptance_count,
  p.selected_acceptance_id,p.channel_message_id telegram_channel_message_id,
  p.created_at,p.updated_at,p.selected_at,p.cancelled_at,p.expires_at
  FROM marketplace_posts p LEFT JOIN specializations s ON s.id=p.specialization_id`;
const draftSelect = `SELECT p.user_id,s.code specialization_code,p.description,p.region,
  p.additional_details,p.draft_step step,p.updated_at,p.language
  FROM marketplace_posts p LEFT JOIN specializations s ON s.id=p.specialization_id`;

export class D1MarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly db: D1MarketplaceBinding) {}

  async expirePosts(now: Date): Promise<number> {
    const result = await this.db
      .prepare(
        "UPDATE marketplace_posts SET status='expired' WHERE status='open' AND expires_at IS NOT NULL AND expires_at<=?",
      )
      .bind(now.toISOString())
      .run();
    return result.meta.changes;
  }
  getDraft(userId: string): Promise<MarketplaceDraftRow | null> {
    return this.db
      .prepare(`${draftSelect} WHERE p.user_id=? AND p.status='draft' LIMIT 1`)
      .bind(userId)
      .first<MarketplaceDraftRow>();
  }
  async saveDraft(input: Omit<MarketplaceDraftRow, 'updated_at'>): Promise<MarketplaceDraftRow> {
    let draft = await this.getDraft(input.user_id);
    if (!draft) {
      try {
        await this.db
          .prepare(
            `INSERT INTO marketplace_posts(id,public_id,user_id,idempotency_key,language)
          VALUES(?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            opaque('mp'),
            input.user_id,
            `draft:${input.user_id}`,
            input.language,
          )
          .run();
      } catch (error) {
        if (!(error instanceof Error) || !/UNIQUE/i.test(error.message)) throw error;
      }
      draft = await this.getDraft(input.user_id);
    }
    if (!draft) throw new Error('Marketplace draft was not created');
    let specializationId: string | null = null;
    if (input.specialization_code) {
      const specialization = await this.db
        .prepare('SELECT id FROM specializations WHERE code=? AND active=1')
        .bind(input.specialization_code)
        .first<{ id: string }>();
      if (!specialization) domainFail('INVALID_SPECIALIZATION');
      specializationId = specialization.id;
    }
    await this.db
      .prepare(
        `UPDATE marketplace_posts SET specialization_id=?,description=?,region=?,
      additional_details=?,draft_step=?,language=? WHERE user_id=? AND status='draft'`,
      )
      .bind(
        specializationId,
        input.description,
        input.region,
        input.additional_details,
        input.step,
        input.language,
        input.user_id,
      )
      .run();
    return required(await this.getDraft(input.user_id));
  }
  async deleteDraft(userId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM marketplace_posts WHERE user_id=? AND status='draft'")
      .bind(userId)
      .run();
  }
  async createPost(
    input: Parameters<MarketplaceRepository['createPost']>[0],
  ): Promise<MarketplacePostRow> {
    const existing = await this.db
      .prepare('SELECT id FROM marketplace_posts WHERE user_id=? AND idempotency_key=?')
      .bind(input.userId, input.idempotencyKey)
      .first<{ id: string }>();
    if (existing) return this.requirePost(existing.id);
    const spec = await this.db
      .prepare('SELECT id FROM specializations WHERE code=? AND active=1')
      .bind(input.specializationCode)
      .first<{ id: string }>();
    if (!spec) domainFail('INVALID_SPECIALIZATION');
    const now = input.now.toISOString();
    const expiry = (input.expiresAt ?? new Date(input.now.getTime() + 14 * 86400000)).toISOString();
    const draft = await this.db
      .prepare("SELECT id FROM marketplace_posts WHERE user_id=? AND status='draft'")
      .bind(input.userId)
      .first<{ id: string }>();
    try {
      let id: string;
      if (draft) {
        id = draft.id;
        await this.db
          .prepare(
            `UPDATE marketplace_posts SET specialization_id=?,description=?,region=?,
          additional_details=?,language=?,status='open',draft_step='complete',publish_status='pending',
          idempotency_key=?,expires_at=? WHERE id=? AND user_id=? AND status='draft'`,
          )
          .bind(
            spec.id,
            input.description.trim(),
            input.region?.trim() || null,
            input.additionalDetails?.trim() || null,
            input.language,
            input.idempotencyKey,
            expiry,
            id,
            input.userId,
          )
          .run();
      } else {
        id = crypto.randomUUID();
        await this.db
          .prepare(
            `INSERT INTO marketplace_posts(id,public_id,user_id,specialization_id,
          description,region,additional_details,language,status,draft_step,publish_status,
          idempotency_key,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            opaque('mp'),
            input.userId,
            spec.id,
            input.description.trim(),
            input.region?.trim() || null,
            input.additionalDetails?.trim() || null,
            input.language,
            'open',
            'complete',
            'pending',
            input.idempotencyKey,
            expiry,
            now,
          )
          .run();
      }
      return this.requirePost(id);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        const raced = await this.db
          .prepare('SELECT id FROM marketplace_posts WHERE user_id=? AND idempotency_key=?')
          .bind(input.userId, input.idempotencyKey)
          .first<{ id: string }>();
        if (raced) return this.requirePost(raced.id);
      }
      throw error;
    }
  }
  async listOwnedPosts(userId: string): Promise<MarketplacePostRow[]> {
    return (
      await this.db
        .prepare(`${postSelect} WHERE p.user_id=? AND p.status<>'draft' ORDER BY p.created_at DESC`)
        .bind(userId)
        .all<MarketplacePostRow>()
    ).results;
  }
  findOwnedPost(postId: string, userId: string): Promise<MarketplacePostRow | null> {
    return this.db
      .prepare(`${postSelect} WHERE p.id=? AND p.user_id=?`)
      .bind(postId, userId)
      .first<MarketplacePostRow>();
  }
  findPublicPost(publicIdentifier: string): Promise<MarketplacePostRow | null> {
    return this.db
      .prepare(`${postSelect} WHERE p.public_id=? AND p.status<>'draft'`)
      .bind(publicIdentifier)
      .first<MarketplacePostRow>();
  }
  async setChannelMessage(postId: string, messageId: number): Promise<void> {
    if (!Number.isSafeInteger(messageId) || messageId <= 0)
      throw new RangeError('Invalid channel message');
    await this.db
      .prepare(
        `UPDATE marketplace_posts SET channel_message_id=coalesce(channel_message_id,?),
      publish_status='published',published_at=coalesce(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      publish_attempts=publish_attempts+CASE WHEN channel_message_id IS NULL THEN 1 ELSE 0 END
      WHERE id=? AND status<>'draft'`,
      )
      .bind(messageId, postId)
      .run();
  }
  async recordPublicationFailure(postId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE marketplace_posts SET publish_status='failed',publish_attempts=publish_attempts+1
      WHERE id=? AND status<>'draft' AND publish_attempts<100 AND channel_message_id IS NULL`,
      )
      .bind(postId)
      .run();
  }

  async acceptPost(
    publicIdentifier: string,
    userId: string,
    now: Date,
  ): Promise<MarketplaceAcceptResult> {
    const post = await this.findPublicPost(publicIdentifier);
    if (!post) domainFail('MARKETPLACE_POST_NOT_FOUND');
    const lawyer = await this.db
      .prepare('SELECT id FROM lawyer_profiles WHERE user_id=?')
      .bind(userId)
      .first<{ id: string }>();
    if (!lawyer) domainFail('LAWYER_NOT_VERIFIED');
    const existing = await this.db
      .prepare(
        `SELECT public_id,ledger_transaction_id FROM marketplace_acceptances
      WHERE marketplace_post_id=? AND lawyer_id=?`,
      )
      .bind(post.id, lawyer.id)
      .first<{ public_id: string; ledger_transaction_id: string }>();
    if (existing)
      return {
        acceptanceId: existing.public_id,
        postId: post.id,
        ledgerTransactionId: existing.ledger_transaction_id,
        duplicate: true,
      };
    const acceptanceId = opaque('ma');
    const ledgerId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `INSERT INTO marketplace_acceptances(id,public_id,marketplace_post_id,
        lawyer_id,ledger_transaction_id,accepted_at) VALUES(?,?,?,?,?,?)`,
        )
        .bind(crypto.randomUUID(), acceptanceId, post.id, lawyer.id, ledgerId, now.toISOString())
        .run();
      return { acceptanceId, postId: post.id, ledgerTransactionId: ledgerId, duplicate: false };
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT public_id,ledger_transaction_id FROM marketplace_acceptances
        WHERE marketplace_post_id=? AND lawyer_id=?`,
        )
        .bind(post.id, lawyer.id)
        .first<{ public_id: string; ledger_transaction_id: string }>();
      if (raced)
        return {
          acceptanceId: raced.public_id,
          postId: post.id,
          ledgerTransactionId: raced.ledger_transaction_id,
          duplicate: true,
        };
      if (error instanceof Error) {
        if (/capacity/i.test(error.message)) domainFail('MARKETPLACE_CAPACITY_FULL');
        if (/balance|accept bucket/i.test(error.message)) domainFail('INSUFFICIENT_ACCEPT_BALANCE');
        if (/closed/i.test(error.message)) domainFail('MARKETPLACE_POST_CLOSED');
        if (/forbidden/i.test(error.message)) domainFail('LAWYER_NOT_VERIFIED');
      }
      throw error;
    }
  }

  async listPostAcceptances(
    postId: string,
    ownerUserId: string,
  ): Promise<MarketplaceLawyerAcceptanceRow[]> {
    if (!(await this.findOwnedPost(postId, ownerUserId))) return [];
    const rows = (
      await this.db
        .prepare(
          `SELECT a.public_id id,a.marketplace_post_id,a.lawyer_id,a.status,
      a.accepted_at,a.selected_at,coalesce(u.full_name,'Verified lawyer') full_name,u.duid,
      l.public_slug,l.region,l.rating_average_hundredths,l.rating_count
      FROM marketplace_acceptances a JOIN lawyer_profiles l ON l.id=a.lawyer_id
      JOIN users u ON u.id=l.user_id WHERE a.marketplace_post_id=? ORDER BY a.accepted_at`,
        )
        .bind(postId)
        .all<
          Omit<MarketplaceLawyerAcceptanceRow, 'rating_average' | 'specializations'> & {
            rating_average_hundredths: number;
          }
        >()
    ).results;
    const result: MarketplaceLawyerAcceptanceRow[] = [];
    for (const row of rows) {
      const specializations = (
        await this.db
          .prepare(
            `SELECT s.code,s.name_uz,s.name_ru,s.name_en
        FROM lawyer_specializations ls JOIN specializations s ON s.id=ls.specialization_id
        WHERE ls.lawyer_id=? ORDER BY s.code`,
          )
          .bind(row.lawyer_id)
          .all<MarketplaceLawyerAcceptanceRow['specializations'][number]>()
      ).results;
      const { rating_average_hundredths, ...rest } = row;
      result.push({ ...rest, rating_average: rating_average_hundredths / 100, specializations });
    }
    return result;
  }

  async listLawyerAcceptances(userId: string): Promise<MarketplacePostRow[]> {
    return (
      await this.db
        .prepare(
          `${postSelect} JOIN marketplace_acceptances a ON a.marketplace_post_id=p.id
      JOIN lawyer_profiles l ON l.id=a.lawyer_id WHERE l.user_id=? ORDER BY a.accepted_at DESC`,
        )
        .bind(userId)
        .all<MarketplacePostRow>()
    ).results;
  }

  async selectLawyer(
    input: Parameters<MarketplaceRepository['selectLawyer']>[0],
  ): Promise<MarketplaceSelectionResult> {
    const acceptance = await this.db
      .prepare(
        `SELECT a.id,a.public_id,a.lawyer_id,a.marketplace_post_id
      FROM marketplace_acceptances a JOIN marketplace_posts p ON p.id=a.marketplace_post_id
      WHERE p.id=? AND p.user_id=? AND a.public_id=?`,
      )
      .bind(input.postId, input.userId, input.acceptanceId)
      .first<{ id: string; public_id: string; lawyer_id: string; marketplace_post_id: string }>();
    if (!acceptance) domainFail('MARKETPLACE_ACCEPTANCE_NOT_FOUND');
    const now = input.now.toISOString();
    const updated = await this.db
      .prepare(
        `UPDATE marketplace_posts SET status='selected',
      selected_acceptance_id=?,selected_at=? WHERE id=? AND user_id=? AND status='open' RETURNING id`,
      )
      .bind(acceptance.id, now, input.postId, input.userId)
      .first<{ id: string }>();
    if (updated)
      return {
        postId: updated.id,
        acceptanceId: acceptance.public_id,
        lawyerId: acceptance.lawyer_id,
        duplicate: false,
      };
    const post = await this.findOwnedPost(input.postId, input.userId);
    if (post?.status === 'selected' && post.selected_acceptance_id === acceptance.id)
      return {
        postId: post.id,
        acceptanceId: acceptance.public_id,
        lawyerId: acceptance.lawyer_id,
        duplicate: true,
      };
    domainFail('MARKETPLACE_POST_CLOSED');
  }
  async cancelPost(postId: string, userId: string, now: Date): Promise<MarketplacePostRow> {
    const post = await this.findOwnedPost(postId, userId);
    if (!post) domainFail('MARKETPLACE_POST_NOT_FOUND');
    if (post.status === 'cancelled') return post;
    if (post.status !== 'open' && post.status !== 'draft') domainFail('MARKETPLACE_POST_CLOSED');
    const updated = await this.db
      .prepare(
        `UPDATE marketplace_posts SET status='cancelled',cancelled_at=?,
      selected_acceptance_id=NULL WHERE id=? AND user_id=? AND status IN ('draft','open') RETURNING id`,
      )
      .bind(now.toISOString(), postId, userId)
      .first<{ id: string }>();
    if (!updated) domainFail('MARKETPLACE_POST_CLOSED');
    return this.requirePost(postId);
  }
  async createReview(
    input: Parameters<MarketplaceRepository['createReview']>[0],
  ): Promise<MarketplaceReviewRow> {
    const post = await this.findOwnedPost(input.postId, input.userId);
    if (!post) domainFail('MARKETPLACE_POST_NOT_FOUND');
    const existing = await this.db
      .prepare('SELECT * FROM marketplace_reviews WHERE marketplace_post_id=?')
      .bind(input.postId)
      .first<MarketplaceReviewRow>();
    if (existing) return existing;
    const row = await this.db
      .prepare(
        `INSERT INTO marketplace_reviews(id,marketplace_post_id,user_id,
      lawyer_id,rating,comment,created_at)
      SELECT ?,p.id,p.user_id,a.lawyer_id,?,?,? FROM marketplace_posts p
      JOIN marketplace_acceptances a ON a.id=p.selected_acceptance_id
      WHERE p.id=? AND p.user_id=? AND p.status='selected' RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.rating,
        input.comment,
        input.now.toISOString(),
        input.postId,
        input.userId,
      )
      .first<MarketplaceReviewRow>();
    if (!row) domainFail('REVIEW_NOT_ALLOWED');
    return row;
  }
  async getOwnerTelegramId(postId: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        `SELECT u.telegram_user_id id FROM marketplace_posts p
      JOIN users u ON u.id=p.user_id WHERE p.id=?`,
      )
      .bind(postId)
      .first<{ id: number }>();
    return row?.id ?? null;
  }
  async getLawyerTelegramId(lawyerId: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        `SELECT u.telegram_user_id id FROM lawyer_profiles l
      JOIN users u ON u.id=l.user_id WHERE l.id=?`,
      )
      .bind(lawyerId)
      .first<{ id: number }>();
    return row?.id ?? null;
  }
  async getAcceptedLawyerTelegramIds(postId: string): Promise<number[]> {
    return (
      await this.db
        .prepare(
          `SELECT u.telegram_user_id id FROM marketplace_acceptances a
      JOIN lawyer_profiles l ON l.id=a.lawyer_id JOIN users u ON u.id=l.user_id
      WHERE a.marketplace_post_id=?`,
        )
        .bind(postId)
        .all<{ id: number }>()
    ).results.map((x) => x.id);
  }
  private async requirePost(id: string): Promise<MarketplacePostRow> {
    return required(
      await this.db.prepare(`${postSelect} WHERE p.id=?`).bind(id).first<MarketplacePostRow>(),
    );
  }
}
