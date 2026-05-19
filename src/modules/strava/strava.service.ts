import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import { ValidationError, NotFoundError } from '../../common/errors.js';
import {
  StravaRepository,
  type StravaConnection,
  type StravaActivityDTO,
} from './strava.repository.js';
import { buildStravaActivityAnalysis } from './strava.analysis.js';

interface StravaTokenResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  athlete?: {
    id: number;
  };
}

interface StravaActivityResponse {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  [key: string]: unknown;
}

export interface StravaWebhookEvent {
  aspect_type: 'create' | 'update' | 'delete' | string;
  event_time?: number;
  object_id: number;
  object_type: 'activity' | 'athlete' | string;
  owner_id: number;
  subscription_id?: number;
  updates?: Record<string, unknown>;
}

export interface StravaWebhookResult {
  accepted: boolean;
  ignored?: boolean;
  reason?: string;
  notified?: boolean;
  activityId?: number;
}

export class StravaService {
  private readonly repo: StravaRepository;

  constructor(
    knex: Knex,
    _redis: Redis,
    private readonly config: {
      clientId: string;
      clientSecret: string;
      redirectUri?: string;
      telegramBotToken?: string;
      telegramChatId?: string;
    }
  ) {
    this.repo = new StravaRepository(knex);
  }

  getAuthorizationUrl(params: { userId: string; redirectUri?: string; scope?: string }): string {
    this.ensureCredentials();

    const redirectUri = params.redirectUri ?? this.config.redirectUri;
    if (!redirectUri) {
      throw new ValidationError('redirectUri is required (or set STRAVA_REDIRECT_URI)');
    }

    const url = new URL('https://www.strava.com/oauth/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', params.scope ?? 'read,activity:read_all');
    url.searchParams.set('state', params.userId);

    return url.toString();
  }

