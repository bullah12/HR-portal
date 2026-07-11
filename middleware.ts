/**
 * Role-based access control for all /api routes (spec section 1).
 *
 * Default-deny: an API route with no explicit rule is rejected even for
 * authenticated users. On success the verified identity is forwarded to
 * route handlers via x-user-* request headers (client-supplied values for
 * those headers are always stripped first).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  CTX_HEADERS,
  extractToken,
  verifyAuthToken,
  type StaffRole,
} from '@/lib/auth';

const PUBLIC_API_PATHS = new Set<string>(['/api/auth/login']);

/** Roles allowed to create jobs and manage candidate records. */
const RECRUITING_WRITE: StaffRole[] = ['HR_ADMIN', 'RECRUITER'];

interface RouteRule {
  pattern: RegExp;
  /** Allowed roles per HTTP method; a method absent from the map is denied. */
  methods: Partial<Record<string, StaffRole[]>>;
}

const RULES: RouteRule[] = [
  {
    pattern: /^\/api\/jobs$/,
    methods: {
      // Hiring managers may list jobs but only see their own requisitions
      // (filtered in the route handler, per "view own requisitions").
      GET: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER'],
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/candidates$/,
    methods: {
      GET: RECRUITING_WRITE,
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/candidates\/upload$/,
    methods: {
      POST: RECRUITING_WRITE,
    },
  },
];

function deny(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Never trust identity headers supplied by the client.
  const forwardedHeaders = new Headers(request.headers);
  for (const header of Object.values(CTX_HEADERS)) {
    forwardedHeaders.delete(header);
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  }

  const token = extractToken(request);
  if (!token) {
    return deny(401, 'UNAUTHENTICATED', 'Authentication required: provide a bearer token or login cookie.');
  }

  const payload = await verifyAuthToken(token);
  if (!payload) {
    return deny(401, 'INVALID_TOKEN', 'The provided token is invalid or has expired.');
  }

  const rule = RULES.find((candidate) => candidate.pattern.test(pathname));
  if (!rule) {
    return deny(403, 'FORBIDDEN', 'No access rule is defined for this route.');
  }

  const allowedRoles = rule.methods[request.method];
  if (!allowedRoles) {
    return deny(405, 'METHOD_NOT_ALLOWED', `${request.method} is not supported on ${pathname}.`);
  }

  if (!allowedRoles.includes(payload.role)) {
    return deny(403, 'FORBIDDEN', `Role ${payload.role} is not permitted to ${request.method} ${pathname}.`);
  }

  forwardedHeaders.set(CTX_HEADERS.userId, payload.sub);
  forwardedHeaders.set(CTX_HEADERS.email, encodeURIComponent(payload.email));
  forwardedHeaders.set(CTX_HEADERS.name, encodeURIComponent(payload.name));
  forwardedHeaders.set(CTX_HEADERS.role, payload.role);

  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: '/api/:path*',
};
