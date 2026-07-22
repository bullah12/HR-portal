'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import {
  apiFetch,
  clearStoredUser,
  getStoredUser,
  ROLE_LABELS,
  type SessionUser,
} from '@/lib/client';
import type { StaffRole } from '@/lib/auth';

interface NavLink {
  href: string;
  label: string;
  roles: StaffRole[];
}

const NAV_LINKS: NavLink[] = [
  { href: '/jobs', label: 'Jobs', roles: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER'] },
  { href: '/jobs/new', label: 'New job', roles: ['HR_ADMIN', 'RECRUITER'] },
  { href: '/candidates', label: 'Candidates', roles: ['HR_ADMIN', 'RECRUITER'] },
  { href: '/interviews', label: 'Interviews', roles: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER'] },
  { href: '/offers', label: 'Offers', roles: ['HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'FINANCE_APPROVER'] },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // localStorage is read after mount to avoid a hydration mismatch;
  // re-read on navigation so login/logout is reflected immediately.
  useEffect(() => {
    setUser(getStoredUser());
    setMounted(true);
    setMenuOpen(false);
  }, [pathname]);

  if (!mounted || !user || pathname === '/login') {
    return null;
  }

  const visibleLinks = NAV_LINKS.filter((link) => link.roles.includes(user.role));

  async function handleLogout() {
    setLoggingOut(true);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearStoredUser();
    setLoggingOut(false);
    router.push('/login');
    router.refresh();
  }

  const linkClass = (href: string) => {
    const active = href === '/jobs' ? pathname === '/jobs' : pathname.startsWith(href);
    return `rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/jobs" className="text-base font-bold tracking-tight text-indigo-700">
            HR Portal
          </Link>
          <div className="hidden items-center gap-1 sm:flex">
            {visibleLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <div className="text-right">
            <p className="text-sm font-medium text-slate-800">{user.name}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation menu"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            {menuOpen ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </nav>

      {menuOpen && (
        <div className="border-t border-slate-200 px-4 pb-4 pt-2 sm:hidden">
          <div className="flex flex-col gap-1">
            {visibleLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{user.name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
