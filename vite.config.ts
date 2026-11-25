import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /ocean-life-atlas/; set BASE=/ for a custom domain.
export default defineConfig({
  base: process.env.BASE ?? '/ocean-life-atlas/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
