import type { Knex } from 'knex';

const CONNECTIONS_TABLE = 'strava_connections';
const ACTIVITIES_TABLE = 'strava_activities';

export interface StravaConnection {
  id: string;
  user_id: string;
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  scope: string;
  token_type: string;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertStravaConnectionDTO {
  user_id: string;
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
  token_type: string;
}

export interface StravaActivityDTO {
  user_id: string;
  strava_activity_id: number;
  name: string;
  sport_type: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  total_elevation_gain_m: number;
  start_date: string;
  raw: Record<string, unknown>;
}

export class StravaRepository {
  constructor(private readonly knex: Knex) {}

  async findConnectionByUserId(userId: string): Promise<StravaConnection | undefined> {
    return this.knex(CONNECTIONS_TABLE).where({ user_id: userId }).first();
  }

  async upsertConnection(data: UpsertStravaConnectionDTO): Promise<StravaConnection> {
    const [row] = await this.knex(CONNECTIONS_TABLE)
      .insert(data)
      .onConflict('user_id')
      .merge({
        athlete_id: data.athlete_id,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        scope: data.scope,
        token_type: data.token_type,
        updated_at: this.knex.fn.now(),
      })
      .returning('*');

    return row;
  }

  async upsertActivities(activities: StravaActivityDTO[]): Promise<number> {
    if (activities.length === 0) return 0;

    await this.knex(ACTIVITIES_TABLE)
      .insert(activities)
      .onConflict('strava_activity_id')
      .merge({
        name: this.knex.raw('excluded.name'),
        sport_type: this.knex.raw('excluded.sport_type'),
        distance_m: this.knex.raw('excluded.distance_m'),
        moving_time_s: this.knex.raw('excluded.moving_time_s'),
        elapsed_time_s: this.knex.raw('excluded.elapsed_time_s'),
        total_elevation_gain_m: this.knex.raw('excluded.total_elevation_gain_m'),
        start_date: this.knex.raw('excluded.start_date'),
        raw: this.knex.raw('excluded.raw'),
        updated_at: this.knex.fn.now(),
      });

    return activities.length;
  }
}
