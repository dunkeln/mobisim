import { json } from '@sveltejs/kit';
import {
	getSemanticIngressSnapshot,
	ingestSemanticIngressSamples,
	removeSemanticIngressBinding
} from '$lib/server/connectors/semantic-ingress';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

export async function GET({ params, locals }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	const session = await locals.auth();
	const snapshot = await getSemanticIngressSnapshot(
		params.assetId,
		params.ingressId,
		resolveAuthenticatedUserId(session)
	);
	if (!snapshot) {
		return json({ error: 'Semantic ingress binding not found.' }, { status: 404 });
	}

	return json(snapshot);
}

export async function POST({ params, request, locals }) {
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
		const session = await locals.auth();
		const snapshot = await ingestSemanticIngressSamples({
			assetId: params.assetId,
			ingressId: params.ingressId,
			samples: samples as never[],
			userId: resolveAuthenticatedUserId(session)
		});
		return json(snapshot);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to ingest semantic telemetry.' },
			{ status: 400 }
		);
	}
}

export async function DELETE({ params, locals }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	try {
		const session = await locals.auth();
		const removed = await removeSemanticIngressBinding(
			params.assetId,
			params.ingressId,
			resolveAuthenticatedUserId(session)
		);
		if (!removed) {
			return json({ error: 'Semantic ingress binding not found.' }, { status: 404 });
		}

		return json({ removed: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to remove semantic ingress binding.' },
			{ status: 400 }
		);
	}
}
