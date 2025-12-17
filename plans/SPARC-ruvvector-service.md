# RuvVector Service - SPARC Specification

## Document Overview

This SPARC specification defines the ruvvector-service, a thin application-layer API that provides a unified interface for event ingestion, querying, and simulation access on top of the infrastructure-level RuvVector deployment. This document follows the complete SPARC lifecycle: Specification, Pseudocode, Architecture, Refinement, and Completion.

---

# S - Specification

## Problem Statement

Layer 3 orchestration projects and simulator components require programmatic access to vector storage and retrieval capabilities provisioned by Layer 1 infrastructure. Currently, there is no standardized application-layer interface that abstracts the underlying RuvVector and Postgres infrastructure while maintaining clear separation of concerns between infrastructure provisioning, application services, and higher-level orchestration.

Without this service layer:
- Orchestration projects must implement their own RuvVector client logic
- Simulator components duplicate connection management code
- No standardized contract exists for event normalization
- Infrastructure changes propagate directly to consumer code
- Entitlement boundaries lack a clear enforcement point

## Goals

### Primary Goal

Provide a single, stable, application-layer API that acts as the **sole interface** between Layer 3+ consumers and the infrastructure-provisioned vector storage system.

### Specific Goals

1. **Event Ingestion**: Accept normalized events via a single ingest endpoint and persist them to the vector store
2. **State Querying**: Provide historical and vector state retrieval via a single query endpoint
3. **Simulation Access**: Enable simulation queries and coordination via a single simulate endpoint

### Non-Goals (Explicit Exclusions)

This service explicitly **does not** and **must never**:

1. Duplicate infrastructure logic (provisioning, scaling, backups)
2. Own or manage Postgres schemas (schema ownership belongs to infra)
3. Manage vector index creation, tuning, or maintenance
4. Implement integration-specific branching or conditional logic
5. Implement billing, metering, or cost allocation
6. Implement authentication or authorization (deferred to gateway/mesh)
7. Implement orchestration workflows (belongs to Layer 3)
8. Implement any Layer 4 product logic (UI, dashboards, user management)
9. Define event schemas beyond normalization contracts
10. Perform ETL, transformation, or enrichment of events

## Constraints

### Technical Constraints

| Constraint | Requirement |
|------------|-------------|
| Runtime | Node.js LTS (20.x) or compatible |
| Protocol | HTTP/1.1 + HTTP/2, JSON request/response |
| State | Stateless - no local persistence beyond process memory |
| Dependencies | RuvVector (infra-provisioned), Postgres (infra-provisioned) |
| Configuration | Environment variables only |
| Deployment | Container-ready, single process |

### Architectural Constraints

| Constraint | Rationale |
|------------|-----------|
| Three endpoints maximum | Prevents scope creep and maintains focus |
| No schema ownership | Infrastructure owns all persistent schemas |
| No business logic | Pure pass-through with normalization only |
| No orchestration | Consumers are responsible for workflow coordination |
| Environment-driven configuration | Enables infrastructure to control connectivity |

### Operational Constraints

| Constraint | Requirement |
|------------|-------------|
| Startup time | < 5 seconds to healthy |
| Memory footprint | < 256MB baseline |
| Request timeout | Configurable, default 30s |
| Graceful shutdown | Drain connections within 30s |

## Three Endpoint Responsibilities

### 1. Ingest Endpoint (`POST /ingest`)

**Responsibility**: Accept normalized event payloads and persist to vector storage.

**Input Contract**:
- Normalized event structure (defined below)
- Caller-provided correlation ID
- Entitlement context header

**Output Contract**:
- Acknowledgment with vector ID
- Storage confirmation status
- Processing metadata

**Boundaries**:
- Does NOT validate business rules
- Does NOT transform events beyond normalization verification
- Does NOT batch or aggregate events
- Does NOT implement retry logic (caller responsibility)

### 2. Query Endpoint (`POST /query`)

**Responsibility**: Retrieve historical events and vector state based on query parameters.

**Input Contract**:
- Query specification (vector similarity, temporal range, metadata filters)
- Pagination parameters
- Entitlement context header

**Output Contract**:
- Matching events with relevance scores
- Pagination cursors
- Query execution metadata

**Boundaries**:
- Does NOT implement complex aggregations
- Does NOT cache results
- Does NOT implement query optimization beyond parameter pass-through
- Does NOT join across data sources

### 3. Simulate Endpoint (`POST /simulate`)

**Responsibility**: Trigger or coordinate simulation queries against the vector store.

**Input Contract**:
- Simulation parameters (scenario definition)
- Context vectors for simulation
- Entitlement context header

