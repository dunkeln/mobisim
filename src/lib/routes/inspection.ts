import { resolveVehicleAssetId, type VehicleAssetId } from '$lib/vehicles/catalog';

const INSPECTION_ROUTE_PREFIX = '/app/inspect';

function readInspectionAssetId(pathname: string): string | null {
	const routeMatch = /^\/app\/inspect\/([^/]+)$/.exec(pathname);
	return routeMatch?.[1] ?? null;
}

export function resolveInspectionAssetId(url: URL): VehicleAssetId {
	return resolveVehicleAssetId(readInspectionAssetId(url.pathname) ?? url.searchParams.get('asset'));
}

export function buildInspectionRoute(assetId: VehicleAssetId, searchParams?: URLSearchParams): string {
	const nextSearchParams = new URLSearchParams(searchParams);
	nextSearchParams.delete('asset');

	const search = nextSearchParams.toString();
	return search.length > 0
		? `${INSPECTION_ROUTE_PREFIX}/${assetId}?${search}`
		: `${INSPECTION_ROUTE_PREFIX}/${assetId}`;
}
