import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The end-to-end test builds a child process and a real socket, so it needs
    // longer than a unit test and must not race a second file for the same port.
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