**Output Contract**:
- Simulation results (nearest neighbors, projected states)
- Confidence scores
- Execution metadata

**Boundaries**:
- Does NOT implement simulation logic (pass-through to RuvVector)
- Does NOT persist simulation results
- Does NOT orchestrate multi-step simulations
- Does NOT evaluate business conditions

## Normalized Event Structure

```typescript
interface NormalizedEvent {
  // Identity
  eventId: string;          // UUID, caller-generated
  correlationId: string;    // UUID, for request tracing

  // Temporal
  timestamp: string;        // ISO 8601 UTC

  // Content
  vector: number[];         // Embedding vector, dimension infra-defined
  payload: object;          // Arbitrary JSON, opaque to service

  // Metadata
  metadata: {
    source: string;         // Originating system identifier
    type: string;           // Event type classification
    version: string;        // Schema version
  };
}
```

## Consumer Context

### Layer 3 Consumers (Orchestration Projects)

Layer 3 projects are the **primary consumers** of this service. They:
- Coordinate multi-step workflows using this service as a data access point
- Implement business logic on top of query results
- Manage event lifecycles and state machines
- May reference this service in their specifications

**Important**: This service does NOT implement any Layer 3 logic. It provides data access primitives only.

### Simulator Components

Simulator components use the simulate endpoint to:
- Project state based on vector similarity
- Evaluate hypothetical scenarios
- Generate training data for models

**Important**: Simulation logic lives in the simulator, not in this service.

### Layer 4 (Product Assembly)

Layer 4 products may eventually use this service indirectly through Layer 3 orchestration. This service:
- Has no awareness of Layer 4 products
- Does not expose product-specific endpoints
- Does not implement UI-specific transformations

---

# P - Pseudocode

## Request Handling Flows

### Ingest Flow

```
FUNCTION handleIngest(request):
    // Step 1: Extract and validate structure
    headers = extractHeaders(request)
    body = parseJSON(request.body)

    IF NOT hasRequiredHeaders(headers, ['x-correlation-id', 'x-entitlement-context']):
        RETURN error(400, 'Missing required headers')

    IF NOT isValidNormalizedEvent(body):
        RETURN error(400, 'Invalid event structure')

    // Step 2: Check entitlement (stub - no billing)
    entitlementResult = checkEntitlement(headers['x-entitlement-context'])
    IF NOT entitlementResult.allowed:
        RETURN error(403, 'Entitlement check failed')

    // Step 3: Forward to RuvVector
    vectorClient = getVectorClient()  // From environment config

    TRY:
        result = vectorClient.insert({
            id: body.eventId,
            vector: body.vector,
            payload: body.payload,
            metadata: body.metadata
        })
    CATCH error:
        logError('Vector insert failed', error, headers['x-correlation-id'])
        RETURN error(502, 'Upstream service error')

    // Step 4: Return acknowledgment
    RETURN success(201, {
        eventId: body.eventId,
        vectorId: result.id,
        status: 'stored',
        timestamp: NOW()
    })
```

### Query Flow

```
FUNCTION handleQuery(request):
    // Step 1: Extract and validate
    headers = extractHeaders(request)
    body = parseJSON(request.body)

    IF NOT hasRequiredHeaders(headers, ['x-correlation-id', 'x-entitlement-context']):
        RETURN error(400, 'Missing required headers')

    IF NOT isValidQuerySpec(body):
        RETURN error(400, 'Invalid query specification')

    // Step 2: Check entitlement (stub - no billing)
    entitlementResult = checkEntitlement(headers['x-entitlement-context'])
    IF NOT entitlementResult.allowed:
        RETURN error(403, 'Entitlement check failed')

    // Step 3: Build vector query
    queryParams = {
        vector: body.queryVector,           // Optional similarity search
        filters: body.filters,              // Metadata filters
        timeRange: body.timeRange,          // Temporal bounds
        limit: body.limit OR 100,
        offset: body.offset OR 0
    }

    // Step 4: Execute query against RuvVector
    vectorClient = getVectorClient()

    TRY:
        results = vectorClient.query(queryParams)
    CATCH error:
        logError('Vector query failed', error, headers['x-correlation-id'])
        RETURN error(502, 'Upstream service error')

    // Step 5: Return results
    RETURN success(200, {
        results: results.items,
        pagination: {
            total: results.total,
            limit: queryParams.limit,
            offset: queryParams.offset,
            hasMore: results.total > (queryParams.offset + queryParams.limit)
        },
        metadata: {
            queryTime: results.executionTime,
            correlationId: headers['x-correlation-id']
        }
    })
```

### Simulate Flow

