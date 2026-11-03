import { getFlavorByKey, type AdminFlavor } from '../../flavor.config';

// Runtime view of the build-time flavor. `VITE_CAP_FLAVOR` is baked into the
// bundle at build time (set by the cap:*:<flavor> npm scripts), so this resolves
// synchronously on first paint — no async App.getInfo() before the router mounts.
//
// On the plain web build VITE_CAP_FLAVOR is unset, so this falls back to the
// default flavor (DEFAULT_FLAVOR_KEY = 'vacademy-admin'). forceVimShell + OTA
// are guarded by isNative(), so those are harmless on web. NOTE: the default
// flavor DOES carry a fixed brandingDomain/instituteId, so callers that choose
// fixed-domain vs host-based branding MUST gate on isNative() — otherwise web
// hosts would resolve the flavor's vacademy.io/admin-app instead of their own
// domain. See index.tsx / login-form.tsx.
const flavor: AdminFlavor = getFlavorByKey(
    (import.meta.env as Record<string, string | undefined>).VITE_CAP_FLAVOR
);

export function getFlavor(): AdminFlavor {
    return flavor;
}

/** Force the `/vim` shell on native cold start (Vimotion only). */
export function shouldForceVimShell(): boolean {
    return flavor.forceVimShell;
}

/** Hold the app inside the `/evalezy` copy-check shell (Evalezy only). */
export function shouldForceEvalezyShell(): boolean {
    return flavor.forceEvalezyShell === true;
}

/** Fixed anchor institute id for branding/theme, or undefined for host-based. */
export function getFlavorInstituteId(): string | undefined {
    return flavor.instituteId;
}
