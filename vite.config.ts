import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
	process.env.ASSET_REGISTRY_PUBLIC_BASE_URL ??=
		'https://mobisim-dunkeln-470165263451-us-west-1-an.s3.us-west-1.amazonaws.com';
}

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    allowedHosts: ['busload-speller-cannot.ngrok-free.dev']
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
