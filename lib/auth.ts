/**
 * JWT auth for the HR portal (Phase 1).
 *
 * Production will front this with Auth0 (EU tenant, SSO/MFA) per the spec's
 * tech-stack choice; Phase 1 issues its own HS256 JWTs from
 * POST /api/auth/login so role-based access works end to end.
 *
 * Everything in this module is Edge-runtime safe — it is imported by
 * middleware.ts. Password hashing (bcryptjs) lives in the login route only.
 */

import { SignJWT, jwtVerify } from 'jose';

/** Staff roles from spec section 1. Candidates/new hires are not User accounts. */
export type StaffRole =
  | 'HR_ADMIN'
  | 'RECRUITER'
  | 'HIRING_MANAGER'
  | 'INTERVIEWER'
  | 'FINANCE_APPROVER'
  | 'DPO_AUDITOR';

export const STAFF_ROLES: readonly StaffRole[] = [
  'HR_ADMIN',
  'RECRUITER',
  'HIRING_MANAGER',
  'INTERVIEWER',
  'FINANCE_APPROVER',
  'DPO_AUDITOR',
];

export const AUTH_COOKIE = 'hr_portal_token';
export const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8-hour staff sessions

export interface AuthTokenPayload {
  /** User id (JWT `sub`). */
  sub: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** Identity of the authenticated caller, forwarded by middleware.ts. */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET must be set to a random string of at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signAuthToken(payload: AuthTokenPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS)
    .sign(getSecretKey());
}

/** Returns the decoded payload, or null for any invalid/expired/malformed token. */
export async function verifyAuthToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ['HS256'] });
    const { sub, email, name, role } = payload as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      typeof name !== 'string' ||
      typeof role !== 'string' ||
      !STAFF_ROLES.includes(role as StaffRole)
    ) {
      return null;
    }
    return { sub, email, name, role: role as StaffRole };
  } catch {
    return null;
  }
}

/**
 * Pulls the bearer token from the Authorization header, falling back to the
 * httpOnly cookie set at login.
 */
export function extractToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token.length > 0) return token;
  }

  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [rawName, ...rest] = part.trim().split('=');
      if (rawName === AUTH_COOKIE && rest.length > 0) {
        const value = rest.join('=').trim();
        if (value.length > 0) return value;
      }
    }
  }
  return null;
}

// Header names used by middleware.ts to forward the verified identity to
// route handlers. Values are URI-encoded (header values must be Latin-1).
export const CTX_HEADERS = {
  userId: 'x-user-id',
  email: 'x-user-email',
  name: 'x-user-name',
  role: 'x-user-role',
} as const;

/**
 * Reads the identity injected by middleware. Returns null when the request
 * did not pass through auth middleware (defense in depth — handlers treat
 * that as unauthenticated rather than trusting client-supplied headers).
 */
export function getAuthContext(request: Request): AuthContext | null {
  const userId = request.headers.get(CTX_HEADERS.userId);
  const email = request.headers.get(CTX_HEADERS.email);
  const name = request.headers.get(CTX_HEADERS.name);
  const role = request.headers.get(CTX_HEADERS.role);
  if (!userId || !email || !name || !role || !STAFF_ROLES.includes(role as StaffRole)) {
    return null;
  }
  return {
    userId,
    email: decodeURIComponent(email),
    name: decodeURIComponent(name),
    role: role as StaffRole,
  };
}
