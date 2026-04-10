import {
	getSemanticIngressSnapshot,
	subscribeSemanticIngressSamples
} from '$lib/server/connectors/semantic-ingress';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';
import { isVehicleAssetId } from '$lib/vehicles/catalog';
import type { SemanticIngressNumericSample } from '$lib/server/connectors/semantic-ingress/types';

function createSseStream(input: {
	assetId: string;
	ingressId: string;
	initialPayload: object;
}): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function cleanup(): void {
		if (closed) {
			return;
		}

		closed = true;
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		unsubscribe?.();
		unsubscribe = null;
	}

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue = (payload: string): void => {
				if (closed) {
					return;
				}

				try {
					controller.enqueue(encoder.encode(payload));
				} catch {
					cleanup();
				}
			};

			const close = (): void => {
				if (closed) {
					return;
				}

				cleanup();
				try {
					controller.close();
				} catch {
					// Stream was already closed by the runtime; cleanup already ran.
				}
			};

			enqueue(
				`event: semantic-ingress-snapshot\ndata: ${JSON.stringify(input.initialPayload)}\n\n`
			);

			unsubscribe = subscribeSemanticIngressSamples(
				input.assetId as never,
				input.ingressId,
				(sample: SemanticIngressNumericSample) => {
					enqueue(`event: semantic-ingress-sample\ndata: ${JSON.stringify(sample)}\n\n`);
				}
			);

			heartbeat = setInterval(() => {
				enqueue(`event: heartbeat\ndata: {}\n\n`);
			}, 15000);

			timeout = setTimeout(close, 60000);
		},
		cancel() {
			cleanup();
			return undefined;
		}
	});
}

export async function GET({ params, locals }) {
	if (!isVehicleAssetId(params.assetId)) {
		return new Response('Unknown asset id.', { status: 404 });
	}

	const session = await locals.auth();
	const snapshot = await getSemanticIngressSnapshot(
		params.assetId,
		params.ingressId,
		resolveAuthenticatedUserId(session)
	);
	if (!snapshot) {
		return new Response('Semantic ingress binding not found.', { status: 404 });
	}

	return new Response(
		createSseStream({
			assetId: params.assetId,
			ingressId: params.ingressId,
			initialPayload: snapshot
		}),
		{
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache, no-transform',
				connection: 'keep-alive'
			}
		}
	);
}
