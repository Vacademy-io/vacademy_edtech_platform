import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "fs";
import { join } from "path";

// Flavor is written to electron-flavor.json by the build script.
// Defaults to "ssdc" if the file doesn't exist.
//
// Supported flavors:
//   ssdc           → SSDC Horizon
//   shikshanation  → Shiksha Nation
//   zoe            → ZOE Online School
const flavors: Record<string, { appId: string; appName: string }> = {
  ssdc: {
    appId: "io.vacademy.student.app",
    appName: "SSDC Horizon",
  },
  shikshanation: {
    appId: "com.shikshanation.new.app",
    appName: "Shiksha Nation",
  },
  zoe: {
    appId: "com.zoeedtech.app",
    appName: "ZOE Online School",
  },
};

let flavor = "ssdc";
try {
  // __dirname is build/ after tsc compiles; electron-flavor.json is at project root
  const raw = readFileSync(join(__dirname, "..", "electron-flavor.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed?.flavor && flavors[parsed.flavor]) {
    flavor = parsed.flavor;
  }
} catch {
  // File doesn't exist or is invalid — use default (ssdc)
}

const { appId, appName } = flavors[flavor];

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "dist",
  plugins: {
    PrivacyScreen: {
      enable: true,
      preventScreenshots: true,
    },
  },
};

export default config;
