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

export type RuntimeSelectionDebugSample = {
	dx: number;
	dy: number;
	weight: number;
	origin: [number, number, number];
	rayEnd: [number, number, number];
	firstHitPoint?: [number, number, number];
	acceptedHitPoint?: [number, number, number];
	rejectedHitPoint?: [number, number, number];
	candidateKeys: string[];
	isWinningSample: boolean;
};

export type RuntimeSelectionDebugCandidate = {
	key: string;
	nodeId: string;
	nodeName: string;
	materialIndex?: number;
	materialName?: string;
	score: number;
	totalWeight: number;
	hitCount: number;
	bestDistance: number;
	bestDepthRank: number;
	bestFacingScore: number;
	bestSampleDistance: number;
	bestPoint?: [number, number, number];
};

export type RuntimeSelectionDebugSnapshot = {
	samples: RuntimeSelectionDebugSample[];
	candidates: RuntimeSelectionDebugCandidate[];
	winningCandidateKey?: string;
	winningNodeId?: string;
	winningNodeName?: string;
	winningMaterialIndex?: number;
	winningMaterialName?: string;
	winningPoint?: [number, number, number];
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
	bestPoint: THREE.Vector3;
};

type ResolveRuntimeSelectionParams = {
	scene: THREE.Object3D;
	camera: THREE.Camera;
	canvasRect: DOMRect;
	clientX: number;
	clientY: number;
	granularity?: 'node' | 'material';
	anchorToCenterSample?: boolean;
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
	'__mobisim-selection-overlay__',
	'__mobisim-selection-debug__',
	'__mobisim-selection-debug-ray__',
	'__mobisim-selection-debug-hit__',
	'__mobisim-selection-debug-rejected-hit__'
]);

const SELECTION_DEBUG_FAR_DISTANCE = 18;

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

