/**
 * Calendar integration (spec section 6: Microsoft 365 Graph for interviewer
 * availability + invites, Microsoft Teams for auto-generated video links).
 *
 * Two providers behind one interface:
 *  - MicrosoftGraphCalendarProvider: real Graph REST calls (client-credentials
 *    flow) creating Teams online meetings on the organizer's calendar.
 *    Active when the MS_GRAPH_* environment variables are set.
 *  - LocalCalendarProvider: deterministic in-process fallback for
 *    development/CI so scheduling still produces an event id + join link
 *    without external credentials.
 */

import { randomUUID } from 'node:crypto';

export interface CalendarAttendee {
  email: string;
  name: string;
}

export interface CalendarEventInput {
  subject: string;
  body: string;
  start: Date;
  end: Date;
  attendees: CalendarAttendee[];
  /** Request a Teams online meeting (join URL comes back as videoLink). */
  createOnlineMeeting: boolean;
}

export interface CalendarEventResult {
  eventId: string;
  videoLink: string | null;
  provider: 'microsoft-graph' | 'local';
}

export interface CalendarProvider {
  readonly name: 'microsoft-graph' | 'local';
  createEvent(input: CalendarEventInput): Promise<CalendarEventResult>;
  deleteEvent(eventId: string): Promise<void>;
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

// ---------------------------------------------------------------------------
// Microsoft 365 Graph provider
// ---------------------------------------------------------------------------

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Mailbox that owns the interview calendar, e.g. recruiting@company.com */
  organizerUpn: string;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

class MicrosoftGraphCalendarProvider implements CalendarProvider {
  readonly name = 'microsoft-graph' as const;

  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: GraphConfig) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    );

    if (!response.ok) {
      throw new CalendarError(`Microsoft identity platform returned ${response.status} during token exchange.`);
    }

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return payload.access_token;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const token = await this.getAccessToken();

    const response = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(this.config.organizerUpn)}/events`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subject: input.subject,
          body: { contentType: 'text', content: input.body },
          start: { dateTime: input.start.toISOString(), timeZone: 'UTC' },
          end: { dateTime: input.end.toISOString(), timeZone: 'UTC' },
          attendees: input.attendees.map((attendee) => ({
            type: 'required',
            emailAddress: { address: attendee.email, name: attendee.name },
          })),
          isOnlineMeeting: input.createOnlineMeeting,
          onlineMeetingProvider: input.createOnlineMeeting ? 'teamsForBusiness' : undefined,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CalendarError(`Microsoft Graph event creation failed with ${response.status}: ${detail.slice(0, 300)}`);
    }

    const event = (await response.json()) as {
      id: string;
      onlineMeeting?: { joinUrl?: string } | null;
    };

    return {
      eventId: event.id,
      videoLink: event.onlineMeeting?.joinUrl ?? null,
      provider: this.name,
    };
  }

  async deleteEvent(eventId: string): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(this.config.organizerUpn)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    );
    // 404 means the event is already gone — treat as success for idempotency.
    if (!response.ok && response.status !== 404) {
      throw new CalendarError(`Microsoft Graph event deletion failed with ${response.status}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Local development provider
// ---------------------------------------------------------------------------

class LocalCalendarProvider implements CalendarProvider {
  readonly name = 'local' as const;

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const id = randomUUID();
    return {
      eventId: `local-evt-${id}`,
      videoLink: input.createOnlineMeeting
        ? `https://teams.microsoft.com/l/meetup-join/dev-${id}`
        : null,
      provider: this.name,
    };
  }

  async deleteEvent(): Promise<void> {
    // Nothing to remove — local events are not persisted anywhere.
  }
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

export function getCalendarProvider(): CalendarProvider {
  const { MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_ORGANIZER_UPN } =
    process.env;

  if (MS_GRAPH_TENANT_ID && MS_GRAPH_CLIENT_ID && MS_GRAPH_CLIENT_SECRET && MS_GRAPH_ORGANIZER_UPN) {
    return new MicrosoftGraphCalendarProvider({
      tenantId: MS_GRAPH_TENANT_ID,
      clientId: MS_GRAPH_CLIENT_ID,
      clientSecret: MS_GRAPH_CLIENT_SECRET,
      organizerUpn: MS_GRAPH_ORGANIZER_UPN,
    });
  }

  return new LocalCalendarProvider();
}
