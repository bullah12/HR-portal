/**
 * middleware.ts RBAC contract, invoked directly with real signed JWTs:
 * default-deny on unruled routes, per-role denial, public token routes,
 * and identity-header injection/stripping.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '@/middleware';
import { AUTH_COOKIE, signAuthToken, type StaffRole } from '@/lib/auth';

async function tokenFor(role: StaffRole): Promise<string> {
  return signAuthToken({ sub: `user-${role.toLowerCase()}`, email: `${role}@test.example`, name: `Test ${role}`, role });
}

async function call(
  path: string,
  options: { method?: string; role?: StaffRole; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.role) {
    headers.cookie = `${AUTH_COOKIE}=${await tokenFor(options.role)}`;
  }
  return middleware(new NextRequest(`http://localhost:3000${path}`, { method: options.method ?? 'GET', headers }));
}

describe('middleware RBAC', () => {
  it('denies unauthenticated API requests', async () => {
    const response = await call('/api/jobs');
    expect(response.status).toBe(401);
  });

  it('denies an invalid token', async () => {
    const response = await call('/api/jobs', { headers: { cookie: `${AUTH_COOKIE}=garbage` } });
    expect(response.status).toBe(401);
  });

  it('default-denies a route with no rule, even when authenticated', async () => {
    const response = await call('/api/does-not-exist', { role: 'HR_ADMIN' });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.message).toContain('No access rule');
  });

  it('denies a role not allowed on a ruled route/method', async () => {
    const response = await call('/api/jobs', { method: 'POST', role: 'HIRING_MANAGER' });
    expect(response.status).toBe(403);

    const audit = await call('/api/audit-logs', { role: 'RECRUITER' });
    expect(audit.status).toBe(403);
  });

  it('denies a method with no role list on a ruled route', async () => {
    const response = await call('/api/jobs', { method: 'DELETE', role: 'HR_ADMIN' });
    expect(response.status).toBe(405);
  });

  it('allows a permitted role and injects the verified identity headers', async () => {
    const response = await call('/api/jobs', { role: 'RECRUITER' });
    expect(response.status).toBe(200); // NextResponse.next()
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('user-recruiter');
    expect(response.headers.get('x-middleware-request-x-user-role')).toBe('RECRUITER');
  });

  it('strips client-supplied identity headers', async () => {
    const response = await call('/api/jobs', {
      role: 'RECRUITER',
      headers: { 'x-user-id': 'attacker', 'x-user-role': 'HR_ADMIN' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('user-recruiter');
    expect(response.headers.get('x-middleware-request-x-user-role')).toBe('RECRUITER');
  });

  it('lets public token routes through unauthenticated, without identity headers', async () => {
    const withToken = await call('/api/offers/some-offer-id?token=secret', {
      headers: { 'x-user-id': 'attacker' },
    });
    expect(withToken.status).toBe(200);
    expect(withToken.headers.get('x-middleware-next')).toBe('1');
    expect(withToken.headers.get('x-middleware-request-x-user-id')).toBeNull();

    const acceptRoute = await call('/api/offers/some-offer-id/accept', { method: 'POST' });
    expect(acceptRoute.status).toBe(200);

    const onboarding = await call('/api/onboarding/some-candidate/tasks?token=secret');
    expect(onboarding.status).toBe(200);
  });

  it('requires the ?token= param on token routes that need it', async () => {
    const response = await call('/api/offers/some-offer-id'); // GET without token, no auth
    expect(response.status).toBe(401);
  });

  it('lets webhook endpoints through without staff auth (HMAC checked in-route)', async () => {
    const response = await call('/api/webhooks/backgroundCheck', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
