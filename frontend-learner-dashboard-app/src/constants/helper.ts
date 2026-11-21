import {
  getTokenDecodedData,
  getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "./auth/tokens";
// import { PrivacyScreen } from "@capacitor-community/privacy-screen";

export function convertToLocalDateTime(utcDate: string): string {
  if (!utcDate) return "";

  // Backend stores timestamps in UTC but omits the trailing 'Z'.
  // Without "Z", browsers parse the string as *local* time, silently
  // skipping the UTC→local conversion. Force UTC interpretation first.
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(utcDate);
  const normalized = hasTimezone ? utcDate : `${utcDate.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };

  const formatted = new Intl.DateTimeFormat("en-GB", options).format(date);
  return formatted
    .replace(",", "")
    .replace(/\s(am|pm)/i, (match) => match.toUpperCase());
}

export function extractDateTime(utcDate: string) {

  const parts = utcDate.split(" at ");
  const date = parts[0] || ""; // 
  const time = parts[1] ? `${parts[1]}` : ""; // 

  return { date, time };
}

export async function getInstituteId() {
  try {
    // First, check if user has selected a specific institute
    const { Preferences } = await import("@capacitor/preferences");
    const selectedInstitute = await Preferences.get({ key: "selectedInstituteId" });
    
    if (selectedInstitute.value) {
      return selectedInstitute.value;
    }
    
    // Fallback to first institute from authorities if no selection made
    const accessToken = await getTokenFromStorage(TokenKey.accessToken);
    const data = accessToken ? await getTokenDecodedData(accessToken) : null;
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    return INSTITUTE_ID;
  } catch (error) {
    console.error("Error getting institute ID:", error);
    // Fallback to first institute from authorities
    const accessToken = await getTokenFromStorage(TokenKey.accessToken);
    const data = accessToken ? await getTokenDecodedData(accessToken) : null;
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    return INSTITUTE_ID;
  }
}

interface Subject {
  id: string;
  subject_name: string;
}

export const getSubjectNameById = (
  subjects: Subject[],
  id: string | null
): string => {
  const subject = subjects.find((item: Subject) => item.id === id);

  return subject?.subject_name || "";
};

export const formatDuration = (durationInSeconds: number): string => {
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = durationInSeconds % 60;

  if (hours === 0 && minutes === 0 && seconds > 0) {
    return `${seconds} sec`;
  }

  const formattedDuration = `${hours > 0 ? `${hours} hr ` : ""}${
    minutes > 0 ? `${minutes} min ` : ""
  }${seconds > 0 ? `${seconds} sec` : ""}`.trim();

  return formattedDuration;
};
