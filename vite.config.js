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
  plugins: [staticWebAppConfig],
});
