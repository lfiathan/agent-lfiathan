import { HermesUnavailableError } from '../common/errors.js';

/**
 * Service for communicating with Hermes Agent via its
 * OpenAI-compatible API server (http://hermes:8642).
 */
export class HermesService {
  /**
   * @param {object} options
   * @param {string} options.apiUrl
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {number} [options.timeout]
   * @param {import('pino').Logger} [options.logger]
   */
  constructor(options) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'minimax/minimax-m2.5:free';
    this.timeout = options.timeout || 30000;
    this.logger = options.logger || console;

    // Simple circuit breaker state
    this._failures = 0;
    this._lastFailure = 0;
    this._circuitOpenDuration = 30000; // 30s cooldown
    this._failureThreshold = 3;
  }

  /**
   * Check if Hermes is reachable.
   * @returns {Promise<{ available: boolean, details?: any }>}
   */
  async getHealth() {
    try {
      const response = await this._fetch('/health', { method: 'GET' });
      return { available: response.ok, details: await response.json().catch(() => null) };
    } catch {
      return { available: false };
    }
  }

  /**
   * Send a prompt to Hermes and get a response.
   *
   * @param {string} prompt - User message to send
   * @param {object} [options]
   * @param {string} [options.systemPrompt] - Override system prompt
   * @param {string} [options.model] - Override model
   * @param {number} [options.maxTokens=2048]
   * @returns {Promise<{ content: string, usage?: object, raw: object }>}
   */
  async sendMessage(prompt, options = {}) {
    this._checkCircuit();

    const messages = [];
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
      const response = await this._fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Hermes API error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      this._resetCircuit();

      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || null,
        raw: data,
      };
    } catch (err) {
      this._recordFailure();
      this.logger.error({ err: err.message }, 'Hermes request failed');
      throw new HermesUnavailableError(err.message);
    }
  }

  /**
   * Parse a structured response from the agent.
   * Attempts to extract JSON from the agent's text response.
   *
   * @param {string} content - Raw agent response text
   * @returns {object|null}
   */
  parseStructuredResponse(content) {
    // Try extracting JSON block from markdown code fences
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch { /* fall through */ }
    }

    // Try parsing the whole content as JSON
    try { return JSON.parse(content); } catch { /* fall through */ }

    return null;
  }

  /* ── Internal helpers ─────────────────────────────── */

  /** @param {string} path */
  async _fetch(path, options = {}) {
    const url = `${this.apiUrl}${path}`;
    const headers = { ...options.headers };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });
  }

  _checkCircuit() {
    if (this._failures >= this._failureThreshold) {
      const elapsed = Date.now() - this._lastFailure;
      if (elapsed < this._circuitOpenDuration) {
        throw new HermesUnavailableError(
          `Circuit open — ${Math.ceil((this._circuitOpenDuration - elapsed) / 1000)}s until retry`
        );
      }
      // Half-open: allow one attempt
      this._failures = this._failureThreshold - 1;
    }
  }

  _recordFailure() {
    this._failures++;
    this._lastFailure = Date.now();
  }

  _resetCircuit() {
    this._failures = 0;
  }
}
