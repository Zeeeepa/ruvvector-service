/**
 * PostgreSQL Database Client with Connection Pooling
 * For Google Cloud SQL PostgreSQL
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import logger from '../utils/logger';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  ssl?: boolean;
}

/**
 * Database client with connection pooling for PostgreSQL
 */
export class DatabaseClient {
  private pool: Pool;
  private initialized: boolean = false;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections,
      idleTimeoutMillis: config.idleTimeoutMs,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    });

    // Pool error handler
    this.pool.on('error', (err) => {
      logger.error({ error: err }, 'Unexpected database pool error');
    });
  }

  /**
   * Initialize the database and create tables if needed
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create plans table if it doesn't exist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS plans (
          id UUID PRIMARY KEY,
          type VARCHAR(50) NOT NULL DEFAULT 'plan',
          intent TEXT NOT NULL,
          plan JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          org_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL
        )
      `);

      // Create indexes if they don't exist
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_plans_org_id ON plans(org_id)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at DESC)
      `);

      // Create deployments table if it doesn't exist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS deployments (
          id UUID PRIMARY KEY,
          target_id VARCHAR(255) NOT NULL,
          environment VARCHAR(20) NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
          status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'previewed', 'running', 'completed', 'failed', 'rolled_back')),
          preview JSONB,
          execution JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          version INTEGER NOT NULL DEFAULT 1,
          metadata JSONB
        )
      `);

      // Create indexes for deployments
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_deployments_environment ON deployments(environment)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_deployments_created ON deployments(created_at DESC)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_deployments_target ON deployments(target_id)
      `);

      this.initialized = true;
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize database');
      throw error;
    }
  }

  /**
   * Check database connectivity
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT 1 as ping');
      return result.rows[0]?.ping === 1;
    } catch (error) {
      logger.error({ error }, 'Database ping failed');
      return false;
    }
  }

  /**
   * Execute a query
   */
  async query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug(
        { query: text.substring(0, 100), duration, rowCount: result.rowCount },
        'Query executed'
      );
      return result;
    } catch (error) {
      logger.error({ error, query: text.substring(0, 100) }, 'Query failed');
      throw error;
    }
  }

  /**
   * Get a client from the pool for transactions
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

export default DatabaseClient;
