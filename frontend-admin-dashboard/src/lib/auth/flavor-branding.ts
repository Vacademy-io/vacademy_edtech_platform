import { isNative } from '@/native/platform';
import { getFlavor } from '@/native/flavor';

/**
 * True in a native build whose branding comes from a fixed domain-routing row
 * (flavor.brandingDomain/brandingSubdomain) instead of the host it runs on. Its
 * cached branding is the flavor's row, not the signed-in user's portal.
 */
export const isBrandedByFixedFlavor = (): boolean => {
    const flavor = getFlavor();
    return isNative() && !!(flavor.brandingDomain && flavor.brandingSubdomain);
};
