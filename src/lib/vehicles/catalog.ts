export type VehicleAssetId =
	| 'audi_r8'
	| 'acura_nsx_type_s_2022'
	| '2017_lexus_lc_500'
	| '2015_cadillac_escalade_esv'
	| 'isuzu_cargo_base_truck'
	| 'mini_rov_guardian'
	| 'komatsu_hd_465_7eo'
	| 'patria_amv'
	| 'northrop_grumman_b_2_spirit_free'
	| 'arkham_knight_batmobile_advanced_rig';

export type VehicleCatalogEntry = {
	id: VehicleAssetId;
	fileName: string;
	displayName: string;
	title: string;
	description: string;
	lengthMeters: number;
	headlightEmitterPositions?: [number, number, number][];
	bodyPaintMaterialNames?: string[];
	windowTintMaterialNames?: string[];
};

export const VEHICLE_CATALOG: Record<VehicleAssetId, VehicleCatalogEntry> = {
	audi_r8: {
		id: 'audi_r8',
		fileName: 'audi_r8.glb',
		displayName: 'Audi R8',
		title: 'Audi R8',
		description:
			'Mid-engine performance coupe used as the baseline inspection asset for lighting, camera, and material validation.',
		lengthMeters: 4.43,
		headlightEmitterPositions: [
			[19.65, 0.85, 5.22],
			[13.95, 0.85, 5.22]
		],
		bodyPaintMaterialNames: ['phong1'],
		windowTintMaterialNames: ['color_glass', 'glass', 'glass_surr']
	},
	acura_nsx_type_s_2022: {
		id: 'acura_nsx_type_s_2022',
		fileName: '2022_acura_nsx_type_s.glb',
		displayName: '2022 Acura NSX Type S',
		title: '2022 Acura NSX Type S',
		description:
			'Hybrid supercar variant kept in the registry as a secondary hero asset for scale normalization and alternate review shots.',
		lengthMeters: 4.53
	},
	'2017_lexus_lc_500': {
		id: '2017_lexus_lc_500',
		fileName: '2017_lexus_lc_500.glb',
		displayName: '2017 Lexus LC 500',
		title: '2017 Lexus LC 500',
		description:
			'Grand touring coupe retained as a contrast asset for broader body proportions and softer luxury-oriented surfacing.',
		lengthMeters: 4.77
	},
	'2015_cadillac_escalade_esv': {
		id: '2015_cadillac_escalade_esv',
		fileName: '2015_cadillac_escalade_esv.glb',
		displayName: '2015 Cadillac Escalade ESV',
		title: '2015 Cadillac Escalade ESV',
		description:
			'Full-size SUV asset used for large-body proportion checks and alternative inspection framing. Copy and dimensions are editable placeholders.',
		lengthMeters: 5.7
	},
	isuzu_cargo_base_truck: {
		id: 'isuzu_cargo_base_truck',
		fileName: 'isuzu_cargo_base_truck.glb',
		displayName: 'Isuzu Cargo Base Truck',
		title: 'Isuzu Cargo Base Truck',
		description:
			'Cargo truck asset retained for medium-duty commercial vehicle framing and hard-surface inspection checks. Length is an editable placeholder until the source measurement is confirmed.',
		lengthMeters: 6.8
	},
	mini_rov_guardian: {
		id: 'mini_rov_guardian',
		fileName: 'mini-rov_guardian.glb',
		displayName: 'Mini ROV Guardian',
		title: 'Mini ROV Guardian',
		description:
			'Compact ROV asset retained as a small-scale inspection contrast case. Length is an editable placeholder until the source measurement is confirmed.',
		lengthMeters: 1.4
	},
	komatsu_hd_465_7eo: {
		id: 'komatsu_hd_465_7eo',
		fileName: 'komatsu_hd-465-7eo.glb',
		displayName: 'Komatsu HD465-7EO',
		title: 'Komatsu HD465-7EO',
		description:
			'Rigid dump truck asset retained for heavy-equipment scale, framing, and material inspection checks. Length is an editable placeholder until the source measurement is confirmed.',
		lengthMeters: 11.1
	},
	patria_amv: {
		id: 'patria_amv',
		fileName: 'patria_amv.glb',
		displayName: 'Patria AMV',
		title: 'Patria AMV',
		description:
			'Armored vehicle asset retained as a military wheeled-platform contrast case for stance, silhouette, and hard-surface inspection. Length is an editable placeholder until the source measurement is confirmed.',
		lengthMeters: 7.7
	},
	northrop_grumman_b_2_spirit_free: {
		id: 'northrop_grumman_b_2_spirit_free',
		fileName: 'northrop_grumman_b-2_spirit_-_free.glb',
		displayName: 'Northrop Grumman B-2 Spirit',
		title: 'Northrop Grumman B-2 Spirit',
		description:
			'Flying-wing stealth bomber asset retained as an extreme wide-body contrast case for framing, material, and semantic-surface checks.',
		lengthMeters: 21.0
	},
	arkham_knight_batmobile_advanced_rig: {
		id: 'arkham_knight_batmobile_advanced_rig',
		fileName: 'arkham_knight_batmobile_advanced_rig.glb',
		displayName: 'Arkham Knight Batmobile',
		title: 'Arkham Knight Batmobile',
		description:
			'Combat-mode Batmobile asset retained as a heavy stylized contrast vehicle for aggressive proportions and hard-surface inspection. Length is an editable placeholder.',
		lengthMeters: 5.2
	}
};

export const VEHICLE_CATALOG_LIST = Object.values(VEHICLE_CATALOG);
export const defaultVehicleAssetId = VEHICLE_CATALOG_LIST[0]?.id ?? 'audi_r8';

export function isVehicleAssetId(value: string | null): value is VehicleAssetId {
	return value !== null && value in VEHICLE_CATALOG;
}

export function resolveVehicleCatalogEntry(value: string | null | undefined): VehicleCatalogEntry | null {
	if (typeof value !== 'string' || !isVehicleAssetId(value)) {
		return null;
	}

	return VEHICLE_CATALOG[value];
}

export function requireVehicleCatalogEntry(
	value: string | null | undefined,
	label = 'vehicle asset'
): VehicleCatalogEntry {
	const entry = resolveVehicleCatalogEntry(value);
	if (!entry) {
		throw new Error(`Unknown ${label}: ${typeof value === 'string' && value.trim().length > 0 ? value : 'none'}`);
	}

	return entry;
}

export function resolveVehicleAssetId(value: string | null): VehicleAssetId {
	return isVehicleAssetId(value) ? value : defaultVehicleAssetId;
}