```
FUNCTION handleSimulate(request):
    // Step 1: Extract and validate
    headers = extractHeaders(request)
    body = parseJSON(request.body)

    IF NOT hasRequiredHeaders(headers, ['x-correlation-id', 'x-entitlement-context']):
        RETURN error(400, 'Missing required headers')

    IF NOT isValidSimulationSpec(body):
        RETURN error(400, 'Invalid simulation specification')

    // Step 2: Check entitlement (stub - no billing)
    entitlementResult = checkEntitlement(headers['x-entitlement-context'])
    IF NOT entitlementResult.allowed:
        RETURN error(403, 'Entitlement check failed')

    // Step 3: Build simulation query
    simParams = {
        contextVectors: body.contextVectors,
        k: body.nearestNeighbors OR 10,
        threshold: body.similarityThreshold OR 0.0,
        includeMetadata: body.includeMetadata OR true
    }

    // Step 4: Execute simulation query
    vectorClient = getVectorClient()

    TRY:
        results = vectorClient.similarity(simParams)
    CATCH error:
        logError('Simulation query failed', error, headers['x-correlation-id'])
        RETURN error(502, 'Upstream service error')

    // Step 5: Return simulation results
    RETURN success(200, {
        results: results.neighbors.map(n => ({
            eventId: n.id,
            similarity: n.score,
            vector: n.vector IF body.includeVectors,
            payload: n.payload,
            metadata: n.metadata
        })),
        execution: {
            vectorsProcessed: results.processed,
            executionTime: results.executionTime,
            correlationId: headers['x-correlation-id']
        }
    })
```

### Entitlement Check Stub

```
FUNCTION checkEntitlement(entitlementContext):
    // STUB: No billing logic implemented
    // This function validates entitlement format only
    // Actual entitlement enforcement is deferred to gateway/mesh layer

    IF entitlementContext IS NULL OR entitlementContext IS EMPTY:
        RETURN { allowed: false, reason: 'Missing entitlement context' }

    TRY:
        parsed = decodeEntitlementContext(entitlementContext)

        // Validate structure only - no business rules
        IF NOT hasRequiredFields(parsed, ['tenant', 'scope']):
            RETURN { allowed: false, reason: 'Invalid entitlement structure' }

        // Log for observability
        logEntitlementCheck(parsed.tenant, parsed.scope)

        // Always allow - real enforcement happens upstream
        RETURN { allowed: true, tenant: parsed.tenant, scope: parsed.scope }

    CATCH error:
        RETURN { allowed: false, reason: 'Entitlement decode error' }
```

### Health and Readiness

```
FUNCTION handleHealth():
    RETURN success(200, {
        status: 'healthy',
        timestamp: NOW()
    })

FUNCTION handleReady():
    // Check upstream dependencies
    vectorClient = getVectorClient()

    TRY:
        vectorClient.ping()
        RETURN success(200, {
            status: 'ready',
            dependencies: {
                ruvvector: 'connected'
            }
        })
    CATCH error:
        RETURN error(503, {
            status: 'not ready',
            dependencies: {
                ruvvector: 'disconnected'
            }
        })
```

---

# A - Architecture

