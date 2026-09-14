import { readFileSync } from "node:fs";

import { defineConfig } from "vite";

// Static Web Apps only applies routing and security headers when the config file
// is part of the deployed artifact, so emit it alongside the build output.
const staticWebAppConfig = {
  name: "emit-staticwebapp-config",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "staticwebapp.config.json",
      source: readFileSync("staticwebapp.config.json", "utf8"),
    });
  },
};

export default defineConfig({
  publicDir: "viewer/public",
  // CSP permits self-hosted font files but intentionally rejects data: fonts.
  // Keep even small font subsets as emitted assets instead of base64 CSS URLs.
  build: { assetsInlineLimit: 0 },
  plugins: [staticWebAppConfig],
});
