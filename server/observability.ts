import type { NextFunction, Request, Response } from 'express';
import { context, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import pino from 'pino';
import pinoHttp from 'pino-http';
import client from 'prom-client';

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'app-proveedores-api';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: serviceName,
    env: process.env.NODE_ENV ?? 'development'
  }
});

export const httpLogger = pinoHttp({
  logger,
  customProps: () => {
    const span = trace.getSpan(context.active());
    return {
      traceId: span?.spanContext().traceId
    };
  }
});

client.collectDefaultMetrics({ prefix: 'conectapro_' });

const httpDuration = new client.Histogram({
  name: 'conectapro_http_request_duration_seconds',
  help: 'Duracion de requests HTTP por ruta y status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

const activeSseConnections = new client.Gauge({
  name: 'conectapro_sse_active_connections',
  help: 'Conexiones SSE activas'
});

export function setActiveSseConnections(value: number) {
  activeSseConnections.set(value);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({
      method: req.method,
      route: req.route?.path?.toString() ?? req.path,
      status: String(res.statusCode)
    });
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response) {
  res.setHeader('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}

export function startTelemetry() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/metrics`
      })
    }),
    instrumentations: [getNodeAutoInstrumentations()]
  });

  sdk.start();
  logger.info('OpenTelemetry iniciado');
  return sdk;
}
