export const PRIVACY_REQUEST_TYPES = [
  "access",
  "rectification",
  "erasure",
  "restriction",
  "objection",
  "portability",
  "other",
] as const;

export const PRIVACY_REQUEST_STATUSES = [
  "received",
  "verifying",
  "in_progress",
  "completed",
  "declined",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];
export type VerificationStatus = "pending" | "verified";

export interface PrivacyRequestRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  verification_status: VerificationStatus;
  received_on: string;
  due_on: string | null;
  closed_at: string | null;
  internal_notes: string;
  created_at: string;
  updated_at: string;
}
