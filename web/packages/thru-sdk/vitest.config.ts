import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true, // Enable describe, it, expect globally
    include: ["thru-ts-client-sdk/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/proto/**",
      "**/test-scripts/**",
    ],
    // Don't fail when no tests are found (useful during development)
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["thru-ts-client-sdk/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/proto/**",
        "**/dist/**",
        "**/test-scripts/**",
        "**/*.test.ts",
        "**/*.spec.ts",
      ],
    },
  },
});

