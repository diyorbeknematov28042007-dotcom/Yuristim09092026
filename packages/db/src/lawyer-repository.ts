import type { Database, Json } from './database.types.js';

export type LawyerProfileRow = Database['public']['Tables']['lawyer_profiles']['Row'];
export type SpecializationRow = Database['public']['Tables']['specializations']['Row'];
export type LawyerVerificationRow = Database['public']['Tables']['lawyer_verifications']['Row'];
export type VerificationDocumentRow = Database['public']['Tables']['verification_documents']['Row'];
export type AdminAccountRow = Database['public']['Tables']['admin_accounts']['Row'];
export type AdminSessionRow = Database['public']['Tables']['admin_sessions']['Row'];
export type AuditLogRow = Database['public']['Tables']['audit_logs']['Row'];

export interface LawyerProfileRecord {
  profile: LawyerProfileRow;
  user: Database['public']['Tables']['users']['Row'];
  specializations: SpecializationRow[];
}

export interface LawyerSearchInput {
  region?: string | undefined;
  specialization?: string | undefined;
  minExperience?: number | undefined;
  sort: 'rating' | 'experience' | 'newest';
  page: number;
  limit: number;
}

export interface LawyerSearchResult {
  items: LawyerProfileRecord[];
  total: number;
}

export interface VerificationListInput {
  status?: string | undefined;
  page: number;
  limit: number;
}

export interface VerificationRecord {
  verification: LawyerVerificationRow;
  profile: LawyerProfileRecord;
  documents: VerificationDocumentRow[];
}

export interface FileUploadInput {
  bytes: Uint8Array;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  kind: 'profile_image' | 'verification_document';
  originalFilename: string;
  storagePath: string;
  verificationId: string;
}

export interface LawyerRepository {
  findProfileByUserId(userId: string): Promise<LawyerProfileRecord | null>;
  findApprovedProfileByDuid(duid: string): Promise<LawyerProfileRecord | null>;
  createProfile(userId: string, publicSlug: string): Promise<LawyerProfileRecord>;
  listSpecializations(): Promise<SpecializationRow[]>;
  findSpecializationsByCodes(codes: string[]): Promise<SpecializationRow[]>;
  searchApproved(input: LawyerSearchInput): Promise<LawyerSearchResult>;

  findLatestVerification(lawyerId: string): Promise<LawyerVerificationRow | null>;
  findOpenVerification(lawyerId: string): Promise<LawyerVerificationRow | null>;
  findVerificationById(id: string): Promise<LawyerVerificationRow | null>;
  createVerification(input: {
    lawyerId: string;
    type: 'initial' | 'profile_update';
    submittedData: Json;
    status?: 'draft' | 'pending_review';
    now: Date;
  }): Promise<LawyerVerificationRow>;
  updateDraft(id: string, submittedData: Json): Promise<LawyerVerificationRow>;
  submitDraft(id: string, submittedData: Json, now: Date): Promise<LawyerVerificationRow | null>;
  cancelDraft(id: string): Promise<void>;
  addVerificationDocument(input: FileUploadInput): Promise<VerificationDocumentRow>;
  listVerificationDocuments(verificationId: string): Promise<VerificationDocumentRow[]>;
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;

  findAdminByUsername(username: string): Promise<AdminAccountRow | null>;
  findAdminById(id: string): Promise<AdminAccountRow | null>;
  createAdmin(username: string, passwordHash: string): Promise<AdminAccountRow>;
  updateAdminLoginState(
    id: string,
    update: Database['public']['Tables']['admin_accounts']['Update'],
  ): Promise<AdminAccountRow>;
  createAdminSession(input: {
    adminId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<AdminSessionRow>;
  findAdminSessionByTokenHash(tokenHash: string): Promise<AdminSessionRow | null>;
  touchAdminSession(id: string, now: Date): Promise<void>;
  revokeAdminSession(id: string, now: Date): Promise<void>;
  logAdminLogin(input: {
    adminId: string | null;
    username: string;
    success: boolean;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<void>;
  listVerifications(
    input: VerificationListInput,
  ): Promise<{ items: VerificationRecord[]; total: number }>;
  getVerificationDetail(id: string): Promise<VerificationRecord | null>;
  reviewVerification(input: {
    verificationId: string;
    adminId: string;
    decision: 'approved' | 'rejected';
    rejectReason: string | null;
  }): Promise<'reviewed' | 'not_found' | 'conflict'>;
}
