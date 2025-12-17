import logger from '../utils/logger';
import {
  VectorInsertParams,
  VectorInsertResult,
  VectorQueryParams,
  VectorQueryResult,
  VectorSimilarityParams,
  VectorSimilarityResult,
  PredictionResult,
} from '../types';

/**
 * Circuit breaker states as per SPARC specification
 */
export enum CircuitState {
  CLOSED = 'closed',      // Normal operation, requests pass through
  OPEN = 'open',          // Fail fast, return 503 immediately
  HALF_OPEN = 'half_open' // Allow limited requests to test recovery
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  threshold: number;      // Failures before opening
  timeout: number;        // Time in open state (ms)
  resetTimeout: number;   // Time before full reset (ms)
}

/**
 * VectorClient configuration matching SPARC spec
 * Uses serviceUrl instead of separate host/port
 */
export interface VectorClientConfig {
  serviceUrl: string;     // Full service URL (e.g., http://ruvvector:6379)
  apiKey?: string;        // Optional API key for authentication
  timeout: number;
  poolSize: number;
  circuitBreaker: CircuitBreakerConfig;
}

/**
 * RuvVector/RuvBase Client - Minimal stable contract for Layer 3 integration
 *
 * This client exposes the following contract:
 * - connect(): Promise<void> - Establish connection to RuvVector service
 * - upsert(namespace, id, vector, metadata): Promise<UpsertResult> - Insert or update vector
 * - query(namespace, vector, top_k): Promise<QueryResult> - Query similar vectors
 * - run_prediction(model, input): Promise<PredictionResult> - Run ML prediction
 *
 * Implements circuit breaker pattern as per SPARC specification
 */
export class VectorClient {
  private serviceUrl: string;
  private apiKey?: string;
  private timeout: number;
  private connected: boolean = false;

  // Circuit breaker state
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private circuitConfig: CircuitBreakerConfig;

  constructor(config: VectorClientConfig) {
    this.serviceUrl = config.serviceUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout;
    this.circuitConfig = config.circuitBreaker;
  }

  /**
   * Get API key for authentication (if configured)
   * Used by future auth implementation
   */
  getApiKey(): string | undefined {
    return this.apiKey;
  }

  /**
   * Establish connection to RuvVector service
   * SPARC Contract: connect() -> Promise<void>
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    logger.info({ serviceUrl: this.serviceUrl }, 'Connecting to RuvVector service');

    // TODO: Implement actual connection logic (gRPC/TCP)
    // For now, mark as connected (stub implementation)
    this.connected = true;
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;

    logger.info({ serviceUrl: this.serviceUrl }, 'Connected to RuvVector service');
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Upsert a vector with metadata (insert or update)
   * SPARC Contract: upsert(namespace, id, vector, metadata) -> Promise<UpsertResult>
   *
   * @param namespace - Vector namespace/collection
   * @param id - Unique vector identifier
   * @param vector - Embedding vector
   * @param metadata - Associated metadata
   * @returns UpsertResult with id and status
   */
  async upsert(
    namespace: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>
  ): Promise<UpsertResult> {
    this.checkCircuit();

    const startTime = Date.now();

    try {
      logger.debug({ namespace, id, vectorLength: vector.length, metadataKeys: Object.keys(metadata) }, 'Upserting vector');

      // TODO: Implement actual upsert to RuvVector backend
      // Stub implementation - vector and metadata will be sent to backend
      const result: UpsertResult = {
        id,
        namespace,
        status: 'upserted',
      };

      this.recordSuccess();

      const duration = Date.now() - startTime;
      logger.info({ namespace, id, duration }, 'Vector upserted successfully');

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error({ error, namespace, id }, 'Failed to upsert vector');
      throw error;
    }
  }

