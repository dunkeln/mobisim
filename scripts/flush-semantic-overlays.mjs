import { access, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

function resolveSemanticOverlayDirectory() {
	return process.env.SEMANTIC_MANIFEST_LOCAL_DIR
		? path.resolve(process.env.SEMANTIC_MANIFEST_LOCAL_DIR)
		: path.resolve(process.cwd(), 'storage/vehicle-semantic-overlays');
}

function parseArgs(argv) {
	const parsed = {
		asset: null,
		all: false
	};

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === '--all') {
			parsed.all = true;
			continue;
		}

		if (value === '--asset') {
			parsed.asset = argv[index + 1] ?? null;
			index += 1;
		}
	}

	return parsed;
}

async function listOverlayFiles(directory) {
	try {
		await access(directory, constants.R_OK);
	} catch {
		return [];
	}

	const entries = await readdir(directory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.semantic-overlay.json'))
		.map((entry) => path.join(directory, entry.name));
}

async function flushAllOverlays(directory) {
	const overlayFiles = await listOverlayFiles(directory);
	await Promise.all(overlayFiles.map((filePath) => rm(filePath, { force: true })));
	return overlayFiles.length;
}

async function flushOneOverlay(directory, assetId) {
	const targetPath = path.join(directory, `${assetId}.semantic-overlay.json`);
	try {
		await access(targetPath, constants.R_OK);
	} catch {
		return false;
	}

	await rm(targetPath, { force: true });
	return true;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const directory = resolveSemanticOverlayDirectory();

	if (args.all) {
		const deletedCount = await flushAllOverlays(directory);
		console.log(
			JSON.stringify({
				event: 'semantic_overlay_flush',
				scope: 'all',
				directory,
				deletedCount
			})
		);
		return;
	}

	if (args.asset) {
		const deleted = await flushOneOverlay(directory, args.asset);
		console.log(
			JSON.stringify({
				event: 'semantic_overlay_flush',
				scope: 'asset',
				directory,
				assetId: args.asset,
				deleted
			})
		);
		return;
	}

	console.error(
		'Usage: node scripts/flush-semantic-overlays.mjs --all | --asset <vehicle-asset-id>'
	);
	process.exitCode = 1;
}

await main();
