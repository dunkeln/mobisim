export type TelemetryConfig = {
	enabled: boolean;
	serviceName: string;
	serviceVersion: string;
	deploymentEnvironment: string;
	tracesEndpoint: string;
	metricsEndpoint: string;
	metricsExportIntervalMillis: number;
};

const DEFAULT_OTLP_BASE_URL = 'http://127.0.0.1:4318';
const DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS = 15000;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined) {
		return defaultValue;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
		return true;
	}

	if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
		return false;
	}

	return defaultValue;
}

function parseInteger(value: string | undefined, defaultValue: number): number {
	if (!value) {
		return defaultValue;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function normalizeBaseUrl(value: string | undefined): string {
	const resolved = value?.trim() || DEFAULT_OTLP_BASE_URL;
	return resolved.endsWith('/') ? resolved.slice(0, -1) : resolved;
}

export function resolveTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
	const otlpBaseUrl = normalizeBaseUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT);
	const tracesEndpoint =
		env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || `${otlpBaseUrl}/v1/traces`;
	const metricsEndpoint =
		env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() || `${otlpBaseUrl}/v1/metrics`;

	return {
		enabled: parseBoolean(env.OTEL_ENABLED, false),
		serviceName: env.OTEL_SERVICE_NAME?.trim() || 'mobisim-web',
		serviceVersion: env.OTEL_SERVICE_VERSION?.trim() || '0.0.1',
		deploymentEnvironment: env.OTEL_DEPLOYMENT_ENVIRONMENT?.trim() || 'local',
		tracesEndpoint,
		metricsEndpoint,
		metricsExportIntervalMillis: parseInteger(
			env.OTEL_METRIC_EXPORT_INTERVAL,
			DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS
		)
	};
}
