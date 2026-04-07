import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

export type FooterChatRole = 'user' | 'assistant';

export type FooterChatMessage = {
	role: FooterChatRole;
	content: string;
};

export type FooterChatRequest = {
	message: string;
	history?: FooterChatMessage[];
	assetId?: VehicleAssetId;
};

export type FooterChatVehiclePatchOperation = VehicleInspectionPatchOperation;

export type FooterChatResponse = {
	message: FooterChatMessage;
	model: string;
	vehiclePatchAssetId?: VehicleAssetId;
	vehiclePatchOperations?: FooterChatVehiclePatchOperation[];
};
