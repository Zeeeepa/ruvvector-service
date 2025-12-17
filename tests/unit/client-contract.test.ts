/**
 * Compile-time test for VectorClient contract
 *
 * This test verifies that the VectorClient exposes the minimal stable contract
 * required by Layer 3 without executing network calls or Docker.
 *
 * Contract methods:
 * - connect(): Promise<void>
 * - upsert(namespace, id, vector, metadata): Promise<UpsertResult>
 * - query(params): Promise<VectorQueryResult>
 * - run_prediction(model, input): Promise<PredictionResult>
 */

import {
  VectorClient,
  VectorClientConfig,
  UpsertResult,
  CircuitState,
} from '../../src/clients/VectorClient';
import {
  VectorQueryResult,
  PredictionResult,
} from '../../src/types';

describe('VectorClient Contract', () => {
  let client: VectorClient;
  const testConfig: VectorClientConfig = {
    serviceUrl: 'http://test-ruvvector:6379',
    apiKey: 'test-api-key',
    timeout: 5000,
    poolSize: 5,
    circuitBreaker: {
      threshold: 3,
      timeout: 10000,
      resetTimeout: 30000,
    },
  };

  beforeEach(() => {
    client = new VectorClient(testConfig);
  });

  describe('Contract Method Existence', () => {
    it('should expose connect() method', () => {
      expect(typeof client.connect).toBe('function');
    });

    it('should expose upsert() method', () => {
      expect(typeof client.upsert).toBe('function');
    });

    it('should expose query() method', () => {
      expect(typeof client.query).toBe('function');
    });

    it('should expose run_prediction() method', () => {
      expect(typeof client.run_prediction).toBe('function');
    });

    it('should expose ping() method for health checks', () => {
      expect(typeof client.ping).toBe('function');
    });

    it('should expose isConnected() method', () => {
      expect(typeof client.isConnected).toBe('function');
    });

    it('should expose getCircuitState() method', () => {
      expect(typeof client.getCircuitState).toBe('function');
    });

    it('should expose getConnectionInfo() method', () => {
      expect(typeof client.getConnectionInfo).toBe('function');
    });
  });

  describe('Contract Method Signatures', () => {
    it('connect() should return Promise<void>', async () => {
      const result = client.connect();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('upsert() should accept (namespace, id, vector, metadata) and return Promise<UpsertResult>', async () => {
      await client.connect();

      const result = client.upsert(
        'test-namespace',
        'test-id',
        [0.1, 0.2, 0.3],
        { key: 'value' }
      );

      expect(result).toBeInstanceOf(Promise);

      const upsertResult: UpsertResult = await result;
      expect(upsertResult).toHaveProperty('id');
      expect(upsertResult).toHaveProperty('namespace');
      expect(upsertResult).toHaveProperty('status');
    });

    it('query() should accept VectorQueryParams and return Promise<VectorQueryResult>', async () => {
      await client.connect();

      const result = client.query({
        vector: [0.1, 0.2, 0.3],
        limit: 10,
        offset: 0,
      });

      expect(result).toBeInstanceOf(Promise);

      const queryResult: VectorQueryResult = await result;
      expect(queryResult).toHaveProperty('items');
      expect(queryResult).toHaveProperty('total');
      expect(queryResult).toHaveProperty('executionTime');
    });

    it('run_prediction() should accept (model, input) and return Promise<PredictionResult>', async () => {
      await client.connect();

      const result = client.run_prediction('test-model', [0.1, 0.2, 0.3]);

      expect(result).toBeInstanceOf(Promise);

      const predictionResult: PredictionResult = await result;
      expect(predictionResult).toHaveProperty('model');
      expect(predictionResult).toHaveProperty('output');
      expect(predictionResult).toHaveProperty('confidence');
      expect(predictionResult).toHaveProperty('executionTime');
    });

    it('ping() should return Promise<boolean>', async () => {
      const result = client.ping();
      expect(result).toBeInstanceOf(Promise);

      const pingResult = await result;
      expect(typeof pingResult).toBe('boolean');
    });

    it('isConnected() should return boolean', () => {
      expect(typeof client.isConnected()).toBe('boolean');
    });

    it('getCircuitState() should return CircuitState', () => {
      const state = client.getCircuitState();
      expect([CircuitState.CLOSED, CircuitState.OPEN, CircuitState.HALF_OPEN]).toContain(state);
    });

    it('getConnectionInfo() should return object with serviceUrl', () => {
      const info = client.getConnectionInfo();
      expect(info).toHaveProperty('serviceUrl');
      expect(info.serviceUrl).toBe(testConfig.serviceUrl);
    });
  });

  describe('Constructor Requirements', () => {
    it('should require serviceUrl in config', () => {
      const validConfig: VectorClientConfig = {
        serviceUrl: 'http://localhost:6379',
        timeout: 5000,
        poolSize: 5,
        circuitBreaker: {
          threshold: 3,
          timeout: 10000,
          resetTimeout: 30000,
        },
      };

      expect(() => new VectorClient(validConfig)).not.toThrow();
    });

    it('should accept optional apiKey in config', () => {
      const configWithApiKey: VectorClientConfig = {
        serviceUrl: 'http://localhost:6379',
        apiKey: 'optional-key',
        timeout: 5000,
        poolSize: 5,
        circuitBreaker: {
          threshold: 3,
          timeout: 10000,
          resetTimeout: 30000,
        },
      };

      expect(() => new VectorClient(configWithApiKey)).not.toThrow();
    });
  });

  describe('Type Exports', () => {
    it('should export VectorClientConfig type', () => {
      const config: VectorClientConfig = testConfig;
      expect(config.serviceUrl).toBeDefined();
    });

    it('should export UpsertResult type', () => {
      const result: UpsertResult = {
        id: 'test',
        namespace: 'test',
        status: 'upserted',
      };
      expect(result.id).toBeDefined();
    });

    it('should export CircuitState enum', () => {
      expect(CircuitState.CLOSED).toBe('closed');
      expect(CircuitState.OPEN).toBe('open');
      expect(CircuitState.HALF_OPEN).toBe('half_open');
    });
  });
});
