/**
 * POST /api/auth/logout — clear the httpOnly auth cookie.
 * Public route: an expired/invalid session must still be able to log out.
 */

import { AUTH_COOKIE } from '@/lib/auth';
import { ok } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST() {
  const response = ok({ loggedOut: true });
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
  return response;
}