function buildSelectionAggregateKey(
	nodeId: string,
	materialIndex: number | undefined,
	materialName: string | undefined,
	granularity: 'node' | 'material'
): string {
	if (granularity === 'node') {
		return nodeId;
	}

	return buildRuntimeSelectionKey(nodeId, materialIndex, materialName);
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

function toVec3Tuple(vector: THREE.Vector3): [number, number, number] {
	return [vector.x, vector.y, vector.z];
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

function resolveRuntimeSelectionDetailed(
	params: ResolveRuntimeSelectionParams
): {
	selection: ResolvedRuntimeSelection | null;
	debugSnapshot: RuntimeSelectionDebugSnapshot;
} {
	const { scene, camera, canvasRect, clientX, clientY } = params;
	const granularity = params.granularity ?? 'node';
	const anchorToCenterSample = params.anchorToCenterSample ?? false;
	if (canvasRect.width <= 0 || canvasRect.height <= 0) {
		return {
			selection: null,
			debugSnapshot: {
				samples: [],
				candidates: []
			}
		};
	}

	const lookup = buildRuntimeNodeLookup(scene);
	const pointer = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	const aggregates = new Map<string, SelectionCandidateAggregate>();
	const debugSamples: RuntimeSelectionDebugSample[] = [];
	let centerAnchorKey: string | null = null;

	for (const sample of SELECTION_APERTURE_SAMPLES) {
		const isCenterSample = sample.dx === 0 && sample.dy === 0;
		pointer.x = ((clientX + sample.dx - canvasRect.left) / canvasRect.width) * 2 - 1;
		pointer.y = -((clientY + sample.dy - canvasRect.top) / canvasRect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);
		const debugSample: RuntimeSelectionDebugSample = {
			dx: sample.dx,
			dy: sample.dy,
			weight: sample.weight,
			origin: toVec3Tuple(raycaster.ray.origin),
			rayEnd: toVec3Tuple(
				raycaster.ray.origin
					.clone()
					.add(raycaster.ray.direction.clone().multiplyScalar(SELECTION_DEBUG_FAR_DISTANCE))
			),
			candidateKeys: [],
			isWinningSample: false
		};

		const intersections = raycaster.intersectObject(scene, true);

		for (const [depthRank, intersection] of intersections.entries()) {
			if (SELECTION_OVERLAY_NAMES.has(intersection.object.name)) {
				continue;
			}

			if (!debugSample.firstHitPoint) {
				debugSample.firstHitPoint = toVec3Tuple(intersection.point);
				debugSample.rayEnd = debugSample.firstHitPoint;
			}

			const object = intersection.object;
			const materialIndex =
				typeof intersection.face?.materialIndex === 'number'
					? intersection.face.materialIndex
					: undefined;

			if (shouldPassThroughSelectionHit(object, materialIndex)) {
				if (!debugSample.rejectedHitPoint) {
					debugSample.rejectedHitPoint = toVec3Tuple(intersection.point);
				}
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

			const rawMaterialName = resolveSelectionMaterialName(object, materialIndex);
			const materialName = granularity === 'material' ? rawMaterialName : undefined;
			const resolvedMaterialIndex = granularity === 'material' ? materialIndex : undefined;
			const key = buildSelectionAggregateKey(
				nodeId,
				resolvedMaterialIndex,
				materialName,
				granularity
			);

			if (anchorToCenterSample && centerAnchorKey && key !== centerAnchorKey) {
				continue;
			}

			if (anchorToCenterSample && isCenterSample && !centerAnchorKey) {
				centerAnchorKey = key;
			}

			debugSample.acceptedHitPoint ??= toVec3Tuple(intersection.point);
			debugSample.candidateKeys.push(key);
			const sampleDistance = Math.hypot(sample.dx, sample.dy);
			const candidateWeight = sample.weight / (depthRank + 1);
			const facingScore = computeFacingScore(intersection, raycaster.ray.direction);
			const existing = aggregates.get(key);

			if (existing) {
				existing.totalWeight += candidateWeight;
				existing.hitCount += 1;
				if (intersection.distance < existing.bestDistance) {
					existing.bestDistance = intersection.distance;
					existing.bestPoint = intersection.point.clone();
				}
				existing.bestDepthRank = Math.min(existing.bestDepthRank, depthRank);
				existing.bestFacingScore = Math.max(existing.bestFacingScore, facingScore);
				existing.bestSampleDistance = Math.min(existing.bestSampleDistance, sampleDistance);
				continue;
			}

			aggregates.set(key, {
				nodeId,
				runtimeNode,
				materialIndex: resolvedMaterialIndex,
				materialName,
				totalWeight: candidateWeight,
				hitCount: 1,
				bestDistance: intersection.distance,
				bestDepthRank: depthRank,
				bestFacingScore: facingScore,
				bestSampleDistance: sampleDistance,
				bestPoint: intersection.point.clone()
			});

			// In normal node-picking mode, each aperture sample should represent the
			// first valid visible surface under that sample rather than continuing to
			// vote for deeper geometry behind it.
			if (granularity === 'node') {
				break;
			}
		}

		debugSamples.push(debugSample);
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
		return {
			selection: null,
			debugSnapshot: {
				samples: debugSamples,
				candidates: []
			}
		};
	}

	const winningCandidateKey = buildSelectionAggregateKey(
		bestCandidate.nodeId,
		bestCandidate.materialIndex,
		bestCandidate.materialName,
		granularity
	);
	for (const sample of debugSamples) {
		sample.isWinningSample = sample.candidateKeys.includes(winningCandidateKey);
	}

	return {
		selection: {
			nodeId: bestCandidate.nodeId,
			runtimeNode: bestCandidate.runtimeNode,
			materialIndex: bestCandidate.materialIndex,
			materialName: bestCandidate.materialName
		},
			debugSnapshot: {
				samples: debugSamples,
				candidates: rankedCandidates.map((candidate) => ({
					key: buildSelectionAggregateKey(
						candidate.nodeId,
						candidate.materialIndex,
						candidate.materialName,
						granularity
					),
					nodeId: candidate.nodeId,
					nodeName: candidate.runtimeNode.name.trim() || candidate.runtimeNode.type,
				materialIndex: candidate.materialIndex,
				materialName: candidate.materialName,
				score: scoreSelectionCandidate(candidate),
				totalWeight: candidate.totalWeight,
				hitCount: candidate.hitCount,
				bestDistance: candidate.bestDistance,
				bestDepthRank: candidate.bestDepthRank,
				bestFacingScore: candidate.bestFacingScore,
				bestSampleDistance: candidate.bestSampleDistance,
				bestPoint: toVec3Tuple(candidate.bestPoint)
			})),
			winningCandidateKey,
			winningNodeId: bestCandidate.nodeId,
			winningNodeName: bestCandidate.runtimeNode.name.trim() || bestCandidate.runtimeNode.type,
			winningMaterialIndex: bestCandidate.materialIndex,
			winningMaterialName: bestCandidate.materialName,
			winningPoint: toVec3Tuple(bestCandidate.bestPoint)
		}
	};
}

export function resolveRuntimeSelection(params: ResolveRuntimeSelectionParams): ResolvedRuntimeSelection | null {
	return resolveRuntimeSelectionDetailed(params).selection;
}

export function resolveRuntimeSelectionDebug(
	params: ResolveRuntimeSelectionParams
): {
	selection: ResolvedRuntimeSelection | null;
	debugSnapshot: RuntimeSelectionDebugSnapshot;
} {
	return resolveRuntimeSelectionDetailed(params);
}