  /**
   * Get timeout configuration
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Get circuit breaker state (for metrics)
   */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /**
   * Check if circuit breaker allows request
   */
  private checkCircuit(): void {
    if (this.circuitState === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;

      // Check if we should transition to half-open
      if (timeSinceFailure >= this.circuitConfig.timeout) {
        this.circuitState = CircuitState.HALF_OPEN;
        logger.info('Circuit breaker transitioning to half-open state');
      } else {
        throw new Error('Circuit breaker is open - RuvVector unavailable');
      }
    }
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Successful request in half-open state - close the circuit
      this.circuitState = CircuitState.CLOSED;
      this.failureCount = 0;
      logger.info('Circuit breaker closed after successful request');
    }
  }

  /**
   * Record a failed operation
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Failed in half-open state - open the circuit again
      this.circuitState = CircuitState.OPEN;
      logger.warn('Circuit breaker reopened after failure in half-open state');
    } else if (this.failureCount >= this.circuitConfig.threshold) {
      // Threshold exceeded - open the circuit
      this.circuitState = CircuitState.OPEN;
      logger.warn(
        { failureCount: this.failureCount, threshold: this.circuitConfig.threshold },
        'Circuit breaker opened due to failure threshold'
      );
    }
  }

  /**
   * Insert a vector with metadata into RuvVector
   */
  async insert(params: VectorInsertParams): Promise<VectorInsertResult> {
    const startTime = Date.now();

    // Check circuit breaker
    this.checkCircuit();

    try {
      logger.debug({ id: params.id }, 'Inserting vector');

      // Stub implementation - would make actual call to RuvVector
      // In production, this would use gRPC/TCP connection to RuvVector
      const result: VectorInsertResult = {
        id: params.id,
      };

      this.recordSuccess();

      const duration = Date.now() - startTime;
      logger.info({ id: params.id, duration }, 'Vector inserted successfully');

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error({ error, id: params.id }, 'Failed to insert vector');
      throw error;
    }
  }

  /**
   * Query vectors based on filters and optional similarity search
   */
  async query(params: VectorQueryParams): Promise<VectorQueryResult> {
    const startTime = Date.now();

    // Check circuit breaker
    this.checkCircuit();

    try {
      logger.debug(
        { hasVector: !!params.vector, limit: params.limit, offset: params.offset },
        'Querying vectors'
      );

      // Stub implementation - would make actual call to RuvVector
      const result: VectorQueryResult = {
        items: [],
        total: 0,
        executionTime: Date.now() - startTime,
      };

      this.recordSuccess();

      logger.info({ total: result.total, duration: result.executionTime }, 'Query completed');

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error({ error }, 'Failed to query vectors');
      throw error;
    }
  }

  /**
   * Find similar vectors based on context vectors (similarity/simulate)
   */
  async similarity(params: VectorSimilarityParams): Promise<VectorSimilarityResult> {
    const startTime = Date.now();

    // Check circuit breaker
    this.checkCircuit();

    try {
      logger.debug(
        { contextCount: params.contextVectors.length, k: params.k, threshold: params.threshold },
        'Finding similar vectors'
      );

      // Stub implementation - would make actual call to RuvVector
      const result: VectorSimilarityResult = {
        neighbors: [],
        processed: params.contextVectors.length,
        executionTime: Date.now() - startTime,
      };

      this.recordSuccess();

      logger.info({ processed: result.processed, duration: result.executionTime }, 'Similarity search completed');

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error({ error }, 'Failed to find similar vectors');
      throw error;
    }
  }

  /**
   * Run prediction using a model
   * SPARC Contract: run_prediction(model, input) -> Promise<PredictionResult>
   *
   * @param model - Model identifier to use for prediction
   * @param input - Input data for the model (vector or structured data)
   * @returns PredictionResult with model output
   */
  async run_prediction(
    model: string,
    input: PredictionInput
  ): Promise<PredictionResult> {
    this.checkCircuit();

    const startTime = Date.now();

    try {
      logger.debug({ model, inputType: typeof input }, 'Running prediction');

      // TODO: Implement actual prediction call to RuvVector/ML backend
      // Stub implementation
      const result: PredictionResult = {
        model,
        output: {},
        confidence: 0.0,
        executionTime: Date.now() - startTime,
      };

      this.recordSuccess();

      logger.info({ model, duration: result.executionTime }, 'Prediction completed');

      return result;
    } catch (error) {
      this.recordFailure();
      logger.error({ error, model }, 'Failed to run prediction');
      throw error;
    }
  }

  /**
   * Health check - verify connection to RuvVector (ping)
   * SPARC: vectorClient.ping()
   */
  async ping(): Promise<boolean> {
    // Check circuit breaker - but don't throw on open for health checks
    if (this.circuitState === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.circuitConfig.timeout) {
        this.circuitState = CircuitState.HALF_OPEN;
      } else {
        return false;
      }
    }

    try {
      logger.debug({ serviceUrl: this.serviceUrl }, 'RuvVector health check');

      // TODO: Implement actual ping to RuvVector
      // Stub implementation - would verify TCP/gRPC connectivity
      this.recordSuccess();
      return true;
    } catch (error) {
      this.recordFailure();
      logger.error({ error }, 'RuvVector health check failed');
      return false;
    }
  }

  /**
   * Get connection info for logging
   */
  getConnectionInfo(): { serviceUrl: string } {
    return { serviceUrl: this.serviceUrl };
  }
}

/**
 * Upsert operation result type
 */
export interface UpsertResult {
  id: string;
  namespace: string;
  status: 'upserted' | 'created' | 'updated';
}

/**
 * Prediction input type - can be vector or structured data
 */
export type PredictionInput = number[] | Record<string, unknown>;

export default VectorClient;