## System Context

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Layer 4: Products                              │
│                    (UI, Dashboards, User Management)                     │
│                         [Not relevant to this service]                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ (eventual consumers via Layer 3)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Layer 3: Orchestration Projects                      │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Orchestrator A │  │  Orchestrator B │  │   Simulators    │         │
│  │   (Workflows)   │  │   (Pipelines)   │  │  (Projections)  │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                    │
└───────────┼────────────────────┼────────────────────┼────────────────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Layer 2: Application Services                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    ruvvector-service                             │   │
│  │                                                                   │   │
│  │   ┌───────────┐    ┌───────────┐    ┌───────────┐              │   │
│  │   │  /ingest  │    │  /query   │    │ /simulate │              │   │
│  │   └─────┬─────┘    └─────┬─────┘    └─────┬─────┘              │   │
│  │         │                │                │                      │   │
│  │         └────────────────┼────────────────┘                      │   │
│  │                          │                                        │   │
│  │                    Vector Client                                  │   │
│  │                          │                                        │   │
│  └──────────────────────────┼────────────────────────────────────────┘   │
│                             │                                            │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                              │ Environment Variables:
                              │ - RUVVECTOR_HOST
                              │ - RUVVECTOR_PORT
                              │ - POSTGRES_CONNECTION_STRING
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Layer 1: Infrastructure                            │
│                                                                          │
│  ┌─────────────────────┐        ┌─────────────────────┐                │
│  │      RuvVector      │        │      Postgres       │                │
│  │   (Vector Store)    │        │   (Metadata/State)  │                │
│  │                     │        │                     │                │
│  │  - Provisioned      │        │  - Provisioned      │                │
│  │  - Scaled           │        │  - Schema owned     │                │
│  │  - Indexed          │        │  - Backed up        │                │
│  └─────────────────────┘        └─────────────────────┘                │
│                                                                          │
│               [Infrastructure owns all provisioning]                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Service Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                       ruvvector-service                            │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    HTTP Server Layer                        │  │
│  │                                                              │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │   │  /health │  │  /ready  │  │ /metrics │  │  /docs   │  │  │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  │                                                              │  │
│  │   ┌──────────────────────────────────────────────────────┐  │  │
│  │   │              API Router (Three Endpoints)             │  │  │
│  │   │                                                        │  │  │
│  │   │   POST /ingest    POST /query    POST /simulate       │  │  │
│  │   └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Middleware Stack                         │  │
│  │                                                              │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐   │  │
│  │  │  Request   │  │   Error    │  │    Observability   │   │  │
│  │  │ Validation │  │  Handler   │  │ (Metrics, Logging) │   │  │
│  │  └────────────┘  └────────────┘  └────────────────────┘   │  │
│  │                                                              │  │
│  │  ┌────────────┐  ┌────────────┐                            │  │
│  │  │Entitlement │  │ Correlation│                            │  │
│  │  │Check (Stub)│  │ ID Extract │                            │  │
│  │  └────────────┘  └────────────┘                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Handler Layer                            │  │
│  │                                                              │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ │  │
│  │  │ IngestHandler  │ │  QueryHandler  │ │SimulateHandler │ │  │
│  │  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ │  │
│  │          │                  │                  │           │  │
│  │          └──────────────────┼──────────────────┘           │  │
│  │                             │                               │  │
│  └─────────────────────────────┼───────────────────────────────┘  │
│                                │                                  │
│                                ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Client Layer                             │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │                  VectorClient                         │  │  │
│  │  │                                                        │  │  │
│  │  │   insert()   query()   similarity()   ping()          │  │  │
│  │  │                                                        │  │  │
│  │  │   Configuration via Environment:                       │  │  │
│  │  │   - RUVVECTOR_HOST                                     │  │  │
│  │  │   - RUVVECTOR_PORT                                     │  │  │
│  │  │   - RUVVECTOR_TIMEOUT                                  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
                                │
                                │ TCP/gRPC
                                ▼
                    ┌───────────────────────┐
                    │      RuvVector        │
                    │  (Infra-Provisioned)  │
                    └───────────────────────┘
```

## Component Breakdown

### HTTP Server Layer

**Responsibilities:**
- Listen on configured port (default: 3000)
- Route requests to appropriate handlers
- Serve health, readiness, and metrics endpoints
- Enforce request timeouts

**Not Responsible For:**
- TLS termination (handled by infrastructure/mesh)
- Authentication (handled by gateway)
- Load balancing (handled by infrastructure)

### Middleware Stack

| Middleware | Purpose | Behavior |
|------------|---------|----------|
| Request Validation | Ensure JSON structure | Reject malformed requests |
| Correlation ID | Extract/generate trace ID | Propagate to all logs |
| Entitlement Check | Validate entitlement header | Stub - always pass if valid format |
| Error Handler | Normalize error responses | Map errors to standard format |
| Observability | Emit metrics and logs | Structured logging, Prometheus metrics |

### Handler Layer

| Handler | Endpoint | Purpose |
|---------|----------|---------|
| IngestHandler | POST /ingest | Accept and store events |
| QueryHandler | POST /query | Retrieve events by criteria |
| SimulateHandler | POST /simulate | Execute simulation queries |

**Handler Contract:**
- Receive validated request
- Invoke VectorClient
- Return structured response
- Never implement business logic

### Client Layer

**VectorClient Responsibilities:**
- Manage connection to RuvVector
- Execute vector operations
- Handle connection errors
- Implement circuit breaker pattern

**Configuration:**
```
RUVVECTOR_HOST=ruvvector.infra.svc.cluster.local
RUVVECTOR_PORT=6379
RUVVECTOR_TIMEOUT=30000
RUVVECTOR_POOL_SIZE=10
```

## Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Service listen port | `3000` |
| `RUVVECTOR_HOST` | RuvVector host | `ruvvector.infra.svc` |
| `RUVVECTOR_PORT` | RuvVector port | `6379` |
| `LOG_LEVEL` | Logging verbosity | `info` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RUVVECTOR_TIMEOUT` | Request timeout (ms) | `30000` |
| `RUVVECTOR_POOL_SIZE` | Connection pool size | `10` |
| `METRICS_ENABLED` | Enable Prometheus metrics | `true` |
| `METRICS_PORT` | Metrics endpoint port | `9090` |
| `SHUTDOWN_TIMEOUT` | Graceful shutdown (ms) | `30000` |

