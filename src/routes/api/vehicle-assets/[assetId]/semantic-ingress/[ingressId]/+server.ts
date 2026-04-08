import { json } from '@sveltejs/kit';
import {
	getSemanticIngressSnapshot,
	ingestSemanticIngressSamples
} from '$lib/server/connectors/semantic-ingress';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

export async function GET({ params }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	const snapshot = await getSemanticIngressSnapshot(params.assetId, params.ingressId);
	if (!snapshot) {
		return json({ error: 'Semantic ingress binding not found.' }, { status: 404 });
	}

	return json(snapshot);
}

export async function POST({ params, request }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	let payload: { samples?: unknown[]; sample?: unknown };
	try {
		payload = (await request.json()) as { samples?: unknown[]; sample?: unknown };
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const samples = Array.isArray(payload.samples)
		? payload.samples
		: payload.sample
			? [payload.sample]
			: [];

	try {
		const snapshot = await ingestSemanticIngressSamples({
			assetId: params.assetId,
			ingressId: params.ingressId,
			samples: samples as never[]
		});
		return json(snapshot);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to ingest semantic telemetry.' },
			{ status: 400 }
		);
	}
}
