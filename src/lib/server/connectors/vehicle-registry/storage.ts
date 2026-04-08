import { env } from '$env/dynamic/private';
import path from 'node:path';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

export function resolveLocalAssetDirectory(): string {
	return env.ASSET_REGISTRY_LOCAL_DIR
		? path.resolve(env.ASSET_REGISTRY_LOCAL_DIR)
		: path.resolve(process.cwd(), 'storage/vehicle-assets');
}

export function resolveLocalAssetPath(assetId: VehicleAssetId): string {
	return path.join(resolveLocalAssetDirectory(), VEHICLE_CATALOG[assetId].fileName);
}

export function resolveSemanticOverlayDirectory(): string {
	return env.SEMANTIC_MANIFEST_LOCAL_DIR
		? path.resolve(env.SEMANTIC_MANIFEST_LOCAL_DIR)
		: path.resolve(resolveSemanticStorageRoot(), 'vehicle-semantic-overlays');
}

export function resolveSemanticOverlayPath(assetId: VehicleAssetId): string {
	return path.join(resolveSemanticOverlayDirectory(), `${assetId}.semantic-overlay.json`);
}

export function resolveSemanticGroupDefinitionsPath(): string {
	return path.resolve(resolveSemanticStorageRoot(), 'semantic-group-definitions.json');
}

export function resolveSemanticAssignmentsDirectory(assetId: VehicleAssetId): string {
	return path.resolve(resolveSemanticAssignmentsRootDirectory(), assetId);
}

export function resolveSemanticAssignmentsRootDirectory(): string {
	return path.resolve(resolveSemanticStorageRoot(), 'semantic-assignments');
}

export function resolveSemanticAssignmentsPath(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return path.join(resolveSemanticAssignmentsDirectory(assetId), `${structuralGeneratedAt}.json`);
}

export function resolveSemanticProposalsDirectory(assetId: VehicleAssetId): string {
	return path.resolve(resolveSemanticStorageRoot(), 'semantic-proposals', assetId);
}

export function resolveSemanticProposalsPath(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return path.join(resolveSemanticProposalsDirectory(assetId), `${structuralGeneratedAt}.json`);
}

export function resolveSemanticIngressDirectory(assetId: VehicleAssetId): string {
	return path.resolve(resolveSemanticIngressRootDirectory(), assetId);
}

export function resolveSemanticIngressRootDirectory(): string {
	return path.resolve(resolveSemanticStorageRoot(), 'semantic-ingress');
}

export function resolveSemanticIngressPath(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return path.join(resolveSemanticIngressDirectory(assetId), `${structuralGeneratedAt}.json`);
}

export function resolveVersionedSemanticOverlayPath(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return path.join(resolveSemanticOverlayDirectory(), `${assetId}.${structuralGeneratedAt}.json`);
}

function resolveSemanticStorageRoot(): string {
	return env.SEMANTIC_MANIFEST_LOCAL_DIR
		? path.resolve(env.SEMANTIC_MANIFEST_LOCAL_DIR)
		: path.resolve(process.cwd(), 'storage');
}
