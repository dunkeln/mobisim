import { json } from '@sveltejs/kit';
import {
	assignSemanticIngress,
	listSemanticIngressBindings
} from '$lib/server/connectors/semantic-ingress';
import { isVehicleAssetId } from '$lib/vehicles/catalog';
import type { AssignSemanticIngressInput } from '$lib/server/connectors/semantic-ingress/types';

export async function GET({ params }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	try {
		const store = await listSemanticIngressBindings(params.assetId);
		return json(store);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to list semantic ingress bindings.' },
			{ status: 500 }
		);
	}
}

export async function POST({ params, request }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	let payload: Omit<AssignSemanticIngressInput, 'assetId'>;
	try {
		payload = (await request.json()) as Omit<AssignSemanticIngressInput, 'assetId'>;
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	if (
		(payload.targetType !== 'semantic_group' && payload.targetType !== 'semantic_node') ||
		typeof payload.targetId !== 'string' ||
		(payload.transport !== 'rest_sse' && payload.transport !== 'stream')
	) {
		return json({ error: 'Invalid semantic ingress payload.' }, { status: 400 });
	}

	try {
		const binding = await assignSemanticIngress({
			assetId: params.assetId,
			targetType: payload.targetType,
			targetId: payload.targetId.trim(),
			targetLabel: typeof payload.targetLabel === 'string' ? payload.targetLabel.trim() || undefined : undefined,
			transport: payload.transport,
			assignedBy: payload.assignedBy === 'model' ? 'model' : 'user'
		});
		return json(binding);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to assign semantic ingress.' },
			{ status: 400 }
		);
	}
}