### Environment-Driven Design

This service is **entirely configured via environment variables**. This design:
- Enables infrastructure to control all connectivity
- Supports container orchestration patterns
- Allows different configurations per environment
- Prevents hardcoded values in code

## Stateless Design

This service maintains **no persistent state**:

| Aspect | Behavior |
|--------|----------|
| Process memory | Request-scoped only |
| Connections | Pooled, managed by client |
| Sessions | None |
| Cache | None (Layer 3 responsibility) |
| Files | None written |
| State | All state lives in RuvVector/Postgres |

**Implications:**
- Any instance can handle any request
- Horizontal scaling is trivial
- No leader election or coordination required
- Restart does not lose data

## Deployment Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ruvvector-service Deployment            │   │
│  │                                                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐       │   │
│  │  │  Pod 1    │  │  Pod 2    │  │  Pod N    │       │   │
│  │  │           │  │           │  │           │       │   │
│  │  │ Container │  │ Container │  │ Container │       │   │
│  │  └───────────┘  └───────────┘  └───────────┘       │   │
│  │                                                       │   │
│  │  Resources:                                           │   │
│  │  - CPU: 100m request, 500m limit                     │   │
│  │  - Memory: 128Mi request, 256Mi limit                │   │
│  │                                                       │   │
│  │  Probes:                                              │   │
│  │  - Liveness: GET /health                             │   │
│  │  - Readiness: GET /ready                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Service                           │   │
│  │            ruvvector-service:3000                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

# R - Refinement

## Interface Specifications

### POST /ingest

**Request:**
```typescript
// Headers (Required)
{
  "x-correlation-id": string,      // UUID
  "x-entitlement-context": string, // Base64-encoded entitlement
  "content-type": "application/json"
}

// Body
{
  "eventId": string,               // UUID, required
  "correlationId": string,         // UUID, required
  "timestamp": string,             // ISO 8601, required
  "vector": number[],              // Float array, required, length must match index dimension
  "payload": object,               // Any JSON object, required
  "metadata": {
    "source": string,              // Required
    "type": string,                // Required
    "version": string              // Required, semver format
  }
}
```

**Response (201 Created):**
```typescript
{
  "eventId": string,
  "vectorId": string,
  "status": "stored",
  "timestamp": string,
  "metadata": {
    "correlationId": string,
    "processingTime": number       // Milliseconds
  }
}
```

**Error Responses:**
| Status | Condition | Body |
|--------|-----------|------|
| 400 | Invalid request body | `{ "error": "validation_error", "message": "...", "details": [...] }` |
| 403 | Entitlement check failed | `{ "error": "entitlement_error", "message": "..." }` |
| 502 | RuvVector unavailable | `{ "error": "upstream_error", "message": "..." }` |
| 503 | Service not ready | `{ "error": "service_unavailable", "message": "..." }` |

### POST /query

**Request:**
```typescript
// Headers (Required)
{
  "x-correlation-id": string,
  "x-entitlement-context": string,
  "content-type": "application/json"
}

// Body
{
  "queryVector": number[] | null,  // Optional, for similarity search
  "filters": {                     // Optional
    "source": string | string[],
    "type": string | string[],
    "metadata": object             // Key-value filters
  },
  "timeRange": {                   // Optional
    "start": string,               // ISO 8601
    "end": string                  // ISO 8601
  },
  "limit": number,                 // Optional, default 100, max 1000
  "offset": number                 // Optional, default 0
}
```

**Response (200 OK):**
```typescript
{
  "results": [
    {
      "eventId": string,
      "similarity": number | null,   // Present if queryVector provided
      "timestamp": string,
      "payload": object,
      "metadata": object
    }
  ],
  "pagination": {
    "total": number,
    "limit": number,
    "offset": number,
    "hasMore": boolean
  },
  "metadata": {
    "correlationId": string,
    "queryTime": number              // Milliseconds
  }
}
```

### POST /simulate

**Request:**
```typescript
// Headers (Required)
{
  "x-correlation-id": string,
  "x-entitlement-context": string,
  "content-type": "application/json"
}

// Body
{
  "contextVectors": number[][],    // Required, 1 or more context vectors
  "nearestNeighbors": number,      // Optional, default 10, max 100
  "similarityThreshold": number,   // Optional, default 0.0, range [0, 1]
  "includeMetadata": boolean,      // Optional, default true
  "includeVectors": boolean        // Optional, default false
}
```

