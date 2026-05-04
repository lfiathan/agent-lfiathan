import { HermesUnavailableError } from '../common/errors.js';

export interface HermesServiceOptions {
  apiUrl: string;
  apiKey?: string;
  model?: string;
  timeout?: number;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
}

export interface HermesResponse {
  content: string;
  usage: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface HermesHealthResult {
  available: boolean;
  details?: unknown;
}

export interface SendMessageOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Service for communicating with Hermes Agent via its
 * OpenAI-compatible API server (http://hermes:8642).
 */
export class HermesService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly logger: Pick<Console, 'error' | 'info' | 'warn'>;

  // Simple circuit breaker state
  private failures = 0;
  private lastFailure = 0;
  private readonly circuitOpenDuration = 30_000; // 30s cooldown
  private readonly failureThreshold = 3;

  constructor(options: HermesServiceOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'minimax/minimax-m2.5:free';
    this.timeout = options.timeout || 30_000;
    this.logger = options.logger || console;
  }

  /** Check if Hermes is reachable. */
  async getHealth(): Promise<HermesHealthResult> {
    try {
      const response = await this.request('/health', { method: 'GET' });
      return { available: response.ok, details: await response.json().catch(() => null) };
    } catch {
      return { available: false };
    }
  }

  /** Send a prompt to Hermes and get a response. */
  async sendMessage(prompt: string, options: SendMessageOptions = {}): Promise<HermesResponse> {
    this.checkCircuit();

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model: options.model || this.model,
      messages,
      max_tokens: options.maxTokens || 2048,
    };

    try {
      const response = await this.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Hermes API error ${response.status}: ${errBody}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Record<string, unknown>;
      };
      this.resetCircuit();

      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || null,
        raw: data as Record<string, unknown>,
      };
    } catch (err) {
      this.recordFailure();
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'Hermes request failed');
      throw new HermesUnavailableError(message);
    }
  }

  /**
   * Parse a structured response from the agent.
   * Attempts to extract JSON from the agent's text response.
   */
  parseStructuredResponse(content: string): Record<string, unknown> | null {
    // Try extracting JSON block from markdown code fences
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>;
      } catch { /* fall through */ }
    }

    // Try parsing the whole content as JSON
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch { /* fall through */ }

    return null;
  }

  /* ── Internal helpers ─────────────────────────────── */

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });
  }

  private checkCircuit(): void {
    if (this.failures >= this.failureThreshold) {
      const elapsed = Date.now() - this.lastFailure;
      if (elapsed < this.circuitOpenDuration) {
        throw new HermesUnavailableError(
          `Circuit open — ${Math.ceil((this.circuitOpenDuration - elapsed) / 1000)}s until retry`
        );
      }
      // Half-open: allow one attempt
      this.failures = this.failureThreshold - 1;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }

  private resetCircuit(): void {
    this.failures = 0;
  }
}
