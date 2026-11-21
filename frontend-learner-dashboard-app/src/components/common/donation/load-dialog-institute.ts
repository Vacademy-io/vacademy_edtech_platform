import { fetchAndStoreInstituteDetails, type InstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { getInstituteDetails } from "@/services/signup-api";
import { readSessionInstituteId } from "@/lib/auth/session-institute";

/**
 * Only the dialog's own display needs this, so a signed-in learner of another
 * institute must not have it saved as their institute.
 */
export const loadDialogInstitute = async (
  instituteId: string,
  userId: string | null | undefined,
): Promise<InstituteDetails | null> => {
  const sessionInstituteId = await readSessionInstituteId();
  return sessionInstituteId && sessionInstituteId !== instituteId
    ? ((await getInstituteDetails(instituteId)) as unknown as InstituteDetails)
    : fetchAndStoreInstituteDetails(instituteId, userId || "guest");
};
