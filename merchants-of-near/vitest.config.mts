import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@mon/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)) } },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
