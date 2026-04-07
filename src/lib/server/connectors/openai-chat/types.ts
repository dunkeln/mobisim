import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

export type FooterChatRole = 'user' | 'assistant';

export type FooterChatMessage = {
	role: FooterChatRole;
	content: string;
};

export type FooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
};

export type FooterChatVehiclePatchOperation = VehicleInspectionPatchOperation;

export type FooterChatResponse = {
	message: FooterChatMessage;
	model: string;
	vehiclePatchAssetId?: VehicleAssetId;
	vehiclePatchLabel?: string;
	vehiclePatchOperations?: FooterChatVehiclePatchOperation[];
};
