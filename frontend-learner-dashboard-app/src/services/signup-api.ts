import axios from "axios";
import { BASE_URL, GET_USER_DETAILS_BY_EMAIL, LOGIN_BY_USERNAME_TRUSTED, LOGIN_URL } from "@/constants/urls";
import { useQuery } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { getTokenDecodedData } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
// import type { NavigateFunction } from "@tanstack/react-router";
type NavigateFunction = (options: { to: string }) => void;

// Types
export interface InstituteSearchResult {
  id: string;
  institute_name: string;
}

export interface InstituteDetails {
  id: string;
  institute_name: string;
  setting?: string;
  [key: string]: any;
}

export interface RegisterUserRequest {
  user: {
    username: string;
    email: string;
    full_name: string;
    password: string;
    roles: string[];
    root_user: boolean;
  };
  institute_id: string;
  subject_id?: string; // OAuth subject ID (e.g., Google sub)
  vendor_id?: string;  // OAuth provider (e.g., "google", "github")
}

export interface RegisterUserResponse {
  accessToken: string;
  refreshToken: string;
  /** Register only: the account already existed and must sign in itself; no tokens were issued. */
  account_exists?: boolean;
  user: {
    id: string;
    username: string;
    email: string;
    full_name: string;
    roles: string[];
  };
}

export interface InstituteSettings {
  allowLearnerSignup: boolean;
  allowTeacherSignup: boolean;
  learnersCanCreateCourses: boolean;
  signup?: any;
}

// Institute search function
export const searchInstitute = async (searchName: string): Promise<InstituteSearchResult[]> => {
  try {
    const response = await axios.get(`${BASE_URL}/admin-core-service/public/institute/v1/search`, {
      params: { searchName },
      headers: {
        accept: "*/*",
      },
    });
    return response.data;
  } catch (error) {
    throw new Error("Failed to search institutes");
  }
};

// Get institute details function
export const getInstituteDetails = async (instituteId: string): Promise<InstituteDetails> => {
  try {
    const response = await axios.get(`${BASE_URL}/admin-core-service/public/institute/v1/details-non-batches/${instituteId}`, {
      headers: {
        accept: "*/*",
      },
    });
    return response.data;
  } catch (error) {
    throw new Error("Failed to fetch institute details");
  }
};

// Post signup authentication handler
export const handlePostSignupAuth = async (
  accessToken: string,
  refreshToken: string,
  instituteId: string,
  navigate: NavigateFunction,
  isModalSignup: boolean = false
) => {
  try {
    // Store tokens in Capacitor Preferences
    await Preferences.set({ key: TokenKey.accessToken, value: accessToken });
    await Preferences.set({ key: TokenKey.refreshToken, value: refreshToken });
    await Preferences.set({ key: "instituteId", value: instituteId });

    // Decode token to get user ID
    const decodedData = getTokenDecodedData(accessToken);
    const userId = decodedData?.user;

    if (!userId) {
      throw new Error("Failed to decode user ID from token");
    }

    // Store institute details in localStorage for backward compatibility
    const instituteDetails = await getInstituteDetails(instituteId);
    localStorage.setItem("InstituteDetails", JSON.stringify(instituteDetails));

    // Land on the institute's configured post-login route
    await navigateAfterLogin(navigate);
  } catch (error) {
    // Fallback: redirect to login page
    navigate({ to: "/login" });
  }
};