**Response (200 OK):**
```typescript
{
  "results": [
    {
      "contextIndex": number,        // Index of input context vector
      "neighbors": [
        {
          "eventId": string,
          "similarity": number,
          "vector": number[] | null, // Present if includeVectors true
          "payload": object,
          "metadata": object | null  // Present if includeMetadata true
        }
      ]
    }
  ],
  "execution": {
    "vectorsProcessed": number,
    "executionTime": number,         // Milliseconds
    "correlationId": string
  }
}
```

## Error Handling

### Error Response Format

All errors follow a consistent format:

```typescript
{
  "error": string,           // Error code (snake_case)
  "message": string,         // Human-readable message
  "correlationId": string,   // Request correlation ID
  "details": any[]           // Optional additional details
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `validation_error` | 400 | Request body failed validation |
| `missing_header` | 400 | Required header missing |
| `invalid_vector_dimension` | 400 | Vector dimension mismatch |
| `entitlement_error` | 403 | Entitlement check failed |
| `upstream_error` | 502 | RuvVector operation failed |
| `upstream_timeout` | 504 | RuvVector operation timed out |
| `service_unavailable` | 503 | Service not ready |
| `internal_error` | 500 | Unexpected internal error |

### Error Handling Strategy

```
Request Error Handling Flow:

1. Request arrives
   │
   ├─ Parse JSON fails? → 400 validation_error
   │
   ├─ Missing required headers? → 400 missing_header
   │
   ├─ Body validation fails? → 400 validation_error with details
   │
   ├─ Entitlement invalid format? → 403 entitlement_error
   │
   ├─ Vector dimension wrong? → 400 invalid_vector_dimension
   │
   └─ Pass to handler
       │
       ├─ RuvVector connection error? → 502 upstream_error
       │
       ├─ RuvVector timeout? → 504 upstream_timeout
       │
       ├─ RuvVector returns error? → 502 upstream_error
       │
       └─ Success → Return response
```

### Circuit Breaker

The VectorClient implements a circuit breaker:

| State | Behavior |
|-------|----------|
| Closed | Normal operation, requests pass through |
| Open | Fail fast, return 503 immediately |
| Half-Open | Allow limited requests to test recovery |

**Configuration:**
```
CIRCUIT_BREAKER_THRESHOLD=5      # Failures before opening
CIRCUIT_BREAKER_TIMEOUT=30000    # Time in open state (ms)
CIRCUIT_BREAKER_RESET=60000      # Time before full reset (ms)
```

## Entitlement Check Stubs

The entitlement check is a **stub only** - no billing logic is implemented.

### What the Stub Does

1. Validates header presence
2. Decodes base64 entitlement context
3. Validates required fields exist (tenant, scope)
4. Logs the check for observability
5. Always returns `allowed: true` if format is valid

### What the Stub Does NOT Do

1. No quota enforcement
2. No rate limiting
3. No billing events
4. No usage metering
5. No tier/plan validation

### Entitlement Context Structure

```typescript
// Decoded entitlement context (for validation only)
{
  "tenant": string,           // Required
  "scope": string,            // Required
  "tier": string,             // Optional, not enforced
  "limits": object            // Optional, not enforced
}
```

### Future Entitlement Integration Points

When billing/entitlements are implemented at the gateway layer, this service will:
- Continue to extract and log entitlement context
- Potentially forward entitlement headers to RuvVector
- NOT implement enforcement logic locally

## Observability Hooks

### Structured Logging

All logs are JSON-formatted with consistent fields:

```typescript
{
  "timestamp": string,         // ISO 8601
  "level": string,             // debug, info, warn, error
  "message": string,
  "correlationId": string,
  "service": "ruvvector-service",
  "context": {
    "endpoint": string,
    "method": string,
    "tenant": string,          // From entitlement
    // Additional context
  }
}
```

### Log Levels

| Level | Usage |
|-------|-------|
| `debug` | Detailed execution flow (disabled in production) |
| `info` | Request/response summaries, startup/shutdown |
| `warn` | Recoverable issues, degraded performance |
| `error` | Failures requiring attention |

### Metrics

Prometheus metrics exposed on `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `ruvvector_requests_total` | Counter | Total requests by endpoint and status |
| `ruvvector_request_duration_seconds` | Histogram | Request latency by endpoint |
| `ruvvector_upstream_errors_total` | Counter | RuvVector errors by type |
| `ruvvector_circuit_breaker_state` | Gauge | Circuit breaker state (0=closed, 1=open) |
| `ruvvector_active_connections` | Gauge | Active RuvVector connections |

### Tracing

