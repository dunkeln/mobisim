import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		allowedHosts: ['298e-2600-1700-88b2-4010-148f-abc7-296c-2c5e.ngrok-free.app']
	},
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		fileParallelism: false,
		passWithNoTests: true,
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
	}
});
