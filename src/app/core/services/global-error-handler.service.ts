import { ErrorHandler, inject, Injectable, InjectionToken } from '@angular/core';

export const CHUNK_RELOAD_STORAGE_KEY = 'lh_chunk_reload_v1';
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

/**
 * Injectable reload hook so stale-chunk recovery can be tested deterministically
 * without mutating non-configurable `window.location.reload` in jsdom.
 */
export const CHUNK_RELOAD_FN = new InjectionToken<() => void>('CHUNK_RELOAD_FN', {
  providedIn: 'root',
  factory: () => () => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }
});

const SENSITIVE_PARAM_PATTERN =
  /([?&#](?:access_token|refresh_token|id_token|token|code|client_secret|session|state)=)[^&#\s]+/gi;

const CHUNK_LOAD_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i
];

/**
 * Global Angular error handler that suppresses expected `AbortError` cancellations,
 * recovers once per cooldown window from stale lazy-chunk deployment errors,
 * and redacts sensitive URL parameters before logging.
 */
@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private readonly reloadPage = inject(CHUNK_RELOAD_FN);

  handleError(rawError: unknown): void {
    const error = this.unwrapError(rawError);
    if (this.isAbortError(error)) {
      return;
    }

    const message = this.extractMessage(error);
    if (this.isStaleChunkError(error, message) && this.tryRecoverFromStaleChunk()) {
      return;
    }

    const sanitizedMessage = this.redactSensitiveTokens(message);
    console.error('[LuantiHub Error]', sanitizedMessage);
  }

  private unwrapError(rawError: unknown): unknown {
    if (rawError && typeof rawError === 'object' && 'rejection' in rawError) {
      const rejection = (rawError as { rejection?: unknown }).rejection;
      if (rejection !== undefined) {
        return rejection;
      }
    }
    return rawError;
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const name = 'name' in error ? String((error as { name?: unknown }).name || '') : '';
    return name === 'AbortError';
  }

  private extractMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || `${error.name}: ${error.message}`;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private isStaleChunkError(error: unknown, message: string): boolean {
    const name =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name || '')
        : '';
    return CHUNK_LOAD_ERROR_PATTERNS.some((re) => re.test(name) || re.test(message));
  }

  private tryRecoverFromStaleChunk(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const now = Date.now();
    try {
      const prevRaw = window.sessionStorage?.getItem(CHUNK_RELOAD_STORAGE_KEY);
      const prevTs = prevRaw ? Number(prevRaw) : 0;
      if (prevTs > 0 && now - prevTs < CHUNK_RELOAD_COOLDOWN_MS) {
        return false;
      }
      window.sessionStorage?.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    } catch {
      return false;
    }
    this.reloadPage();
    return true;
  }

  redactSensitiveTokens(input: string): string {
    return String(input || '').replace(SENSITIVE_PARAM_PATTERN, '$1[REDACTED]');
  }
}
