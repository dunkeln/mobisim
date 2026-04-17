import { describe, expect, it } from 'vitest';
import { resolveTelemetryConfig } from './config';

describe('resolveTelemetryConfig', () => {
	it('defaults to a disabled local OTLP config', () => {
		const config = resolveTelemetryConfig({});

		expect(config).toEqual({
			enabled: false,
			serviceName: 'mobisim-web',
			serviceVersion: '0.0.1',
			deploymentEnvironment: 'local',
			tracesEndpoint: 'http://127.0.0.1:4318/v1/traces',
			metricsEndpoint: 'http://127.0.0.1:4318/v1/metrics',
			metricsExportIntervalMillis: 15000
		});
	});

	it('derives trace and metric endpoints from the OTLP base endpoint', () => {
		const config = resolveTelemetryConfig({
			OTEL_ENABLED: 'true',
			OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-gateway:4318/',
			OTEL_SERVICE_NAME: 'mobisim-api',
			OTEL_SERVICE_VERSION: '1.2.3',
			OTEL_DEPLOYMENT_ENVIRONMENT: 'staging',
			OTEL_METRIC_EXPORT_INTERVAL: '5000'
		});

		expect(config).toEqual({
			enabled: true,
			serviceName: 'mobisim-api',
			serviceVersion: '1.2.3',
			deploymentEnvironment: 'staging',
			tracesEndpoint: 'http://otel-gateway:4318/v1/traces',
			metricsEndpoint: 'http://otel-gateway:4318/v1/metrics',
			metricsExportIntervalMillis: 5000
		});
	});
});
