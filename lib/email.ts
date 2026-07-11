/**
 * Transactional email templates. Rendering only — delivery goes through
 * AWS SES (eu-central-1, spec section 6) and is wired up in Phase 2b;
 * until then callers surface the rendered template (e.g. as emailPreview).
 */

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  PHONE_SCREEN: 'phone screen',
  TECHNICAL: 'technical interview',
  PANEL: 'panel interview',
  HIRING_MANAGER: 'hiring manager interview',
  FINAL: 'final interview',
};

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface InterviewConfirmationParams {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  interviewType: string;
  slotStart: Date;
  slotEnd: Date;
  videoLink: string | null;
  panelistNames: string[];
}

function formatSlot(start: Date, end: Date): string {
  const day = start.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const from = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const to = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day}, ${from}–${to} (UTC)`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderInterviewConfirmationEmail(params: InterviewConfirmationParams): RenderedEmail {
  const typeLabel = INTERVIEW_TYPE_LABELS[params.interviewType] ?? 'interview';
  const slot = formatSlot(params.slotStart, params.slotEnd);
  const panel = params.panelistNames.join(', ');
  const subject = `Your ${typeLabel} for ${params.jobTitle}`;

  const joinLine = params.videoLink
    ? `Join online: ${params.videoLink}`
    : 'Joining details will follow separately.';

  const text = [
    `Hi ${params.candidateName},`,
    '',
    `Your ${typeLabel} for the ${params.jobTitle} position is confirmed.`,
    '',
    `When: ${slot}`,
    `Interview panel: ${panel}`,
    joinLine,
    '',
    'A calendar invitation has been sent to this address. If you need to reschedule or cancel, reply to this email and we will find a new slot.',
    '',
    'Best regards,',
    'The Acme Corp recruitment team',
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
  <div style="background: #4f46e5; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 18px;">Interview confirmed</h1>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: 0; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>Hi ${escapeHtml(params.candidateName)},</p>
    <p>Your ${escapeHtml(typeLabel)} for the <strong>${escapeHtml(params.jobTitle)}</strong> position is confirmed.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 0; color: #64748b; width: 130px;">When</td>
        <td style="padding: 8px 0;"><strong>${escapeHtml(slot)}</strong></td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #64748b;">Panel</td>
        <td style="padding: 8px 0;">${escapeHtml(panel)}</td>
      </tr>
    </table>
    ${
      params.videoLink
        ? `<p style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(params.videoLink)}" style="background: #4f46e5; color: #ffffff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Join the interview</a></p>`
        : '<p>Joining details will follow separately.</p>'
    }
    <p style="color: #64748b; font-size: 13px;">A calendar invitation has been sent to this address. Need to reschedule or cancel? Just reply to this email and we will find a new slot.</p>
    <p>Best regards,<br/>The Acme Corp recruitment team</p>
  </div>
</div>`.trim();

  return { to: params.candidateEmail, subject, text, html };
}