The service propagates distributed tracing headers:

| Header | Purpose |
|--------|---------|
| `x-correlation-id` | Application-level request correlation |
| `traceparent` | W3C Trace Context (if present) |
| `x-request-id` | Infrastructure request ID (if present) |

### Health Endpoints

**GET /health** - Liveness probe
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**GET /ready** - Readiness probe
```json
{
  "status": "ready",
  "dependencies": {
    "ruvvector": "connected"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**GET /metrics** - Prometheus metrics
```
# HELP ruvvector_requests_total Total requests
# TYPE ruvvector_requests_total counter
ruvvector_requests_total{endpoint="/ingest",status="201"} 1234
...
```

---

# C - Completion

## Acceptance Criteria

### Functional Acceptance

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| F1 | Service accepts valid ingest requests and returns 201 | Integration test |
| F2 | Service rejects invalid ingest requests with 400 | Unit test |
| F3 | Service accepts valid query requests and returns results | Integration test |
| F4 | Service accepts valid simulate requests and returns results | Integration test |
| F5 | Service returns 403 for invalid entitlement format | Unit test |
| F6 | Service returns 502 when RuvVector unavailable | Integration test with mock |
| F7 | Health endpoint returns 200 when service is running | Smoke test |
| F8 | Ready endpoint returns 503 when RuvVector disconnected | Integration test |

### Non-Functional Acceptance

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| N1 | Service starts in under 5 seconds | Startup timing test |
| N2 | Service uses less than 256MB baseline memory | Resource monitoring |
| N3 | Service handles graceful shutdown within 30 seconds | Shutdown test |
| N4 | Request latency p99 < 100ms (excluding RuvVector time) | Load test |
| N5 | Service maintains stateless behavior | State audit |

### Boundary Acceptance

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| B1 | No business logic in handlers | Code review |
| B2 | No schema ownership code present | Code audit |
| B3 | No billing or metering implementation | Code audit |
| B4 | No authentication implementation | Code audit |
| B5 | No orchestration logic | Code review |
| B6 | All configuration via environment variables | Config audit |

## Verification Steps

### Step 1: Unit Test Suite

Run unit tests to verify request validation and error handling:

```bash
npm test -- --coverage

# Expected coverage thresholds:
# - Statements: 90%+
# - Branches: 85%+
# - Functions: 90%+
# - Lines: 90%+
```

**What unit tests verify:**
- Request body validation
- Header extraction
- Error response formatting
- Entitlement context parsing

### Step 2: Integration Test Suite

Run integration tests against a test RuvVector instance:

```bash
npm run test:integration

# Prerequisites:
# - RUVVECTOR_HOST pointing to test instance
# - RUVVECTOR_PORT configured
```

**What integration tests verify:**
- End-to-end ingest flow
- End-to-end query flow
- End-to-end simulate flow
- Circuit breaker behavior
- Connection pool management

### Step 3: Contract Tests

Verify API contracts match specification:

```bash
npm run test:contract

# Uses OpenAPI spec to validate:
# - Request schemas
# - Response schemas
# - Error response schemas
```

### Step 4: Smoke Tests

Quick verification of deployed service:

```bash
# Health check
curl http://localhost:3000/health
# Expected: {"status":"healthy",...}

# Ready check
curl http://localhost:3000/ready
# Expected: {"status":"ready",...}

# Ingest test
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: test-123" \
  -H "x-entitlement-context: $(echo '{"tenant":"test","scope":"test"}' | base64)" \
  -d '{"eventId":"...", ...}'
# Expected: 201 with vectorId
```

### Step 5: Load Tests

Verify performance under load:

```bash
npm run test:load

# Scenarios:
# - 100 concurrent ingest requests
# - 100 concurrent query requests
# - Mixed workload simulation

