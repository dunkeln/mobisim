import { json } from '@sveltejs/kit';
import {
	assignSemanticIngress,
	listSemanticIngressBindings
} from '$lib/server/connectors/semantic-ingress';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';
import { isVehicleAssetId } from '$lib/vehicles/catalog';
import type { AssignSemanticIngressInput } from '$lib/server/connectors/semantic-ingress/types';

export async function GET({ params, locals, url }) {
	if (!isVehicleAssetId(params.assetId)) {
		return json({ error: 'Unknown asset id.' }, { status: 404 });
	}

	try {
		const session = await locals.auth();
		const targetType = url.searchParams.get('targetType');
		const targetId = url.searchParams.get('targetId');
		const store = await listSemanticIngressBindings(params.assetId, {
			userId: resolveAuthenticatedUserId(session),
			targetType:
				targetType === 'semantic_group' || targetType === 'semantic_node' ? targetType : undefined,
			targetId: typeof targetId === 'string' && targetId.trim().length > 0 ? targetId.trim() : undefined
		});
		return json(store);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to list semantic ingress bindings.' },
			{ status: 500 }
		);
	}
}

export async function POST({ params, request, locals }) {
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
		const session = await locals.auth();
		const binding = await assignSemanticIngress({
			assetId: params.assetId,
			targetType: payload.targetType,
			targetId: payload.targetId.trim(),
			targetLabel: typeof payload.targetLabel === 'string' ? payload.targetLabel.trim() || undefined : undefined,
			transport: payload.transport,
			assignedBy: payload.assignedBy === 'model' ? 'model' : 'user',
			userId: resolveAuthenticatedUserId(session)
		});
		return json(binding);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to assign semantic ingress.' },
			{ status: 400 }
		);
	}
}
