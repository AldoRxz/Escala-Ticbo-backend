export interface RefreshSession {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Set when the token was rotated; null when it was revoked (logout, reuse). */
  replacedById: string | null;
}

export interface NewRefreshSession {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export abstract class SessionRepository {
  abstract create(session: NewRefreshSession): Promise<void>;
  abstract findByTokenHash(tokenHash: string): Promise<RefreshSession | null>;

  /**
   * Atomically retires `currentId` in favor of `next`. Returns false, writing
   * nothing, when `currentId` was no longer active (a concurrent rotation won).
   */
  abstract rotate(currentId: string, next: NewRefreshSession, now: Date): Promise<boolean>;

  abstract revokeFamily(familyId: string, now: Date): Promise<void>;
  abstract revokeAllForUser(userId: string, now: Date): Promise<void>;
}
