export type VehicleAssetId =
  | 'audi_r8'
  | 'acura_nsx_type_s_2022'
  | '2017_lexus_lc_500'
  | '2006_chevrolet_camaro_concept_2007_bumblebee'
  | '2015_cadillac_escalade_esv'
  | '2021_koenigsegg_gemera'
  | 'cl1m09_futuristic_heavy_duty_truck_concept'
  | 'humvee'
  | 'ks_blade_runner_spinner';

export type VehicleCatalogEntry = {
	id: VehicleAssetId;
	fileName: string;
	displayName: string;
	title: string;
	description: string;
	lengthMeters: number;
};

export const VEHICLE_CATALOG: Record<VehicleAssetId, VehicleCatalogEntry> = {
  audi_r8: {
    id: 'audi_r8',
    fileName: 'audi_r8.glb',
    displayName: 'Audi R8',
		title: 'Audi R8',
		description:
			'Mid-engine performance coupe used as the baseline inspection asset for lighting, camera, and material validation.',
		lengthMeters: 4.43
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
  cl1m09_futuristic_heavy_duty_truck_concept: {
    id: 'cl1m09_futuristic_heavy_duty_truck_concept',
    fileName: 'cl1m09_-_futuristic_heavy-duty_truck_concept.glb',
    displayName: 'Futuristic Heavy-Duty Truck Concept',
		title: 'CL1M09 Futuristic Heavy-Duty Truck Concept',
		description:
			'Concept truck asset used for large commercial-vehicle silhouettes and sci-fi industrial surface studies. Copy and measured length are placeholders.',
		lengthMeters: 7.4
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
	}
};

export const VEHICLE_CATALOG_LIST = Object.values(VEHICLE_CATALOG);
