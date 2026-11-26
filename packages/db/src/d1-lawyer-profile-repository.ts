import type { Json } from './database.types.js';
import type {
  LawyerProfileRecord,
  LawyerProfileRow,
  LawyerRepository,
  LawyerRoutingProfile,
  LawyerSearchInput,
  LawyerSearchResult,
  LawyerVerificationRow,
  SpecializationRow,
} from './lawyer-repository.js';
import type { UserRow } from './repository.js';

type Value = string | number | null;
interface Statement {
  bind(...values: Value[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1LawyerProfileBinding {
  prepare(sql: string): Statement;
}
type ProfileMethods = Pick<
  LawyerRepository,
  | 'findProfileByUserId'
  | 'findRoutingProfileByUserId'
  | 'findApprovedProfileByDuid'
  | 'createProfile'
  | 'listSpecializations'
  | 'findSpecializationsByCodes'
  | 'searchApproved'
  | 'findLatestVerification'
  | 'findOpenVerification'
  | 'findVerificationById'
  | 'createVerification'
  | 'updateDraft'
  | 'submitDraft'
  | 'cancelDraft'
>;

export interface D1RawLawyerProfile extends Omit<
  LawyerProfileRow,
  'consultation_price' | 'rating_average'
> {
  consultation_price_minor: number | null;
  rating_average_hundredths: number;
}
export interface D1RawLawyerVerification extends Omit<LawyerVerificationRow, 'submitted_data'> {
  submitted_data: string;
}
interface RawSpecialization extends Omit<SpecializationRow, 'active'> {
  active: number;
}
function profile(row: D1RawLawyerProfile): LawyerProfileRow {
  const { consultation_price_minor, rating_average_hundredths, ...rest } = row;
  return {
    ...rest,
    consultation_price: consultation_price_minor === null ? null : consultation_price_minor / 100,
    rating_average: rating_average_hundredths / 100,
  };
}
export function fromD1LawyerVerification(row: D1RawLawyerVerification): LawyerVerificationRow {
  return { ...row, submitted_data: JSON.parse(row.submitted_data) as Json };
}
function specialization(row: RawSpecialization): SpecializationRow {
  return { ...row, active: row.active === 1 };
}
function required<T>(row: T | null): T {
  if (row === null) throw new Error('D1 row missing');
  return row;
}
function object(value: Json): string {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('Verification draft must be an object');
  return JSON.stringify(value);
}

export class D1LawyerProfileRepository implements ProfileMethods {
  constructor(private readonly db: D1LawyerProfileBinding) {}

  protected async hydrateMany(rows: D1RawLawyerProfile[]): Promise<LawyerProfileRecord[]> {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const lawyerIds = rows.map((row) => row.id);
    const [users, specs] = await Promise.all([
      this.db
        .prepare(`SELECT * FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`)
        .bind(...userIds)
        .all<UserRow>(),
      this.db
        .prepare(
          `SELECT ls.lawyer_id,s.* FROM specializations s JOIN lawyer_specializations ls
          ON ls.specialization_id=s.id WHERE ls.lawyer_id IN (${lawyerIds.map(() => '?').join(',')}) ORDER BY s.code`,
        )
        .bind(...lawyerIds)
        .all<RawSpecialization & { lawyer_id: string }>(),
    ]);
    const byUser = new Map(users.results.map((user) => [user.id, user]));
    const byLawyer = new Map<string, SpecializationRow[]>();
    for (const item of specs.results) {
      const { lawyer_id, ...row } = item;
      const current = byLawyer.get(lawyer_id) ?? [];
      current.push(specialization(row));
      byLawyer.set(lawyer_id, current);
    }
    return rows.map((row) => ({
      profile: profile(row),
      user: required(byUser.get(row.user_id) ?? null),
      specializations: byLawyer.get(row.id) ?? [],
    }));
  }
  async findProfileByUserId(userId: string): Promise<LawyerProfileRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM lawyer_profiles WHERE user_id=?')
      .bind(userId)
      .first<D1RawLawyerProfile>();
    return row ? (await this.hydrateMany([row]))[0]! : null;
  }
  async findRoutingProfileByUserId(userId: string): Promise<LawyerRoutingProfile | null> {
    const row = await this.db
      .prepare('SELECT id,verification_status FROM lawyer_profiles WHERE user_id=?')
      .bind(userId)
      .first<{ id: string; verification_status: LawyerProfileRow['verification_status'] }>();
    return row ? { id: row.id, verificationStatus: row.verification_status } : null;
  }
  async findApprovedProfileByDuid(duid: string): Promise<LawyerProfileRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM lawyer_profiles WHERE public_slug=? AND verification_status='approved'",
      )
      .bind(duid)
      .first<D1RawLawyerProfile>();
    return row ? (await this.hydrateMany([row]))[0]! : null;
  }
  async createProfile(userId: string, publicSlug: string): Promise<LawyerProfileRecord> {
    await this.db
      .prepare(
        `INSERT INTO lawyer_profiles(id,user_id,public_slug)
        VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), userId, publicSlug)
      .run();
    return required(await this.findProfileByUserId(userId));
  }
  async listSpecializations(): Promise<SpecializationRow[]> {
    const rows = await this.db
      .prepare('SELECT * FROM specializations WHERE active=1 ORDER BY code')
      .all<RawSpecialization>();
    return rows.results.map(specialization);
  }
  async findSpecializationsByCodes(codes: string[]): Promise<SpecializationRow[]> {
    if (!codes.length) return [];
    if (codes.length > 24) throw new Error('Too many specializations');
    const rows = await this.db
      .prepare(
        `SELECT * FROM specializations WHERE active=1 AND code IN (${codes.map(() => '?').join(',')})`,
      )
      .bind(...codes)
      .all<RawSpecialization>();
    return rows.results.map(specialization);
  }
  async searchApproved(input: LawyerSearchInput): Promise<LawyerSearchResult> {
    if (
      !Number.isInteger(input.page) ||
      input.page < 1 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.minExperience !== undefined &&
        (!Number.isInteger(input.minExperience) ||
          input.minExperience < 0 ||
          input.minExperience > 70))
    )
      throw new Error('Invalid lawyer search');
    const filters = ["l.verification_status='approved'"];
    const params: Value[] = [];
    if (input.region) {
      filters.push('l.region=?');
      params.push(input.region);
    }
    if (input.minExperience !== undefined) {
      filters.push('l.experience_years>=?');
      params.push(input.minExperience);
    }
    if (input.specialization) {
      filters.push(`EXISTS (SELECT 1 FROM lawyer_specializations ls
        JOIN specializations s ON s.id=ls.specialization_id WHERE ls.lawyer_id=l.id AND s.code=? AND s.active=1)`);
      params.push(input.specialization);
    }
    const where = filters.join(' AND ');
    const sort = {
      rating: 'l.rating_average_hundredths',
      experience: 'l.experience_years',
      newest: 'l.verified_at',
    }[input.sort];
    if (!sort) throw new Error('Invalid lawyer sort');
    const [count, page] = await Promise.all([
      this.db
        .prepare(`SELECT count(*) AS total FROM lawyer_profiles l WHERE ${where}`)
        .bind(...params)
        .first<{ total: number }>(),
      this.db
        .prepare(
          `SELECT l.* FROM lawyer_profiles l WHERE ${where}
          ORDER BY ${sort} DESC,l.id LIMIT ? OFFSET ?`,
        )
        .bind(...params, input.limit, (input.page - 1) * input.limit)
        .all<D1RawLawyerProfile>(),
    ]);
    return { items: await this.hydrateMany(page.results), total: count?.total ?? 0 };
  }
  private async findVerification(
    sql: string,
    value: string,
  ): Promise<LawyerVerificationRow | null> {
    const row = await this.db.prepare(sql).bind(value).first<D1RawLawyerVerification>();
    return row ? fromD1LawyerVerification(row) : null;
  }
  findLatestVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    return this.findVerification(
      'SELECT * FROM lawyer_verifications WHERE lawyer_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
      lawyerId,
    );
  }
  findOpenVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    return this.findVerification(
      "SELECT * FROM lawyer_verifications WHERE lawyer_id=? AND status IN ('draft','submitted','pending_review') ORDER BY created_at DESC,id DESC LIMIT 1",
      lawyerId,
    );
  }
  findVerificationById(id: string): Promise<LawyerVerificationRow | null> {
    return this.findVerification('SELECT * FROM lawyer_verifications WHERE id=?', id);
  }
  async createVerification(input: {
    lawyerId: string;
    type: 'initial' | 'profile_update';
    submittedData: Json;
    status?: 'draft' | 'pending_review';
    now: Date;
  }): Promise<LawyerVerificationRow> {
    const row = await this.db
      .prepare(
        `INSERT INTO lawyer_verifications(id,lawyer_id,type,status,submitted_data,submitted_at)
        VALUES(?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.lawyerId,
        input.type,
        input.status ?? 'draft',
        object(input.submittedData),
        input.status === 'pending_review' ? input.now.toISOString() : null,
      )
      .first<D1RawLawyerVerification>();
    return fromD1LawyerVerification(required(row));
  }
  async updateDraft(id: string, submittedData: Json): Promise<LawyerVerificationRow> {
    const row = await this.db
      .prepare(
        "UPDATE lawyer_verifications SET submitted_data=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='draft' RETURNING *",
      )
      .bind(object(submittedData), id)
      .first<D1RawLawyerVerification>();
    return fromD1LawyerVerification(required(row));
  }
  async submitDraft(
    id: string,
    submittedData: Json,
    now: Date,
  ): Promise<LawyerVerificationRow | null> {
    const row = await this.db
      .prepare(
        "UPDATE lawyer_verifications SET status='pending_review',submitted_data=?,submitted_at=?,updated_at=? WHERE id=? AND status='draft' RETURNING *",
      )
      .bind(object(submittedData), now.toISOString(), now.toISOString(), id)
      .first<D1RawLawyerVerification>();
    return row ? fromD1LawyerVerification(row) : null;
  }
  async cancelDraft(id: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM lawyer_verifications WHERE id=? AND status='draft'")
      .bind(id)
      .run();
  }
}
