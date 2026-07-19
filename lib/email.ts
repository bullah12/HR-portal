/**
 * Transactional email templates + dual-mode delivery.
 *
 * Delivery follows the same env-gated pattern as the other integrations
 * (docs/PLAN.md §8 Q6): when SMTP_HOST is set, sendEmail delivers via
 * nodemailer; when unset, the rendered email is logged to the server
 * console and nothing is sent (local development mode).
 */

import nodemailer from 'nodemailer';

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

export interface EmailDeliveryResult {
  /** 'smtp' when actually sent, 'local' when logged only (dev mode). */
  mode: 'smtp' | 'local';
  delivered: boolean;
  /** Transport message id in smtp mode. */
  messageId?: string;
  error?: string;
}

/**
 * Deliver a rendered email. Never throws — pipeline actions (scheduling,
 * offers) must not fail because a notification could not be sent; the
 * outcome is returned so callers can audit it.
 */
export async function sendEmail(email: RenderedEmail): Promise<EmailDeliveryResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.info(
      `[email:local] To: ${email.to}\n[email:local] Subject: ${email.subject}\n[email:local] ${email.text.replaceAll(
        '\n',
        '\n[email:local] ',
      )}`,
    );
    return { mode: 'local', delivered: false };
  }

  try {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? 'recruitment@acme-corp.example',
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { mode: 'smtp', delivered: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SMTP error';
    console.error(`[email:smtp] delivery to ${email.to} failed: ${message}`);
    return { mode: 'smtp', delivered: false, error: message };
  }
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

export interface OfferSentForSignatureParams {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  /** Public tokenized link to view and respond to the offer. */
  offerUrl: string;
  expiresAt: Date;
}

export function renderOfferSentForSignatureEmail(params: OfferSentForSignatureParams): RenderedEmail {
  const subject = `Your offer from Acme Corp — ${params.jobTitle}`;
  const expiry = params.expiresAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const text = [
    `Hi ${params.candidateName},`,
    '',
    `Great news — your offer for the ${params.jobTitle} position at Acme Corp is ready.`,
    '',
    `View the offer letter and respond here: ${params.offerUrl}`,
    `You have also been sent the offer letter for e-signature; please check your inbox.`,
    '',
    `This offer is valid until ${expiry}.`,
    '',
    'Best regards,',
    'The Acme Corp recruitment team',
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
  <div style="background: #4f46e5; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 18px;">Your offer is ready</h1>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: 0; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>Hi ${escapeHtml(params.candidateName)},</p>
    <p>Great news — your offer for the <strong>${escapeHtml(params.jobTitle)}</strong> position at Acme Corp is ready.</p>
    <p style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(params.offerUrl)}" style="background: #4f46e5; color: #ffffff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">View your offer</a></p>
    <p>You have also been sent the offer letter for e-signature; please check your inbox.</p>
    <p style="color: #64748b; font-size: 13px;">This offer is valid until <strong>${escapeHtml(expiry)}</strong>.</p>
    <p>Best regards,<br/>The Acme Corp recruitment team</p>
  </div>
</div>`.trim();

  return { to: params.candidateEmail, subject, text, html };
}

export interface OfferAcceptedParams {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  startDate: Date;
  /** Public tokenized link to the onboarding checklist. */
  onboardingUrl: string;
}

export function renderOfferAcceptedEmail(params: OfferAcceptedParams): RenderedEmail {
  const subject = `Welcome to Acme Corp — next steps for ${params.jobTitle}`;
  const start = params.startDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const text = [
    `Hi ${params.candidateName},`,
    '',
    `Congratulations — we have recorded your acceptance for the ${params.jobTitle} position. We're delighted you're joining!`,
    '',
    `Your start date: ${start}`,
    '',
    `Your onboarding checklist is ready. Complete the tasks (contract, documents, IT setup) before day one:`,
    params.onboardingUrl,
    '',
    'If anything is unclear, just reply to this email.',
    '',
    'Best regards,',
    'The Acme Corp recruitment team',
  ].join('\n');

  const html = `
<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
  <div style="background: #059669; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 18px;">Welcome to Acme Corp!</h1>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: 0; padding: 24px; border-radius: 0 0 8px 8px;">
    <p>Hi ${escapeHtml(params.candidateName)},</p>
    <p>Congratulations — we have recorded your acceptance for the <strong>${escapeHtml(params.jobTitle)}</strong> position. We're delighted you're joining!</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 0; color: #64748b; width: 130px;">Start date</td>
        <td style="padding: 8px 0;"><strong>${escapeHtml(start)}</strong></td>
      </tr>
    </table>
    <p style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(params.onboardingUrl)}" style="background: #059669; color: #ffffff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open your onboarding checklist</a></p>
    <p style="color: #64748b; font-size: 13px;">Complete the tasks (contract, documents, IT setup) before day one. If anything is unclear, just reply to this email.</p>
    <p>Best regards,<br/>The Acme Corp recruitment team</p>
  </div>
</div>`.trim();

  return { to: params.candidateEmail, subject, text, html };
}
