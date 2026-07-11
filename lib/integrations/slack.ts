/**
 * Slack notifications for the recruitment channel via an incoming webhook
 * (SLACK_WEBHOOK_URL). Notifications are best-effort: they retry on
 * transient failures but NEVER throw — a Slack outage must not fail the
 * pipeline action that triggered it. When no webhook is configured the
 * message is logged instead, so development still shows what would send.
 */

import { fetchWithRetry } from '@/lib/integrations/http';

export interface SlackDelivery {
  delivered: boolean;
  reason?: string;
}

async function sendSlackMessage(text: string): Promise<SlackDelivery> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[slack:not-configured] ${text}`);
    return { delivered: false, reason: 'not-configured' };
  }

  try {
    const response = await fetchWithRetry(
      'slack',
      webhookUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      },
      { retries: 2, backoffMs: 300 },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Slack notification rejected with ${response.status}: ${detail.slice(0, 200)}`);
      return { delivered: false, reason: `http-${response.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error('Slack notification failed:', error);
    return { delivered: false, reason: 'unreachable' };
  }
}

const SOURCE_LABELS: Record<string, string> = {
  CAREERS_PAGE: 'careers page',
  JOB_BOARD: 'job board',
  REFERRAL: 'referral',
  AGENCY: 'agency',
  DIRECT_SOURCING: 'direct sourcing',
};

export function notifyNewCandidate(params: {
  candidateName: string;
  source: string;
}): Promise<SlackDelivery> {
  const source = SOURCE_LABELS[params.source] ?? params.source.toLowerCase();
  return sendSlackMessage(`:wave: New candidate *${params.candidateName}* added via ${source}.`);
}

export function notifyInterviewScheduled(params: {
  candidateName: string;
  jobTitle: string;
  type: string;
  slotStart: Date;
  panelistNames: string[];
}): Promise<SlackDelivery> {
  const when = params.slotStart.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const type = params.type.replaceAll('_', ' ').toLowerCase();
  return sendSlackMessage(
    `:calendar: Interview scheduled — *${params.candidateName}* (${params.jobTitle}), ${type} on ${when} UTC with ${params.panelistNames.join(', ')}.`,
  );
}

export function notifyOfferAccepted(params: {
  candidateName: string;
  jobTitle: string;
  startDate: Date;
}): Promise<SlackDelivery> {
  const start = params.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return sendSlackMessage(
    `:tada: *${params.candidateName}* accepted the offer for *${params.jobTitle}* — starting ${start}. Onboarding kicked off.`,
  );
}

export function notifyOfferSigned(params: {
  candidateName: string;
  jobTitle: string;
}): Promise<SlackDelivery> {
  return sendSlackMessage(`:pen: *${params.candidateName}* signed the offer for *${params.jobTitle}*.`);
}

export function notifyBackgroundCheckCompleted(params: {
  candidateName: string;
  jobTitle: string;
  package: string;
  outcome: string;
}): Promise<SlackDelivery> {
  const emoji = params.outcome === 'CLEAR' ? ':white_check_mark:' : ':warning:';
  return sendSlackMessage(
    `${emoji} Background check (${params.package}) for *${params.candidateName}* (${params.jobTitle}) completed: *${params.outcome}*.`,
  );
}
