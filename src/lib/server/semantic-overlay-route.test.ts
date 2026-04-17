import { beforeEach, describe, expect, it, vi } from 'vitest';

const readVehicleSemanticOverlayMock = vi.fn();
const buildVehicleSemanticOverlaySnapshotMock = vi.fn();
const deleteVehicleSemanticOverlayMock = vi.fn();

vi.mock('$lib/server/connectors/vehicle-semantic-overlay', () => ({
	readVehicleSemanticOverlay: readVehicleSemanticOverlayMock,
	buildVehicleSemanticOverlaySnapshot: buildVehicleSemanticOverlaySnapshotMock,
	deleteVehicleSemanticOverlay: deleteVehicleSemanticOverlayMock,
	generateVehicleSemanticOverlay: vi.fn(),
	VehicleSemanticOverlayConfigError: class VehicleSemanticOverlayConfigError extends Error {},
	VehicleSemanticOverlayUpstreamError: class VehicleSemanticOverlayUpstreamError extends Error {}
}));

describe('semantic overlay route', () => {
	beforeEach(() => {
		readVehicleSemanticOverlayMock.mockReset();
		buildVehicleSemanticOverlaySnapshotMock.mockReset();
		deleteVehicleSemanticOverlayMock.mockReset();
	});

	it('returns a non-error missing snapshot when no overlay exists yet', async () => {
		const { GET } = await import('../../routes/api/vehicle-assets/[assetId]/semantic-overlay/+server');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		buildVehicleSemanticOverlaySnapshotMock.mockReturnValue({
			overlay: null,
			overlayRevision: null,
			overlayStatus: 'missing'
		});

		const response = await GET({
			params: { assetId: 'audi_r8' }
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			overlay: null,
			overlayRevision: null,
			overlayStatus: 'missing'
		});
	});

	it('deletes an existing overlay and returns a missing snapshot', async () => {
		const { DELETE } = await import(
			'../../routes/api/vehicle-assets/[assetId]/semantic-overlay/+server'
		);
		deleteVehicleSemanticOverlayMock.mockResolvedValue(null);
		buildVehicleSemanticOverlaySnapshotMock.mockReturnValue({
			overlay: null,
			overlayRevision: null,
			overlayStatus: 'missing',
			commandStatus: 'succeeded',
			appliedCommand: 'delete_overlay'
		});

		const response = await DELETE({
			params: { assetId: 'audi_r8' }
		} as never);

		expect(response.status).toBe(200);
		expect(deleteVehicleSemanticOverlayMock).toHaveBeenCalledWith('audi_r8');
		expect(await response.json()).toEqual({
			overlay: null,
			overlayRevision: null,
			overlayStatus: 'missing',
			commandStatus: 'succeeded',
			appliedCommand: 'delete_overlay'
		});
	});
});
