import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    test: {
        environment: "node",
        // .test.tsx files set their own DOM environment (`// @vitest-environment jsdom`).
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
});
