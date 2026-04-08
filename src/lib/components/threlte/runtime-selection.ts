import * as THREE from 'three';

export type RuntimeNodeLookup = {
	nodeById: Map<string, THREE.Object3D>;
	nodeIdByObject: Map<THREE.Object3D, string>;
};

export type ResolvedRuntimeSelection = {
	nodeId: string;
	runtimeNode: THREE.Object3D;
	materialIndex?: number;
	materialName?: string;
};

type SelectionRaySample = {
	dx: number;
	dy: number;
	weight: number;
};

type SelectionCandidateAggregate = {
	nodeId: string;
	runtimeNode: THREE.Object3D;
	materialIndex?: number;
	materialName?: string;
	totalWeight: number;
	hitCount: number;
	bestDistance: number;
	bestDepthRank: number;
	bestFacingScore: number;
	bestSampleDistance: number;
};

type ResolveRuntimeSelectionParams = {
	scene: THREE.Object3D;
	camera: THREE.Camera;
	canvasRect: DOMRect;
	clientX: number;
	clientY: number;
};

const SELECTION_PASSTHROUGH_ALPHA_THRESHOLD = 0.12;
const SELECTION_APERTURE_SAMPLES: SelectionRaySample[] = [
	{ dx: 0, dy: 0, weight: 1.85 },
	{ dx: -6, dy: 0, weight: 0.9 },
	{ dx: 6, dy: 0, weight: 0.9 },
	{ dx: 0, dy: -6, weight: 0.9 },
	{ dx: 0, dy: 6, weight: 0.9 },
	{ dx: -4, dy: -4, weight: 0.58 },
	{ dx: 4, dy: -4, weight: 0.58 },
	{ dx: -4, dy: 4, weight: 0.58 },
	{ dx: 4, dy: 4, weight: 0.58 }
];
const SELECTION_OVERLAY_NAMES = new Set([
	'__mobisim-highlight-overlay__',
	'__mobisim-selection-overlay__'
]);

function createNodeId(index: number): string {
	return `node-${index}`;
}

function hasOpacityProperty(material: THREE.Material): material is THREE.Material & {
	opacity: number;
	transparent: boolean;
	side: THREE.Side;
} {
	return 'opacity' in material && 'transparent' in material && 'side' in material;
}

function resolveIntersectionMaterial(
	object: THREE.Object3D,
	materialIndex: number | undefined
): THREE.Material | null {
	if (!(object instanceof THREE.Mesh)) {
		return null;
	}

	if (Array.isArray(object.material)) {
		if (typeof materialIndex !== 'number') {
			return object.material[0] ?? null;
		}

		return object.material[materialIndex] ?? null;
	}

	return object.material ?? null;
}

function resolveSelectionMaterialName(
	object: THREE.Object3D,
	materialIndex: number | undefined
): string | undefined {
	const material = resolveIntersectionMaterial(object, materialIndex);
	return material?.name || undefined;
}

function shouldPassThroughSelectionHit(
	object: THREE.Object3D,
	materialIndex: number | undefined
): boolean {
	const material = resolveIntersectionMaterial(object, materialIndex);
	if (!material || !hasOpacityProperty(material)) {
		return false;
	}

	return material.opacity <= SELECTION_PASSTHROUGH_ALPHA_THRESHOLD;
}

function buildRuntimeSelectionKey(
	nodeId: string,
	materialIndex: number | undefined,
	materialName: string | undefined
): string {
	return [
		nodeId,
		typeof materialIndex === 'number' ? `slot:${materialIndex}` : 'slot:none',
		materialName?.trim() ? `material:${materialName.trim()}` : 'material:none'
	].join('|');
}

function computeFacingScore(
	intersection: THREE.Intersection<THREE.Object3D>,
	rayDirection: THREE.Vector3
): number {
	if (!intersection.face) {
		return 0;
	}

	const worldNormal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld);
	return Math.max(0, -worldNormal.dot(rayDirection));
}

function scoreSelectionCandidate(candidate: SelectionCandidateAggregate): number {
	return (
		candidate.totalWeight * 120 +
		candidate.hitCount * 20 +
		candidate.bestFacingScore * 12 -
		candidate.bestDistance * 0.8 -
		candidate.bestDepthRank * 14 -
		candidate.bestSampleDistance * 6
	);
}

export function buildRuntimeNodeLookup(scene: THREE.Object3D): RuntimeNodeLookup {
	const nodeById = new Map<string, THREE.Object3D>();
	const nodeIdByObject = new Map<THREE.Object3D, string>();
	let nextNodeIndex = 0;

	scene.traverse((node) => {
		if (node === scene) {
			return;
		}

		const nodeId = createNodeId(nextNodeIndex);
		nextNodeIndex += 1;
		nodeById.set(nodeId, node);
		nodeIdByObject.set(node, nodeId);
	});

	return {
		nodeById,
		nodeIdByObject
	};
}

