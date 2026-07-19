import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signAuthToken, verifyAuthToken } from '@/lib/auth';

const PAYLOAD = {
  sub: 'user-123',
  email: 'sofia.lindqvist@acme-corp.example',
  name: 'Sofia Lindqvist',
  role: 'RECRUITER' as const,
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET as string);
}

describe('JWT auth', () => {
  it('round-trips sign → verify with the full payload intact', async () => {
    const token = await signAuthToken(PAYLOAD);
    const verified = await verifyAuthToken(token);
    expect(verified).toEqual(PAYLOAD);
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ email: PAYLOAD.email, name: PAYLOAD.name, role: PAYLOAD.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.sub)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secretKey());
    expect(await verifyAuthToken(expired)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = await new SignJWT({ email: PAYLOAD.email, name: PAYLOAD.name, role: PAYLOAD.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-key'));
    expect(await verifyAuthToken(forged)).toBeNull();
  });

  it('rejects tampered and malformed tokens', async () => {
    const token = await signAuthToken(PAYLOAD);
    expect(await verifyAuthToken(`${token}x`)).toBeNull();
    expect(await verifyAuthToken('not-a-jwt')).toBeNull();
  });

  it('rejects a valid signature whose role is not a staff role', async () => {
    const badRole = await new SignJWT({ email: PAYLOAD.email, name: PAYLOAD.name, role: 'SUPERUSER' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(PAYLOAD.sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey());
    expect(await verifyAuthToken(badRole)).toBeNull();
  });
});
