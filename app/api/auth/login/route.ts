/**
 * POST /api/auth/login — exchange staff credentials for a JWT.
 *
 * Public route (see middleware.ts). Returns the token in the body for
 * Authorization: Bearer usage and also sets it as an httpOnly cookie.
 */

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AUTH_COOKIE, TOKEN_TTL_SECONDS, signAuthToken, type StaffRole } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import type { LoginResponseData } from '@/lib/types';

export const runtime = 'nodejs';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid login payload.', parsed.error.flatten().fieldErrors);
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });

    // Same response for unknown email and wrong password — no account probing.
    const passwordMatches =
      user !== null && (await bcrypt.compare(parsed.data.password, user.passwordHash));
    if (!user || !passwordMatches) {
      return fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const token = await signAuthToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as StaffRole,
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
      },
    });

    const data: LoginResponseData = {
      token,
      tokenType: 'Bearer',
      expiresInSeconds: TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as StaffRole,
        department: user.department,
      },
    };

    const response = ok(data);
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: TOKEN_TTL_SECONDS,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('POST /api/auth/login failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
