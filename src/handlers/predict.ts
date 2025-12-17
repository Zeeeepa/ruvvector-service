import { Request, Response } from 'express';
import { VectorClient } from '../clients/VectorClient';
import logger from '../utils/logger';
import { ruvvectorUpstreamErrorsTotal } from '../utils/metrics';
import { AppError } from '../middleware/errorHandler';

/**
 * Request body for POST /predict
 */
interface PredictRequest {
  model: string;
  input: number[] | Record<string, unknown>;
}

/**
 * Response body for POST /predict
 */
interface PredictResponse {
  model: string;
  output: Record<string, unknown>;
  confidence: number;
  metadata: {
    correlationId: string;
    executionTime: number;
  };
}

/**
 * Handler for POST /predict
 * SPARC: Run prediction using ML models
 *
 * Boundaries (per SPARC):
 * - Does NOT implement model training
 * - Does NOT cache predictions
 * - Does NOT validate model availability beyond basic checks
 */
export async function predictHandler(
  req: Request,
  res: Response,
  vectorClient: VectorClient
): Promise<void> {
  const startTime = Date.now();
  const correlationId = req.correlationId;
  const body = req.body as PredictRequest;

  try {
    logger.info(
      {
        correlationId,
        tenant: req.entitlement?.tenant,
        model: body.model,
        endpoint: '/predict'
      },
      'Processing predict request'
    );

    // TODO: Implement actual prediction using vectorClient.run_prediction()
    const result = await vectorClient.run_prediction(body.model, body.input);

    const executionTime = Date.now() - startTime;

    const response: PredictResponse = {
      model: result.model,
      output: result.output as Record<string, unknown>,
      confidence: result.confidence,
      metadata: {
        correlationId,
        executionTime,
      },
    };

    logger.info(
      { correlationId, model: body.model, executionTime },
      'Predict completed successfully'
    );

    res.status(200).json(response);
  } catch (error) {
    logger.error({ correlationId, error, model: body.model }, 'Prediction failed');

    ruvvectorUpstreamErrorsTotal.inc({ type: 'predict_failed' });

    if (error instanceof Error) {
      if (error.message.includes('Circuit breaker')) {
        throw new AppError(503, 'service_unavailable', 'Service temporarily unavailable');
      }
      throw new AppError(502, 'upstream_error', 'Upstream service error');
    }
    throw error;
  }
}

export default predictHandler;
