import { TokenKey } from "@/constants/auth/tokens";
import { getTokenDecodedData, getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { getCachedInstituteBranding } from "@/services/domain-routing";

export async function getInstituteIdSync() {
    try {
        // A signed-in learner always gets an institute their login belongs to. A choice
        // left in this browser by an earlier sign-in (another institute) must not win.
        const { readSessionInstituteId } = await import("@/lib/auth/session-institute");
        const sessionInstituteId = await readSessionInstituteId();
        if (sessionInstituteId) return sessionInstituteId;

        // First, check if user has selected a specific institute
        const { Preferences } = await import("@capacitor/preferences");
        const selectedInstitute = await Preferences.get({
            key: "selectedInstituteId",
        });

        if (selectedInstitute.value) {
            return selectedInstitute.value;
        }

        // Try InstituteId from Preferences (set by domain routing)
        const storedInstituteId = await Preferences.get({ key: "InstituteId" });
        if (storedInstituteId.value) {
            return storedInstituteId.value;
        }

        // Fallback to first institute from authorities if no selection made
        const accessToken = await getTokenFromStorage(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
        if (INSTITUTE_ID) {
            return INSTITUTE_ID;
        }

        // Final fallback: domain routing in-memory cache (works for unauthenticated users)
        return getCachedInstituteBranding()?.instituteId ?? undefined;
    } catch (error) {
        console.error("Error getting institute ID sync:", error);
        // Fallback to first institute from authorities
        try {
            const accessToken = await getTokenFromStorage(TokenKey.accessToken);
            const data = getTokenDecodedData(accessToken);
            const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
            if (INSTITUTE_ID) return INSTITUTE_ID;
        } catch {}
        // Final fallback: domain routing cache
        return getCachedInstituteBranding()?.instituteId ?? undefined;
    }
}

export function extractTextFromHTML(htmlString?: string | null) {
    if (htmlString == null) return "";
    return String(htmlString).replace(/<[^>]*>/g, "");
}
