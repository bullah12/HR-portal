import type { Metadata } from 'next';
import AuditLogViewer from '@/components/audit/AuditLogViewer';

export const metadata: Metadata = { title: 'Audit log — HR Portal' };

export default function AuditPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Audit log</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Append-only record of every human and system decision. Read-only — entries can never be edited or deleted.
        </p>
      </div>
      <AuditLogViewer />
    </div>
  );
}
