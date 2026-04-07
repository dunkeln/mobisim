export type VehicleAssetId =
	| 'audi_r8'
	| 'acura_nsx_type_s_2022'
	| '2017_lexus_lc_500'
	| '2006_chevrolet_camaro_concept_2007_bumblebee'
	| '2015_cadillac_escalade_esv'
	| '2021_koenigsegg_gemera'
	| 'humvee'
	| 'ks_blade_runner_spinner'
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
		bodyPaintMaterialNames: ['Meshpart25Mtl', 'Meshpart36Mtl', 'Meshpart52Mtl'],
		windowTintMaterialNames: ['Meshpart1Mtl', 'Meshpart49Mtl', 'Meshpart65Mtl', 'Meshpart66Mtl']
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
	'2006_chevrolet_camaro_concept_2007_bumblebee': {
		id: '2006_chevrolet_camaro_concept_2007_bumblebee',
		fileName: '2006__chevrolet_camaro_concept__2007_bumblebee.glb',
		displayName: '2006 Chevrolet Camaro Concept',
		title: '2006 Chevrolet Camaro Concept / 2007 Bumblebee',
		description:
			'Transformer-era concept coupe kept as a stylized muscle-car asset. Replace this copy and the measured length if you want a stricter source note.',
		lengthMeters: 4.74
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
	'2021_koenigsegg_gemera': {
		id: '2021_koenigsegg_gemera',
		fileName: '2021_koenigsegg_gemera.glb',
		displayName: '2021 Koenigsegg Gemera',
		title: '2021 Koenigsegg Gemera',
		description:
			'Four-seat hypercar asset kept for low-slung exotic proportions and alternate high-end review framing. Copy is editable placeholder text.',
		lengthMeters: 4.98
	},
	humvee: {
		id: 'humvee',
		fileName: 'humvee.glb',
		displayName: 'Humvee',
		title: 'Humvee',
		description:
			'Military utility vehicle asset retained for boxier off-road proportions and rugged lighting checks. Copy and dimensions are editable placeholders.',
		lengthMeters: 4.6
	},
	ks_blade_runner_spinner: {
		id: 'ks_blade_runner_spinner',
		fileName: 'ks_blade_runner_spinner.glb',
		displayName: 'Blade Runner Spinner',
		title: 'Blade Runner Spinner',
		description:
			'Fictional spinner vehicle retained as a sci-fi contrast asset for silhouette and lighting experiments. Length is an approximate placeholder.',
		lengthMeters: 6.4
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

export function isVehicleAssetId(value: string | null): value is VehicleAssetId {
	return value !== null && value in VEHICLE_CATALOG;
}

export function resolveVehicleAssetId(value: string | null): VehicleAssetId {
	return isVehicleAssetId(value) ? value : (VEHICLE_CATALOG_LIST[0]?.id ?? 'audi_r8');
}