// Main registration function
export const registerUser = async (
  userData: RegisterUserRequest
): Promise<RegisterUserResponse> => {
  try {
    const response = await axios.post<RegisterUserResponse>(
      `${BASE_URL}/auth-service/learner/v1/register`,
      userData,
      {
        headers: {
          accept: "*/*",
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    throw new Error("Failed to register user");
  }
};

// Utility function to parse institute settings
export const parseInstituteSettings = (
  settingsString: string
): InstituteSettings => {
  try {
    // Handle null, undefined, or empty string
    if (!settingsString || settingsString.trim() === "") {
      return {
        allowLearnerSignup: true,
        allowTeacherSignup: false,
        learnersCanCreateCourses: false,
      };
    }

    const settings = JSON.parse(settingsString);
    // Handle case where parsed result is null or not an object
    if (!settings || typeof settings !== "object") {
      return {
        allowLearnerSignup: true,
        allowTeacherSignup: false,
        learnersCanCreateCourses: false,
      };
    }

    // Extract permissions from the nested structure
    let allowLearnersToCreateCourses = false;
    if (settings.setting && typeof settings.setting === "object") {
      if (
        settings.setting.COURSE_SETTING &&
        settings.setting.COURSE_SETTING.data &&
        settings.setting.COURSE_SETTING.data.permissions
      ) {
        const permissions =
          settings.setting.COURSE_SETTING.data.permissions;
        allowLearnersToCreateCourses =
          permissions.allowLearnersToCreateCourses ?? false;
      }
    }
    
    // For backward compatibility, also check direct properties
    const allowLearnerSignup = settings.allowLearnerSignup ?? true;
    const allowTeacherSignup = settings.allowTeacherSignup ?? false;
    const learnersCanCreateCourses =
      allowLearnersToCreateCourses ||
      (settings.learnersCanCreateCourses ?? false);
    
    // Extract signup settings from STUDENT_DISPLAY_SETTINGS
    let signupSettings = null;
    if (settings.setting && typeof settings.setting === "object") {
      if (
        settings.setting.STUDENT_DISPLAY_SETTINGS &&
        settings.setting.STUDENT_DISPLAY_SETTINGS.data &&
        settings.setting.STUDENT_DISPLAY_SETTINGS.data.signup
      ) {
        signupSettings = settings.setting.STUDENT_DISPLAY_SETTINGS.data.signup;
      }
    }

    return {
      allowLearnerSignup,
      allowTeacherSignup,
      learnersCanCreateCourses,
      signup: signupSettings, // Include parsed signup settings
    };
  } catch (error) {
    return {
      allowLearnerSignup: true,
      allowTeacherSignup: false,
      learnersCanCreateCourses: false,
    };
  }
};

// Utility function to parse signup settings from institute details
export const parseSignupSettings = (instituteDetails: any) => {
  return instituteDetails.signup || null;
};

// React Query hook for fetching institute details
export const useInstituteQuery = ({ instituteId }: { instituteId: string }) => {
  return useQuery({
    queryKey: ['institute', instituteId],
    queryFn: async () => {
      if (!instituteId) {
        throw new Error('Institute ID is required');
      }
      
      try {
        // Try to get from localStorage first
        const storedDetails = localStorage.getItem("InstituteDetails");
        if (storedDetails) {
          const parsed = JSON.parse(storedDetails);
          if (parsed.id === instituteId) {
            return parsed;
          }
        }
        
        // If not in localStorage or different institute, fetch from API
        const response = await axios.get(`${BASE_URL}/admin-core-service/public/institute/v1/details-non-batches/${instituteId}`);
        return response.data;
              } catch (error) {
          throw error;
        }
    },
    enabled: !!instituteId,
  });
};

// Check if user is already enrolled by email in a specific institute
export const checkUserEnrollment = async (email: string, instituteId: string): Promise<{ isEnrolled: boolean; userDetails?: any; enrollmentInfo?: string; password?: string }> => {
  try {
    // Check if user exists in the system
    const userResponse = await axios.post(`${GET_USER_DETAILS_BY_EMAIL}?emailId=${encodeURIComponent(email)}`, {}, {
      headers: {
        accept: "*/*",
        "Content-Type": "application/json",
      },
    });

    if (!userResponse.data || !userResponse.data.roles || userResponse.data.roles.length === 0) {
      return {
        isEnrolled: false,
        enrollmentInfo: "User is not enrolled in any institute"
      };
    }
    
    // Since we can't determine institute-specific enrollment from the user-details API alone,
    // we'll assume the user is not enrolled in this specific institute and allow registration
    // The actual enrollment check will happen during the registration process if needed
    
    return {
      isEnrolled: false,
      userDetails: userResponse.data,
      enrollmentInfo: "User exists in system but not enrolled in this specific institute",
      password: userResponse.data.password // Keep password for potential use
    };
    
  } catch (error: any) {
    if (error.response?.status === 404) {
      return {
        isEnrolled: false,
        enrollmentInfo: "User is not enrolled in any institute"
      };
    }
    
    throw new Error("Failed to check user enrollment. Please try again.");
  }
};

// Login function for already enrolled users
export const loginEnrolledUser = async (
  username: string,
  password: string,
  instituteId: string
): Promise<RegisterUserResponse> => {
  try {
    // Post-payment login: user_name, password, institute_id
    const response = await axios.post(LOGIN_URL, {
      user_name: username,
      password: password,
      institute_id: instituteId,
    }, {
      headers: {
        accept: "*/*",
        "Content-Type": "application/json",
      },
    });
    
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      user: {
        id: response.data.user?.id || '',
        username: response.data.user?.username || username,
        email: response.data.user?.email || '',
        full_name: response.data.user?.full_name || '',
        roles: response.data.user?.roles || [],
      }
    };
  } catch (error: any) {
    // Provide more specific error messages
    if (error.response?.status === 401) {
      throw new Error("Invalid password for existing account. Please use your correct password or try 'Forgot Password'.");
    } else if (error.response?.status === 403) {
      throw new Error("Access denied. Please contact your institute administrator.");
    } else if (error.response?.status === 404) {
      throw new Error("User account not found. Please check your email or contact support.");
    } else {
      throw new Error("Failed to login with existing account. Please try again or contact support.");
    }
  }
};

/**
 * Login by username (trusted) - no password required.
 * Used for catalog post-payment flow when backend returns use_login_api: true.
 * Requires security.trusted-login.enabled=true in auth-service.
 */
export const loginByUsernameTrusted = async (
  username: string,
  instituteId: string
): Promise<RegisterUserResponse> => {
  const response = await axios.post(
    LOGIN_BY_USERNAME_TRUSTED,
    { username, institute_id: instituteId },
    {
      headers: {
        accept: "*/*",
        "Content-Type": "application/json",
      },
    }
  );
  const data = response.data as {
    accessToken?: string;
    access_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    user?: { id?: string; username?: string; email?: string; full_name?: string; roles?: string[] };
  };
  const accessToken = data.accessToken ?? data.access_token;
  const refreshToken = data.refreshToken ?? data.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("Invalid login response: tokens missing");
  }
  return {
    accessToken,
    refreshToken,
    user: {
      id: data.user?.id ?? "",
      username: data.user?.username ?? username,
      email: data.user?.email ?? "",
      full_name: data.user?.full_name ?? "",
      roles: data.user?.roles ?? [],
    },
  };
};

