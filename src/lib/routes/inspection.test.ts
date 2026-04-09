import { describe, expect, it } from 'vitest';
import { buildInspectionRoute, resolveInspectionAssetId } from './inspection';

describe('inspection routes', () => {
	it('resolves the asset id from the canonical inspection path', () => {
		const url = new URL('https://mobisim.test/app/inspect/2017_lexus_lc_500?panel=semantic');
		expect(resolveInspectionAssetId(url)).toBe('2017_lexus_lc_500');
	});

	it('falls back to the legacy query parameter for old links', () => {
		const url = new URL('https://mobisim.test/?asset=patria_amv');
		expect(resolveInspectionAssetId(url)).toBe('patria_amv');
	});

	it('builds canonical inspection paths and strips the legacy asset query param', () => {
		const searchParams = new URLSearchParams('asset=audi_r8&panel=semantic');
		expect(buildInspectionRoute('2015_cadillac_escalade_esv', searchParams)).toBe(
			'/app/inspect/2015_cadillac_escalade_esv?panel=semantic'
		);
	});
});
