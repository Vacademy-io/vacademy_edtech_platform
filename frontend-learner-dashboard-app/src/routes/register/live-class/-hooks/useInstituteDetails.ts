import { useQuery } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { getPublicUrl } from "@/services/upload_file";

interface InstituteDetails {
  institute_name: string;
  institute_logo_file_id: string | null;
  id: string;
  home_icon_click_route?: string | null;
  homeIconClickRoute?: string | null;
}

/** Exported for tests — the hook is just useQuery around this. */
export const getInstituteDetails = async () => {
  const { value } = await Preferences.get({ key: "InstituteDetails" });
  if (!value) return null;

  // A half-written or truncated Preferences entry used to throw out of the
  // queryFn and take the whole page down — verified on the live /register
  // page, where a malformed "InstituteDetails" left #root empty (white
  // screen). Branding is decoration here; the register form must survive it.
  let details: InstituteDetails;
  try {
    details = JSON.parse(value) as InstituteDetails;
  } catch {
    console.warn("[institute-details] ignoring corrupt cached value");
    return null;
  }
  if (!details || typeof details !== "object") return null;
  const logoUrl = details.institute_logo_file_id
    ? await getPublicUrl(details.institute_logo_file_id)
    : null;

  return {
    ...details,
    logoUrl,
    homeIconClickRoute:
      details.homeIconClickRoute ?? details.home_icon_click_route ?? null,
  };
};

export const useInstituteDetails = () => {
  return useQuery({
    queryKey: ["instituteDetails"],
    queryFn: getInstituteDetails,
  });
};
