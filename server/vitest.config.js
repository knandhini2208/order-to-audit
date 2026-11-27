import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DATABASE_URL: 'postgres://ota:ota_dev_pw@localhost:5432/order_to_audit_test' },
    fileParallelism: false,
    testTimeout: 30000,
  },
});