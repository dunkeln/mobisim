import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { handle as authHandle } from './auth';
import {
	buildRequestSpanAttributes,
	buildRequestSpanOptions,
	getHttpTracer,
	recordSpanError,
	startServerTelemetry
} from '$lib/server/telemetry';

function shouldTraceRequest(pathname: string): boolean {
	return pathname.startsWith('/api/');
}

const authorizationHandle: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/api/')) {
		return resolve(event);
	}

	const session = await event.locals.auth();
	if (!session?.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: {
				'content-type': 'application/json'
			}
		});
	}

	return resolve(event);
};

const telemetryHandle: Handle = async ({ event, resolve }) => {
	const telemetry = await startServerTelemetry();
	if (!telemetry.enabled || !shouldTraceRequest(event.url.pathname)) {
		return resolve(event);
	}

	const tracer = getHttpTracer();
	const spanName = `${event.request.method} ${event.route.id ?? event.url.pathname}`;
	const baseAttributes = buildRequestSpanAttributes({
		method: event.request.method,
		routeId: event.route.id,
		pathname: event.url.pathname
	});
	const startedAt = performance.now();

	return tracer.startActiveSpan(
		spanName,
		buildRequestSpanOptions({
			method: event.request.method,
			routeId: event.route.id,
			pathname: event.url.pathname
		}),
		async (span) => {
			try {
				const response = await resolve(event);
				const durationMillis = performance.now() - startedAt;
				const attributes = {
					...baseAttributes,
					'http.response.status_code': response.status
				};

				telemetry.requestCounter.add(1, attributes);
				telemetry.requestDuration.record(durationMillis, attributes);
				span.setAttribute('http.response.status_code', response.status);

				if (response.status >= 500) {
					span.setStatus({
						code: 2,
						message: `HTTP ${response.status}`
					});
				}

				return response;
			} catch (error) {
				recordSpanError(error);
				throw error;
			} finally {
				span.end();
			}
		}
	);
};

export const handle: Handle = sequence(authHandle, authorizationHandle, telemetryHandle);
