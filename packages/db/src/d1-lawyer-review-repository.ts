type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
}
export interface D1LawyerReviewBinding {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ results: unknown[] }>>;
}
interface ReviewRow {
  lawyer_id: string;
  type: 'initial' | 'profile_update';
  status: string;
  submitted_data: string;
}
interface ApprovedProfile {
  fullName: string;
  region: string;
  experienceYears: number;
  bio: string;
  consultationPriceMinor: number | null;
  profileImagePath: string;
  specializationCodes: string[];
}
function invalid(): never {
  throw Object.assign(new Error('Invalid lawyer verification review'), { databaseCode: '22023' });
}
function minor(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)
    invalid();
  if (value > 0 && value < 0.000001) return 0;
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) invalid();
  const fraction = match[2] ?? '';
  const rounded =
    BigInt(match[1]!) * 100n +
    BigInt(fraction.slice(0, 2).padEnd(2, '0')) +
    (fraction.length > 2 && fraction[2]! >= '5' ? 1n : 0n);
  if (rounded > 100_000_000_000n) invalid();
  return Number(rounded);
}
function profile(raw: string): ApprovedProfile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (
    typeof data.fullName !== 'string' ||
    data.fullName.trim().length < 2 ||
    data.fullName.length > 160 ||
    typeof data.region !== 'string' ||
    data.region.trim().length < 2 ||
    data.region.length > 120 ||
    !Number.isInteger(data.experienceYears) ||
    (data.experienceYears as number) < 0 ||
    (data.experienceYears as number) > 70 ||
    typeof data.bio !== 'string' ||
    data.bio.length < 20 ||
    data.bio.length > 1000 ||
    typeof data.profileImagePath !== 'string' ||
    !data.profileImagePath ||
    data.profileImagePath.length > 512 ||
    !Array.isArray(data.specializationCodes) ||
    data.specializationCodes.length < 1 ||
    data.specializationCodes.length > 24 ||
    data.specializationCodes.some(
      (code) => typeof code !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(code),
    )
  )
    invalid();
  return {
    fullName: data.fullName as string,
    region: data.region as string,
    experienceYears: data.experienceYears as number,
    bio: data.bio as string,
    consultationPriceMinor: minor(data.consultationPrice),
    profileImagePath: data.profileImagePath as string,
    specializationCodes: [...new Set(data.specializationCodes as string[])],
  };
}

