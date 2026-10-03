import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { root: '.', include: ['tests/**/*.test.ts'], env: { DATA_DIR: 'scratch/test-data' } } });