  async exchangeCode(params: { userId: string; code: string; redirectUri?: string }): Promise<StravaConnection> {
    this.ensureCredentials();

    const redirectUri = params.redirectUri ?? this.config.redirectUri;
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri,
    });

    if (!token.athlete?.id) {
      throw new ValidationError('Strava authorization response did not include athlete id');
    }

    return this.repo.upsertConnection({
      user_id: params.userId,
      athlete_id: token.athlete.id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(token.expires_at * 1000).toISOString(),
      scope: token.scope,
      token_type: token.token_type,
    });
  }

  async refreshToken(userId: string): Promise<StravaConnection> {
    this.ensureCredentials();

    const conn = await this.repo.findConnectionByUserId(userId);
    if (!conn) throw new NotFoundError('Strava connection');

    const token = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    });

    return this.repo.upsertConnection({
      user_id: userId,
      athlete_id: token.athlete?.id ?? conn.athlete_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(token.expires_at * 1000).toISOString(),
      scope: token.scope,
      token_type: token.token_type,
    });
  }

  async getStatus(userId: string): Promise<{ connected: boolean; athleteId?: number; expiresAt?: Date; scope?: string }> {
    const conn = await this.repo.findConnectionByUserId(userId);
    if (!conn) return { connected: false };

    return {
      connected: true,
      athleteId: conn.athlete_id,
      expiresAt: conn.expires_at,
      scope: conn.scope,
    };
  }

  async syncActivities(userId: string, page = 1, perPage = 50): Promise<{ synced: number }> {
    const conn = await this.ensureValidConnection(userId);

    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ValidationError(`Failed to fetch Strava activities: ${response.status} ${text}`);
    }

    const data = (await response.json()) as StravaActivityResponse[];
    const mapped = data.map((activity) => this.mapActivity(userId, activity));

    const synced = await this.repo.upsertActivities(mapped);
    return { synced };
  }

  async syncActivityById(userId: string, activityId: number): Promise<StravaActivityDTO> {
    const activity = await this.fetchActivityById(userId, activityId);
    const mapped = this.mapActivity(userId, activity);
    await this.repo.upsertActivities([mapped]);
    return mapped;
  }

  async analyzeLatestActivity(userId: string): Promise<{ activity?: StravaActivityDTO; analysis?: string }> {
    const activity = await this.repo.findLatestActivity(userId);
    if (!activity) return {};
    return { activity, analysis: buildStravaActivityAnalysis(activity) };
  }

  async handleWebhookEvent(event: StravaWebhookEvent): Promise<StravaWebhookResult> {
    if (event.object_type !== 'activity') {
      return { accepted: true, ignored: true, reason: 'non_activity_event' };
    }

    if (!['create', 'update'].includes(event.aspect_type)) {
      return { accepted: true, ignored: true, reason: `unsupported_aspect_${event.aspect_type}` };
    }

    const conn = await this.repo.findConnectionByAthleteId(event.owner_id);
    if (!conn) {
      return { accepted: true, ignored: true, reason: 'unknown_athlete' };
    }

    const activity = await this.fetchActivityByIdWithRetry(conn.user_id, event.object_id);
    const mapped = this.mapActivity(conn.user_id, activity);
    await this.repo.upsertActivities([mapped]);

    const eventType = event.aspect_type === 'create' ? 'create' : 'update';
    const shouldNotify = await this.repo.markNotificationSent({
      user_id: conn.user_id,
      strava_activity_id: mapped.strava_activity_id,
      event_type: eventType,
      payload: event as unknown as Record<string, unknown>,
    });

    if (!shouldNotify) {
      return { accepted: true, ignored: true, reason: 'already_notified', activityId: mapped.strava_activity_id };
    }

    const analysis = buildStravaActivityAnalysis(mapped);
    await this.sendTelegramNotification(analysis);

    return { accepted: true, notified: Boolean(this.config.telegramBotToken && this.config.telegramChatId), activityId: mapped.strava_activity_id };
  }

  private async fetchActivityByIdWithRetry(userId: string, activityId: number): Promise<StravaActivityResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await this.fetchActivityById(userId, activityId);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
    throw lastError;
  }

  private async fetchActivityById(userId: string, activityId: number): Promise<StravaActivityResponse> {
    const conn = await this.ensureValidConnection(userId);
    const url = new URL(`https://www.strava.com/api/v3/activities/${activityId}`);
    url.searchParams.set('include_all_efforts', 'false');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ValidationError(`Failed to fetch Strava activity ${activityId}: ${response.status} ${text}`);
    }

    return (await response.json()) as StravaActivityResponse;
  }

  private mapActivity(userId: string, activity: StravaActivityResponse): StravaActivityDTO {
    return {
      user_id: userId,
      strava_activity_id: activity.id,
      name: activity.name,
      sport_type: activity.sport_type,
      distance_m: activity.distance ?? 0,
      moving_time_s: activity.moving_time ?? 0,
      elapsed_time_s: activity.elapsed_time ?? 0,
      total_elevation_gain_m: activity.total_elevation_gain ?? 0,
      start_date: activity.start_date,
      raw: activity as unknown as Record<string, unknown>,
    };
  }

  private async sendTelegramNotification(message: string): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) {
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.config.telegramChatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ValidationError(`Failed to send Strava analysis notification: ${response.status} ${text}`);
    }
  }

  private async ensureValidConnection(userId: string): Promise<StravaConnection> {
    const conn = await this.repo.findConnectionByUserId(userId);
    if (!conn) throw new NotFoundError('Strava connection');

    if (new Date(conn.expires_at).getTime() <= Date.now()) {
      return this.refreshToken(userId);
    }

    return conn;
  }

  private async requestToken(body: {
    grant_type: 'authorization_code' | 'refresh_token';
    code?: string;
    refresh_token?: string;
    redirect_uri?: string;
  }): Promise<StravaTokenResponse> {
    const payload = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: body.grant_type,
      ...(body.code ? { code: body.code } : {}),
      ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
      ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
    });

    const response = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ValidationError(`Strava token exchange failed: ${response.status} ${text}`);
    }

    return (await response.json()) as StravaTokenResponse;
  }

  private ensureCredentials(): void {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new ValidationError('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are required');
    }
  }
}
