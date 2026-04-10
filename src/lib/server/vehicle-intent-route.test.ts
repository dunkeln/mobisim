import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveVehicleIntentMock = vi.fn();

vi.mock('$lib/server/connectors/vehicle-intents', () => ({
	resolveVehicleIntent: resolveVehicleIntentMock
}));

describe('vehicle intent route', () => {
	beforeEach(() => {
		resolveVehicleIntentMock.mockReset();
	});

	it('returns a deterministic intent payload for a valid asset request', async () => {
		const { POST } = await import('../../routes/api/vehicle-assets/[assetId]/intent/+server');
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			request: 'turn on front lights',
			operations: [
				{
					type: 'set_lighting',
					target: 'front_lighting',
					enabled: true
				}
			],
			summary: 'Front lights enabled.'
		});

		const response = await POST({
			params: { assetId: 'audi_r8' },
			request: new Request('http://localhost/api/vehicle-assets/audi_r8/intent', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					request: 'turn on front lights'
				})
			})
		} as never);

		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'turn on front lights');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			assetId: 'audi_r8',
			request: 'turn on front lights',
			operations: [
				{
					type: 'set_lighting',
					target: 'front_lighting',
					enabled: true
				}
			],
			summary: 'Front lights enabled.'
		});
	});

	it('rejects a missing intent request body field', async () => {
		const { POST } = await import('../../routes/api/vehicle-assets/[assetId]/intent/+server');

		await expect(
			POST({
				params: { assetId: 'audi_r8' },
				request: new Request('http://localhost/api/vehicle-assets/audi_r8/intent', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({})
				})
			} as never)
		).rejects.toMatchObject({
			status: 400
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
	});

	it('rejects an unknown asset id before calling the planner', async () => {
		const { POST } = await import('../../routes/api/vehicle-assets/[assetId]/intent/+server');

		await expect(
			POST({
				params: { assetId: 'not_a_real_asset' },
				request: new Request('http://localhost/api/vehicle-assets/not_a_real_asset/intent', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						request: 'turn on front lights'
					})
				})
			} as never)
		).rejects.toMatchObject({
			status: 404
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
	});
});
