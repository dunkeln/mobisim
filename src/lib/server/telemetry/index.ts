import {
	metrics,
	SpanKind,
	SpanStatusCode,
	trace,
	type Attributes,
	type Counter,
	type Histogram,
	type SpanOptions
} from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
	SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
	SEMRESATTRS_SERVICE_NAME,
	SEMRESATTRS_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions';
import { resolveTelemetryConfig, type TelemetryConfig } from './config';

const HTTP_TRACER_NAME = 'mobisim.http.server';
const CHAT_TRACER_NAME = 'mobisim.chat';
const HTTP_METER_NAME = 'mobisim.http.server';

type TelemetryRuntime = {
	enabled: boolean;
	config: TelemetryConfig;
	requestCounter: Counter;
	requestDuration: Histogram;
};

let telemetryStartPromise: Promise<TelemetryRuntime> | null = null;
let shutdownHooksRegistered = false;

function logTelemetryEvent(event: string, attributes: Record<string, unknown>): void {
	console.info(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			system: 'telemetry',
			event,
			...attributes
		})
	);
}

function buildTelemetryRuntime(config: TelemetryConfig): TelemetryRuntime {
	const meter = metrics.getMeter(HTTP_METER_NAME);

	return {
		enabled: config.enabled,
		config,
		requestCounter: meter.createCounter('mobisim.http.server.requests', {
			description: 'Count of traced API requests handled by the SvelteKit server.'
		}),
		requestDuration: meter.createHistogram('mobisim.http.server.duration', {
			description: 'Duration of traced API requests handled by the SvelteKit server.',
			unit: 'ms'
		})
	};
}

function registerShutdownHooks(sdk: NodeSDK, config: TelemetryConfig): void {
	if (shutdownHooksRegistered) {
		return;
	}

	shutdownHooksRegistered = true;

	const shutdown = async (signal: string): Promise<void> => {
		try {
			await sdk.shutdown();
			logTelemetryEvent('shutdown', {
				signal,
				serviceName: config.serviceName
			});
		} catch (error) {
			logTelemetryEvent('shutdown_error', {
				signal,
				serviceName: config.serviceName,
				message: error instanceof Error ? error.message : 'Unknown telemetry shutdown error'
			});
		}
	};

	process.once('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.once('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
}

export function getHttpTracer() {
	return trace.getTracer(HTTP_TRACER_NAME);
}

export function getChatTracer() {
	return trace.getTracer(CHAT_TRACER_NAME);
}

export async function startServerTelemetry(): Promise<TelemetryRuntime> {
	if (telemetryStartPromise) {
		return telemetryStartPromise;
	}

	telemetryStartPromise = (async () => {
		const config = resolveTelemetryConfig();
		if (!config.enabled) {
			return buildTelemetryRuntime(config);
		}

		const sdk = new NodeSDK({
			resource: resourceFromAttributes({
				[SEMRESATTRS_SERVICE_NAME]: config.serviceName,
				[SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion,
				[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.deploymentEnvironment
			}),
			traceExporter: new OTLPTraceExporter({
				url: config.tracesEndpoint
			}),
			metricReader: new PeriodicExportingMetricReader({
				exporter: new OTLPMetricExporter({
					url: config.metricsEndpoint
				}),
				exportIntervalMillis: config.metricsExportIntervalMillis
			}),
			instrumentations: []
		});

		await Promise.resolve(sdk.start());
		registerShutdownHooks(sdk, config);
		logTelemetryEvent('started', {
			serviceName: config.serviceName,
			deploymentEnvironment: config.deploymentEnvironment,
			tracesEndpoint: config.tracesEndpoint,
			metricsEndpoint: config.metricsEndpoint,
			metricsExportIntervalMillis: config.metricsExportIntervalMillis
		});

		return buildTelemetryRuntime(config);
	})();

	return telemetryStartPromise;
}

export async function withActiveSpan<T>(
	tracerName: string,
	spanName: string,
	options: SpanOptions,
	fn: () => Promise<T>
): Promise<T> {
	const tracer = trace.getTracer(tracerName);

	return tracer.startActiveSpan(spanName, options, async (span) => {
		try {
			const result = await fn();
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (error) {
			recordSpanError(error);
			throw error;
		} finally {
			span.end();
		}
	});
}

export function buildRequestSpanAttributes(input: {
	method: string;
	routeId: string | null;
	pathname: string;
}): Attributes {
	return {
		'http.request.method': input.method,
		'http.route': input.routeId ?? input.pathname,
		'url.path': input.pathname,
		'mobisim.route.kind': 'api'
	};
}

export function buildRequestSpanOptions(input: {
	method: string;
	routeId: string | null;
	pathname: string;
}): SpanOptions {
	return {
		kind: SpanKind.SERVER,
		attributes: buildRequestSpanAttributes(input)
	};
}

export function recordSpanError(error: unknown): void {
	const activeSpan = trace.getActiveSpan();
	if (!activeSpan) {
		return;
	}

	if (error instanceof Error) {
		activeSpan.recordException(error);
		activeSpan.setStatus({
			code: SpanStatusCode.ERROR,
			message: error.message
		});
		return;
	}

	activeSpan.setStatus({
		code: SpanStatusCode.ERROR,
		message: 'Unknown error'
	});
	activeSpan.recordException({
		name: 'UnknownError',
		message: String(error)
	});
}
