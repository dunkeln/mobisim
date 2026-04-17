import { env } from '$env/dynamic/private';
import { requireVehicleCatalogEntry, type VehicleAssetId } from '$lib/vehicles/catalog';

const ASSET_PREFIX = 'vehicle-assets';

function stripTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function resolveAssetBaseUrl(): string {
	const baseUrl = env.ASSET_REGISTRY_PUBLIC_BASE_URL?.trim();
	if (!baseUrl) {
		throw new Error('ASSET_REGISTRY_PUBLIC_BASE_URL is required.');
	}

	return stripTrailingSlash(baseUrl);
}

export function resolveVehicleAssetDownloadUrl(assetId: VehicleAssetId): string {
	return `${resolveAssetBaseUrl()}/${ASSET_PREFIX}/${requireVehicleCatalogEntry(assetId, 'vehicle asset').fileName}`;
}

export function resolveStorageBucketName(): string {
	const bucketName = env.ASSET_BUCKET_NAME?.trim();
	if (!bucketName) {
		throw new Error('ASSET_BUCKET_NAME is required.');
	}

	return bucketName;
}

export function resolveSemanticGroupDefinitionsKey(): string {
	return 'semantic-group-definitions.json';
}

export function resolveSemanticOverlayKey(assetId: VehicleAssetId): string {
	return `vehicle-semantic-overlays/${assetId}.semantic-overlay.json`;
}

export function resolveVersionedSemanticOverlayKey(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return `vehicle-semantic-overlays/${assetId}.${structuralGeneratedAt}.json`;
}

export function resolveSemanticAssignmentsPrefix(assetId: VehicleAssetId): string {
	return `semantic-assignments/${assetId}/`;
}

export function resolveSemanticAssignmentsKey(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return `${resolveSemanticAssignmentsPrefix(assetId)}${structuralGeneratedAt}.json`;
}

export function resolveSemanticProposalsPrefix(assetId: VehicleAssetId): string {
	return `semantic-proposals/${assetId}/`;
}

export function resolveSemanticProposalsKey(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): string {
	return `${resolveSemanticProposalsPrefix(assetId)}${structuralGeneratedAt}.json`;
}