# Thresholds:
# - p99 latency < 100ms (service only)
# - Error rate < 0.1%
# - No memory leaks over 10 minute test
```

### Step 6: Boundary Verification

Manual code audit checklist:

- [ ] No files contain billing/metering logic
- [ ] No files contain authentication logic
- [ ] No files contain orchestration logic
- [ ] No files contain schema DDL
- [ ] All external configuration is via environment variables
- [ ] No hardcoded URLs or credentials
- [ ] Handler functions contain no business logic
- [ ] VectorClient is the only external dependency

### Step 7: Documentation Verification

- [ ] README exists with setup instructions
- [ ] API documentation matches implementation
- [ ] Environment variables documented
- [ ] Deployment guide exists
- [ ] No documentation of non-existent features

## Definition of Done

This service is **complete** when:

1. **All acceptance criteria pass** (F1-F8, N1-N5, B1-B6)
2. **All verification steps execute successfully** (Steps 1-7)
3. **No additional features have been added** beyond the three endpoints
4. **Code review confirms adherence to boundaries**
5. **Integration with test RuvVector instance succeeds**
6. **CI/CD pipeline passes all stages**

---

# Appendix A: Explicit Prohibitions

## What This Repository Must Never Contain

### Infrastructure Logic

| Prohibited | Reason |
|------------|--------|
| Database migrations | Schema owned by infra |
| Index creation/management | Vector indexes owned by infra |
| Provisioning scripts | Infrastructure responsibility |
| Scaling logic | Orchestrator responsibility |
| Backup/restore | Infrastructure responsibility |

### Business Logic

| Prohibited | Reason |
|------------|--------|
| Billing calculation | Layer 4 responsibility |
| Usage metering | Gateway responsibility |
| Quota enforcement | Gateway responsibility |
| Authentication | Gateway/mesh responsibility |
| Authorization beyond entitlement check | Gateway responsibility |

### Orchestration Logic

| Prohibited | Reason |
|------------|--------|
| Multi-step workflows | Layer 3 responsibility |
| Saga patterns | Layer 3 responsibility |
| State machines | Layer 3 responsibility |
| Event choreography | Layer 3 responsibility |
| Retry orchestration | Caller responsibility |

### Product Logic

| Prohibited | Reason |
|------------|--------|
| UI components | Layer 4 responsibility |
| User management | Layer 4 responsibility |
| Dashboards | Layer 4 responsibility |
| Notifications | Layer 4 responsibility |
| Reports | Layer 4 responsibility |

### Integration-Specific Logic

| Prohibited | Reason |
|------------|--------|
| Integration-specific endpoints | Violates single interface principle |
| Conditional logic per integration | Creates coupling |
| Integration-specific transformations | Layer 3 responsibility |
| Custom protocols per consumer | Violates standardization |

---

# Appendix B: Layer Boundaries Reference

## Layer 1: Infrastructure

**Owns:**
- RuvVector deployment and configuration
- Postgres deployment and schemas
- Network topology
- Resource provisioning
- Monitoring infrastructure

**Provides to Layer 2:**
- Connection strings via environment variables
- Provisioned and ready services
- Schema contracts

## Layer 2: Application Services (This Service)

**Owns:**
- API endpoints (ingest, query, simulate)
- Request validation
- Response formatting
- Connection management
- Observability emission

**Provides to Layer 3:**
- Stable API contract
- Normalized event interface
- Query capabilities
- Simulation access

**Does NOT Own:**
- Business logic
- Orchestration
- Schema
- State

## Layer 3: Orchestration

**Owns:**
- Workflow definitions
- Business logic
- State machines
- Event processing logic
- Simulation interpretation

**Consumes from Layer 2:**
- Data access via three endpoints
- Event storage
- Query results
- Simulation results

## Layer 4: Products

**Owns:**
- User interfaces
- Product features
- Billing/subscriptions
- User management

**Consumes from Layer 3:**
- Orchestrated capabilities
- Business workflows

**Relationship to Layer 2:**
- Indirect (via Layer 3)
- No direct consumption of this service

---

# Appendix C: Environment Variable Reference

## Required Variables

```bash
# Service configuration
PORT=3000                                    # HTTP listen port

# RuvVector connection
RUVVECTOR_HOST=ruvvector.infra.svc          # RuvVector hostname
RUVVECTOR_PORT=6379                          # RuvVector port

# Logging
LOG_LEVEL=info                               # debug, info, warn, error
```

## Optional Variables

```bash
# RuvVector tuning
RUVVECTOR_TIMEOUT=30000                      # Request timeout (ms)
RUVVECTOR_POOL_SIZE=10                       # Connection pool size

# Circuit breaker
CIRCUIT_BREAKER_THRESHOLD=5                  # Failures before open
CIRCUIT_BREAKER_TIMEOUT=30000                # Open state duration (ms)
CIRCUIT_BREAKER_RESET=60000                  # Reset duration (ms)

# Metrics
METRICS_ENABLED=true                         # Enable Prometheus metrics
METRICS_PORT=9090                            # Metrics endpoint port

# Shutdown
SHUTDOWN_TIMEOUT=30000                       # Graceful shutdown (ms)
```

## Variable Sources

All variables MUST come from:
1. Environment variables set by container orchestrator
2. ConfigMaps/Secrets mounted as environment variables
3. Service mesh sidecar injection

Variables MUST NOT come from:
1. Hardcoded values in code
2. Configuration files in repository
3. External configuration services
4. Command-line arguments

---

*End of SPARC Specification*
