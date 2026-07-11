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

const PUBLIC_API_PATHS = new Set<string>(['/api/auth/login', '/api/auth/logout']);

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
  {
    pattern: /^\/api\/candidates\/[^/]+\/parse$/,
    methods: {
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/interviews$/,
    methods: {
      // Panel-scoped filtering for HMs/interviewers happens in the handler.
      GET: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER'],
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/interviews\/[^/]+\/cancel$/,
    methods: {
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/offers$/,
    methods: {
      GET: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'FINANCE_APPROVER'],
      POST: RECRUITING_WRITE,
    },
  },
  {
    pattern: /^\/api\/offers\/[^/]+$/,
    methods: {
      GET: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'FINANCE_APPROVER'],
    },
  },
  {
    pattern: /^\/api\/offers\/[^/]+\/pdf$/,
    methods: {
      GET: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'FINANCE_APPROVER'],
    },
  },
];

// Page routes (order matters: more specific patterns first). Unauthenticated
// visitors are redirected to /login; authenticated users without the role
// land on /jobs when they can see it, otherwise /login.
const PAGE_RULES: Array<{ pattern: RegExp; roles: StaffRole[] }> = [
  { pattern: /^\/jobs\/new$/, roles: RECRUITING_WRITE },
  { pattern: /^\/jobs(\/.*)?$/, roles: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER'] },
  { pattern: /^\/candidates(\/.*)?$/, roles: RECRUITING_WRITE },
];

const JOBS_PAGE_ROLES: StaffRole[] = ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER'];

function deny(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

async function handlePageRequest(request: NextRequest, pathname: string): Promise<NextResponse> {
  const rule = PAGE_RULES.find((candidate) => candidate.pattern.test(pathname));
  if (!rule) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);

  const token = extractToken(request);
  const payload = token ? await verifyAuthToken(token) : null;
  if (!payload) {
    return NextResponse.redirect(loginUrl);
  }

  if (!rule.roles.includes(payload.role)) {
    // Send them somewhere they can see; avoid a redirect loop on /jobs.
    const fallback = JOBS_PAGE_ROLES.includes(payload.role) && pathname !== '/jobs' ? '/jobs' : '/login';
    return NextResponse.redirect(new URL(fallback, request.url));
  }

  return NextResponse.next();
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return handlePageRequest(request, pathname);
  }

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
  matcher: ['/api/:path*', '/jobs/:path*', '/candidates/:path*'],
};