export class D1LawyerReviewRepository {
  constructor(
    private readonly db: D1LawyerReviewBinding,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reviewVerification(input: {
    verificationId: string;
    adminId: string;
    decision: 'approved' | 'rejected';
    rejectReason: string | null;
  }): Promise<'reviewed' | 'not_found' | 'conflict'> {
    if (
      !['approved', 'rejected'].includes(input.decision) ||
      (input.decision === 'rejected' &&
        (!input.rejectReason?.trim() || input.rejectReason.trim().length < 3))
    )
      invalid();
    const admin = await this.db
      .prepare("SELECT id FROM admin_accounts WHERE id=? AND status='active'")
      .bind(input.adminId)
      .first<{ id: string }>();
    if (!admin) throw new Error('Admin access denied');
    const review = await this.db
      .prepare('SELECT lawyer_id,type,status,submitted_data FROM lawyer_verifications WHERE id=?')
      .bind(input.verificationId)
      .first<ReviewRow>();
    if (!review) return 'not_found';
    if (!['submitted', 'pending_review'].includes(review.status)) return 'conflict';
    const data = input.decision === 'approved' ? profile(review.submitted_data) : null;
    if (data) {
      const known = await this.db
        .prepare(
          `SELECT count(DISTINCT code) AS total FROM specializations
        WHERE active=1 AND code IN (${data.specializationCodes.map(() => '?').join(',')})`,
        )
        .bind(...data.specializationCodes)
        .first<{ total: number }>();
      if (known?.total !== data.specializationCodes.length) invalid();
    }
    const claim = crypto.randomUUID();
    const time = this.now().toISOString();
    // A failed statement rolls back the entire D1.batch. Every subsequent write
    // checks the new claim, so a competing reviewer cannot mutate the winner's row.
    const statements: Statement[] = [
      this.db
        .prepare(
          `UPDATE lawyer_verifications SET status=?,reject_reason=?,reviewed_by=?,
        reviewed_at=?,review_claim_id=?,updated_at=? WHERE id=? AND status IN ('submitted','pending_review')
        AND EXISTS(SELECT 1 FROM admin_accounts WHERE id=? AND status='active') RETURNING id`,
        )
        .bind(
          input.decision,
          input.decision === 'rejected' ? (input.rejectReason?.trim() ?? null) : null,
          input.adminId,
          time,
          claim,
          time,
          input.verificationId,
          input.adminId,
        ),
      this.db
        .prepare(
          `UPDATE lawyer_profiles SET verification_status='approved',region=?,
        experience_years=?,bio=?,consultation_price_minor=?,profile_image_path=?,verified_at=?,
        updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM lawyer_verifications
        WHERE id=? AND review_claim_id=? AND status='approved')`,
        )
        .bind(
          data?.region ?? null,
          data?.experienceYears ?? null,
          data?.bio ?? null,
          data?.consultationPriceMinor ?? null,
          data?.profileImagePath ?? null,
          time,
          time,
          review.lawyer_id,
          input.verificationId,
          claim,
        ),
      this.db
        .prepare(
          `UPDATE lawyer_profiles SET verification_status='rejected',updated_at=?
        WHERE id=? AND EXISTS(SELECT 1 FROM lawyer_verifications WHERE id=?
          AND review_claim_id=? AND status='rejected' AND type='initial')`,
        )
        .bind(time, review.lawyer_id, input.verificationId, claim),
      this.db
        .prepare(
          `UPDATE users SET full_name=?,onboarding_role='lawyer',updated_at=?
        WHERE id=(SELECT user_id FROM lawyer_profiles WHERE id=?)
          AND EXISTS(SELECT 1 FROM lawyer_verifications WHERE id=? AND review_claim_id=?
          AND status='approved')`,
        )
        .bind(data?.fullName ?? null, time, review.lawyer_id, input.verificationId, claim),
      this.db
        .prepare(
          `DELETE FROM lawyer_specializations WHERE lawyer_id=?
        AND EXISTS(SELECT 1 FROM lawyer_verifications WHERE id=? AND review_claim_id=?
          AND status='approved')`,
        )
        .bind(review.lawyer_id, input.verificationId, claim),
      this.db
        .prepare(
          `INSERT INTO lawyer_specializations(lawyer_id,specialization_id)
        SELECT ?,s.id FROM specializations s JOIN json_each(?) codes ON codes.value=s.code
        WHERE s.active=1 AND EXISTS(SELECT 1 FROM lawyer_verifications WHERE id=?
          AND review_claim_id=? AND status='approved') ON CONFLICT DO NOTHING`,
        )
        .bind(
          review.lawyer_id,
          JSON.stringify(data?.specializationCodes ?? []),
          input.verificationId,
          claim,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_logs(id,actor_type,actor_id,action,entity_type,entity_id,metadata,created_at)
        SELECT ?,'admin',?,'lawyer_verification.'||?,'lawyer_verification',?,
          json_object('lawyerId',?,'type',?),? FROM lawyer_verifications
        WHERE id=? AND review_claim_id=?`,
        )
        .bind(
          crypto.randomUUID(),
          input.adminId,
          input.decision,
          input.verificationId,
          review.lawyer_id,
          review.type,
          time,
          input.verificationId,
          claim,
        ),
    ];
    const results = await this.db.batch(statements);
    return results[0]?.results.length ? 'reviewed' : 'conflict';
  }
}
