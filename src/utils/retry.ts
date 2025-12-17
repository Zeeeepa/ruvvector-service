import logger from './logger';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  maxAttempts: number;      // Maximum number of attempts (including first try)
  baseDelayMs: number;      // Base delay between retries (ms)
  maxDelayMs: number;       // Maximum delay cap (ms)
  backoffMultiplier: number; // Exponential backoff multiplier
  retryableErrors?: string[]; // Error messages/codes to retry on (optional)
}

/**
 * Default retry configuration
 * Layer-3 can use these defaults or provide custom config
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Check if an error should trigger a retry
 */
function isRetryableError(error: Error, retryableErrors?: string[]): boolean {
  // Don't retry circuit breaker errors - these are intentional fail-fast
  if (error.message.includes('Circuit breaker')) {
    return false;
  }

  // If specific retryable errors are configured, check against them
  if (retryableErrors && retryableErrors.length > 0) {
    return retryableErrors.some(pattern =>
      error.message.includes(pattern) || error.name.includes(pattern)
    );
  }

  // By default, retry on transient errors
  const transientPatterns = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'timeout',
    'socket hang up',
    'temporarily unavailable',
  ];

  return transientPatterns.some(pattern =>
    error.message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Calculate delay for next retry with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // Add jitter (±10%) to prevent thundering herd
  const jitter = cappedDelay * 0.1 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async operation with retry logic
 *
 * This is the primary retry utility for Layer-3 integration.
 * Handlers do NOT call this directly (per SPARC - caller responsibility).
 * Layer-3 callers can use this to wrap calls to the service.
 *
 * @param operation - Async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @param context - Optional context for logging (e.g., { correlationId, operation: 'ingest' })
 * @returns RetryResult with success status, result/error, and metadata
 *
 * @example
 * // Layer-3 usage:
 * const result = await withRetry(
 *   () => vectorClient.insert(params),
 *   { maxAttempts: 3, baseDelayMs: 100 },
 *   { correlationId: 'abc-123', operation: 'insert' }
 * );
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: Record<string, unknown>
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    try {
      const result = await operation();

      if (attempt > 1) {
        logger.info(
          { ...context, attempt, totalAttempts: fullConfig.maxAttempts },
          'Operation succeeded after retry'
        );
      }

      return {
        success: true,
        result,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt >= fullConfig.maxAttempts;
      const shouldRetry = !isLastAttempt && isRetryableError(lastError, fullConfig.retryableErrors);

      if (shouldRetry) {
        const delayMs = calculateDelay(attempt, fullConfig);

        logger.warn(
          {
            ...context,
            attempt,
            maxAttempts: fullConfig.maxAttempts,
            delayMs,
            error: lastError.message,
          },
          'Operation failed, retrying'
        );

        await sleep(delayMs);
      } else {
        // Log final failure
        logger.error(
          {
            ...context,
            attempt,
            maxAttempts: fullConfig.maxAttempts,
            error: lastError.message,
            retryable: !isLastAttempt,
          },
          isLastAttempt ? 'Operation failed after max retries' : 'Operation failed with non-retryable error'
        );
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: fullConfig.maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Simplified retry wrapper that throws on failure
 *
 * @param operation - Async function to execute
 * @param config - Retry configuration (optional)
 * @param context - Optional context for logging
 * @returns Result of successful operation
 * @throws Last error if all retries exhausted
 *
 * @example
 * // Layer-3 usage (throws on failure):
 * const result = await retry(
 *   () => vectorClient.query(params),
 *   { maxAttempts: 3 }
 * );
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: Record<string, unknown>
): Promise<T> {
  const result = await withRetry(operation, config, context);

  if (!result.success) {
    throw result.error || new Error('Operation failed after retries');
  }

  return result.result as T;
}

export default { withRetry, retry, DEFAULT_RETRY_CONFIG };