export function buildRuntimeNodePath(node: THREE.Object3D, root: THREE.Object3D): string {
	const parts: string[] = [];
	let current: THREE.Object3D | null = node;

	while (current && current !== root) {
		parts.unshift(current.name.trim() || current.type);
		current = current.parent;
	}

	if (current === root) {
		parts.unshift(root.name.trim() || 'Scene');
	}

	return parts.join('/');
}

function resolveSelectableRuntimeNodeId(
	lookup: RuntimeNodeLookup,
	root: THREE.Object3D,
	object: THREE.Object3D
): string | null {
	let current: THREE.Object3D | null = object;

	while (current) {
		const nodeId = lookup.nodeIdByObject.get(current);
		if (nodeId) {
			return nodeId;
		}

		if (current === root) {
			break;
		}

		current = current.parent;
	}

	return null;
}

export function resolveRuntimeSelection(
	params: ResolveRuntimeSelectionParams
): ResolvedRuntimeSelection | null {
	const { scene, camera, canvasRect, clientX, clientY } = params;
	if (canvasRect.width <= 0 || canvasRect.height <= 0) {
		return null;
	}

	const lookup = buildRuntimeNodeLookup(scene);
	const pointer = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	const aggregates = new Map<string, SelectionCandidateAggregate>();

	for (const sample of SELECTION_APERTURE_SAMPLES) {
		pointer.x = ((clientX + sample.dx - canvasRect.left) / canvasRect.width) * 2 - 1;
		pointer.y = -((clientY + sample.dy - canvasRect.top) / canvasRect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);

		const intersections = raycaster
			.intersectObject(scene, true)
			.filter((intersection) => !SELECTION_OVERLAY_NAMES.has(intersection.object.name));

		for (const [depthRank, intersection] of intersections.entries()) {
			const object = intersection.object;
			const materialIndex =
				typeof intersection.face?.materialIndex === 'number'
					? intersection.face.materialIndex
					: undefined;

			if (shouldPassThroughSelectionHit(object, materialIndex)) {
				continue;
			}

			const nodeId = resolveSelectableRuntimeNodeId(lookup, scene, object);
			if (!nodeId) {
				continue;
			}

			const runtimeNode = lookup.nodeById.get(nodeId);
			if (!runtimeNode) {
				continue;
			}

			const materialName = resolveSelectionMaterialName(object, materialIndex);
			const key = buildRuntimeSelectionKey(nodeId, materialIndex, materialName);
			const sampleDistance = Math.hypot(sample.dx, sample.dy);
			const candidateWeight = sample.weight / (depthRank + 1);
			const facingScore = computeFacingScore(intersection, raycaster.ray.direction);
			const existing = aggregates.get(key);

			if (existing) {
				existing.totalWeight += candidateWeight;
				existing.hitCount += 1;
				existing.bestDistance = Math.min(existing.bestDistance, intersection.distance);
				existing.bestDepthRank = Math.min(existing.bestDepthRank, depthRank);
				existing.bestFacingScore = Math.max(existing.bestFacingScore, facingScore);
				existing.bestSampleDistance = Math.min(existing.bestSampleDistance, sampleDistance);
				continue;
			}

			aggregates.set(key, {
				nodeId,
				runtimeNode,
				materialIndex,
				materialName,
				totalWeight: candidateWeight,
				hitCount: 1,
				bestDistance: intersection.distance,
				bestDepthRank: depthRank,
				bestFacingScore: facingScore,
				bestSampleDistance: sampleDistance
			});
		}
	}

	const rankedCandidates = Array.from(aggregates.values()).sort((left, right) => {
		const scoreDelta = scoreSelectionCandidate(right) - scoreSelectionCandidate(left);
		if (Math.abs(scoreDelta) > 0.001) {
			return scoreDelta;
		}

		if (left.bestDepthRank !== right.bestDepthRank) {
			return left.bestDepthRank - right.bestDepthRank;
		}

		if (left.bestDistance !== right.bestDistance) {
			return left.bestDistance - right.bestDistance;
		}

		return left.nodeId.localeCompare(right.nodeId);
	});

	const bestCandidate = rankedCandidates[0];
	if (!bestCandidate) {
		return null;
	}

	return {
		nodeId: bestCandidate.nodeId,
		runtimeNode: bestCandidate.runtimeNode,
		materialIndex: bestCandidate.materialIndex,
		materialName: bestCandidate.materialName
	};
}
