/**
 * electron-builder `afterPack` hook for Mac App Store configs.
 *
 * Verifies the app.asar that was ACTUALLY packaged — not the dist/ on disk, not
 * the env vars in the shell — so no build path can ship a mis-built bundle:
 *
 *   1. the Electron flavor id is compiled into the web JS. Miss it and the app
 *      resolves "io.vacademy.student.app" (SSDC Horizon) on the desktop. This
 *      shipped as Shiksha Nation macOS 1.0.1 (build 6) on 2026-09-12: the web
 *      bundle was built by hand with only VITE_MAC_APP_STORE, skipping the
 *      build script's verify step, and every store install came up as SSDC.
 *   2. reader mode (Guideline 3.1.1) folded to a constant `true`.
 *   3. app/ota-bundle-version.txt exists, or OTA version comparisons are done
 *      against the Electron package version and go wrong.
 *   4. electron-flavor.json carries an otaAppId (the OTA channel is dead without it).
 *
 * The expected flavor id comes from `extraMetadata.electronFlavorAppId` in the
 * builder config — it is NOT always the package appId (ZOE packages as
 * io.zoeedtech.app but compiles the com.zoeedtech.app flavor).
 *
 * Throwing here fails the electron-builder run, which is the point.
 */
const { execFileSync } = require('child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const asar = require('asar');

module.exports = async function verifyMasPackage(context) {
  if (context.electronPlatformName !== 'mas') return;

  const config = context.packager.config;
  const expectedFlavorId = config.extraMetadata && config.extraMetadata.electronFlavorAppId;
  if (!expectedFlavorId) {
    throw new Error(
      'verify-mas-package: extraMetadata.electronFlavorAppId is not set in the builder config — ' +
        'add the flavor id that VITE_ELECTRON_APP_ID was built with.'
    );
  }

  const appDir = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const asarPath = join(appDir, 'Contents', 'Resources', 'app.asar');
  if (!existsSync(asarPath)) {
    throw new Error(`verify-mas-package: no app.asar at ${asarPath}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'mas-verify-'));
  try {
    asar.extractAll(asarPath, scratch);
    const webDir = join(scratch, 'app');
    const failures = [];

    if (!existsSync(join(webDir, 'index.html'))) {
      failures.push('packaged app/ has no index.html');
    }

    const verifier = (script, args) => {
      try {
        execFileSync('python3', [join(__dirname, script), ...args], { stdio: 'inherit' });
        return true;
      } catch {
        return false;
      }
    };
    if (!verifier('verify-electron-flavor.py', [webDir, expectedFlavorId])) {
      failures.push(`flavor "${expectedFlavorId}" is not compiled into the packaged JS`);
    }
    if (!verifier('verify-reader-mode.py', [webDir])) {
      failures.push('reader mode is not compiled in (commerce exposed)');
    }

    const versionFile = join(webDir, 'ota-bundle-version.txt');
    if (!existsSync(versionFile) || !/^\d+(\.\d+)+$/.test(readFileSync(versionFile, 'utf-8').trim())) {
      failures.push('app/ota-bundle-version.txt is missing or not a version');
    }

    let otaAppId = '';
    try {
      otaAppId = JSON.parse(readFileSync(join(scratch, 'electron-flavor.json'), 'utf-8')).otaAppId || '';
    } catch {
      /* reported below */
    }
    if (!otaAppId) {
      failures.push('electron-flavor.json has no otaAppId (OTA channel would be dead)');
    }

    if (failures.length) {
      throw new Error(
        `verify-mas-package: refusing to ship ${context.packager.appInfo.productFilename}:\n  - ` +
          failures.join('\n  - ')
      );
    }
    console.log(
      `  ✓ verify-mas-package: flavor ${expectedFlavorId}, reader mode on, ` +
        `web ${readFileSync(versionFile, 'utf-8').trim()}, otaAppId ${otaAppId}`
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
