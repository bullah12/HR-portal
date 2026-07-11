'use client';

/**
 * Client-side helpers shared by all components:
 *  - session user storage (the JWT itself stays in the httpOnly cookie;
 *    only the non-sensitive profile lives in localStorage for role-based
 *    rendering)
 *  - apiFetch: thin fetch wrapper around the Phase 1b response envelope
 */

import type { StaffRole } from '@/lib/auth';
import type { ApiError } from '@/lib/types';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  department: string;
}

const USER_STORAGE_KEY = 'hr_portal_user';

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    return parsed && parsed.id && parsed.role ? parsed : null;
  } catch {
    return null;
  }
}

export function storeUser(user: SessionUser): void {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

/** Spec section 1: HR admins and recruiters manage jobs and candidates. */
export function canManageRecruiting(role: StaffRole): boolean {
  return role === 'HR_ADMIN' || role === 'RECRUITER';
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  HR_ADMIN: 'HR Admin',
  RECRUITER: 'Recruiter',
  HIRING_MANAGER: 'Hiring Manager',
  INTERVIEWER: 'Interviewer',
  FINANCE_APPROVER: 'Finance Approver',
  DPO_AUDITOR: 'DPO / Auditor',
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiError };

interface ApiFetchOptions {
  method?: string;
  json?: unknown;
  formData?: FormData;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.formData) {
      body = options.formData;
    }

    const response = await fetch(path, { method: options.method ?? 'GET', headers, body });
    const payload = (await response.json().catch(() => null)) as
      | { success: true; data: T }
      | { success: false; error: ApiError }
      | null;

    if (response.ok && payload && payload.success) {
      return { ok: true, data: payload.data };
    }
    return {
      ok: false,
      status: response.status,
      error:
        payload && !payload.success
          ? payload.error
          : { code: 'UNEXPECTED_RESPONSE', message: `Request failed with status ${response.status}.` },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'NETWORK_ERROR', message: 'Could not reach the server. Please try again.' },
    };
  }
}

export function formatCompBand(min: number, max: number, currency: string): string {
  const format = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  return `${format.format(min)} – ${format.format(max)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
