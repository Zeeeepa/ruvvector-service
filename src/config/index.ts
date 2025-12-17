/**
 * Configuration interface matching SPARC specification
 * All configuration via environment variables only - NO .env files, NO defaults for required vars
 */
interface Config {
  // Service configuration
  port: number;
  logLevel: string;

  // RuvVector connection (infra-provisioned)
  ruvVector: {
    serviceUrl: string;   // REQUIRED: Full service URL (e.g., http://ruvvector:6379)
    apiKey?: string;      // OPTIONAL: API key if authentication required
    timeout: number;      // Request timeout (ms)
    poolSize: number;     // Connection pool size
  };

  // Circuit breaker configuration
  circuitBreaker: {
    threshold: number;    // Failures before opening
    timeout: number;      // Open state duration (ms)
    resetTimeout: number; // Time before full reset (ms)
  };

  // Metrics configuration
  metrics: {
    enabled: boolean;
    port: number;
  };

  // Shutdown configuration
  shutdown: {
    timeout: number;      // Graceful shutdown (ms)
  };
}

/**
 * Get required environment variable - fails fast if missing
 * SPARC: No .env files, no hard-coded defaults for required vars
 */
const getRequiredEnvVar = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`FATAL: Missing required environment variable: ${key}. Service cannot start without this configuration.`);
  }
  return value;
};

/**
 * Get optional environment variable with default
 */
const getEnvVar = (key: string, defaultValue: string): string => {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
};

/**
 * Get optional environment variable (may be undefined)
 */
const getOptionalEnvVar = (key: string): string | undefined => {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : undefined;
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
};

/**
 * Configuration object - SPARC compliant
 * All values from environment variables
 */
export const config: Config = {
  // Required environment variables
  port: getEnvNumber('PORT', 3000),
  logLevel: getEnvVar('LOG_LEVEL', 'info'),

  // RuvVector connection - RUVVECTOR_SERVICE_URL is REQUIRED (fail-fast)
  ruvVector: {
    serviceUrl: getRequiredEnvVar('RUVVECTOR_SERVICE_URL'),
    apiKey: getOptionalEnvVar('RUVVECTOR_API_KEY'),
    timeout: getEnvNumber('RUVVECTOR_TIMEOUT', 30000),
    poolSize: getEnvNumber('RUVVECTOR_POOL_SIZE', 10),
  },

  // Circuit breaker
  circuitBreaker: {
    threshold: getEnvNumber('CIRCUIT_BREAKER_THRESHOLD', 5),
    timeout: getEnvNumber('CIRCUIT_BREAKER_TIMEOUT', 30000),
    resetTimeout: getEnvNumber('CIRCUIT_BREAKER_RESET', 60000),
  },

  // Metrics
  metrics: {
    enabled: getEnvBoolean('METRICS_ENABLED', true),
    port: getEnvNumber('METRICS_PORT', 9090),
  },

  // Shutdown
  shutdown: {
    timeout: getEnvNumber('SHUTDOWN_TIMEOUT', 30000),
  },
};

export default config;
