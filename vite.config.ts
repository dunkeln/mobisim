import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
  server: {
    allowedHosts: ['b3c7-2600-1700-88b2-4010-c87-d99f-dce6-1c0e.ngrok-free.app']
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
