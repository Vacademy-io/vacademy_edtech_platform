import axios from 'axios';
import {
  SUB_ORG_MEMBER_ADMIN_DETAILS,
  SUB_ORG_MEMBERS,
  SUB_ORG_ADD_MEMBER,
  SUB_ORG_TERMINATE_MEMBER,
  ENROLLMENT_INVITE_URL
} from '@/constants/urls';
import { toast } from 'sonner';

// Types
export interface AdminMappings {
  package_session_id: string;
  institute_id: string;
  sub_org_id: string;
  package_name?: string;
  level_name?: string;
  session_name?: string;
  invite_code?: string;
  [key: string]: any;
}

export interface AdminDetailsResponse {
  admin_mappings: AdminMappings[];
}

export interface MemberCustomField {
  custom_field_id: string;
  field_key: string;
  field_name: string;
  field_type: string;
  field_value: string | null;
  source_type: string;
}

export interface StudentMapping {
  id: string;
  user_id: string;
  institute_enrollment_number: string;
  enrolled_date: string;
  expiry_date: string;
  status: 'ACTIVE' | 'TERMINATED' | 'INVITED' | 'PENDING_FOR_APPROVAL' | 'INACTIVE';
  package_session_id: string;
  institute_id: string;
  group_id: string;
  sub_org_id: string;
  user_plan_id: string | null;
  destination_package_session_id: string | null;
  user: {
    id: string;
    user_id?: string;
    full_name: string;
    email: string;
    mobile_number: string;
    username: string;
  };
  custom_fields?: MemberCustomField[];
}

export interface MembersResponse {
  student_mappings: StudentMapping[];
}

export interface UserData {
  email: string;
  mobile_number?: string;
  full_name: string;
  username?: string;
}

export interface AddMemberRequest {
  user: UserData;
  package_session_id: string;
  sub_org_id: string;
  institute_id: string;
  group_id?: string;
  enrolled_date?: string;
  expiry_date?: string;
  institute_enrollment_number?: string;
  status?: 'ACTIVE' | 'TERMINATED' | 'INVITED' | 'PENDING_FOR_APPROVAL' | 'INACTIVE';
  comma_separated_org_roles?: string;
  custom_field_values?: Array<{
    custom_field_id: string;
    value: string;
  }>;
}

export interface AddMemberResponse {
  user: {
    user_id: string;
    full_name: string;
    email: string;
    mobile_number: string;
    username: string;
  };
  mapping_id: string;
  message: string;
}

export interface TerminateMemberRequest {
  sub_org_id: string;
  institute_id: string;
  package_session_id: string;
  user_ids: string[];
  /** SOFT = keep access until access_till_date; HARD = terminate now. Defaults HARD. */
  mode?: 'SOFT' | 'HARD';
  /** SOFT-only last access date (ISO yyyy-MM-dd). Required for SOFT. */
  access_till_date?: string | null;
}

export interface TerminateMemberResponse {
  terminated_count: number;
  message: string;
}

export interface CustomFieldConfig {
  id: number;
  value: string;
  label: string;
}

export interface CustomField {
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: 'text' | 'dropdown' | 'date' | 'number' | 'textarea';
  defaultValue: any;
  config: string | null; // JSON string of options for dropdown
  isMandatory: boolean;
  [key: string]: any;
}

export interface InstituteCustomField {
  id: string;
  institute_id: string;
  type: string;
  custom_field: CustomField;
  status: 'ACTIVE' | 'INACTIVE';
  [key: string]: any;
}

export interface EnrollInviteResponse {
  id: string;
  invite_code: string;
  institute_id: string;
  institute_custom_fields: InstituteCustomField[];
  [key: string]: any;
}

// Helper function to get auth headers
const getAuthHeaders = async () => {
  const { Preferences } = await import('@capacitor/preferences');

  const { value: accessToken } = await Preferences.get({ key: 'accessToken' });
  if (!accessToken) {
    throw new Error('No access token available');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
};

// API Functions

// Check admin access permissions
export const checkAdminAccess = async (userId: string): Promise<AdminDetailsResponse> => {
  try {
    const url = `${SUB_ORG_MEMBER_ADMIN_DETAILS}?userId=${userId}`;

    // This endpoint requires authentication headers
    const headers = await getAuthHeaders();

    const response = await axios.get<AdminDetailsResponse>(url, { headers });

    return response.data;
  } catch (error) {
    console.error('Error checking admin access:', error);
    if (axios.isAxiosError(error)) {
      console.error('Axios error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
      });
    }
    throw error;
  }
};

// Get members by package session and sub-organization
export const getMembers = async (
  packageSessionId: string,
  subOrgId: string
): Promise<MembersResponse> => {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.get<MembersResponse>(SUB_ORG_MEMBERS, {
      headers,
      params: {
        package_session_id: packageSessionId,
        sub_org_id: subOrgId,
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching members:', error);
    toast.error('Failed to fetch members');
    throw error;
  }
};

// Add a new member
export const addMember = async (memberData: AddMemberRequest): Promise<AddMemberResponse> => {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.post<AddMemberResponse>(SUB_ORG_ADD_MEMBER, memberData, {
      headers,
    });
    toast.success('Learner enrolled successfully');
    return response.data;
  } catch (error) {
    console.error('Error adding member:', error);
    // No toast here: callers show the server's reason (e.g. the seat-limit message
    // with the institute support email), which a generic toast would bury.
    throw error;
  }
};

// Terminate members (bulk operation)
export const terminateMembers = async (
  terminateData: TerminateMemberRequest
): Promise<TerminateMemberResponse> => {
  try {
    const headers = await getAuthHeaders();
    const response = await axios.post<TerminateMemberResponse>(
      SUB_ORG_TERMINATE_MEMBER,
      terminateData,
      { headers }
    );
    return response.data;
  } catch (error) {
    console.error('Error terminating members:', error);
    throw error;
  }
};

// Get institute custom fields details using invite info
export const getInstituteCustomFields = async (
  instituteId: string,
  inviteCode: string
): Promise<EnrollInviteResponse> => {
  try {
    const url = `${ENROLLMENT_INVITE_URL}?instituteId=${instituteId}&inviteCode=${inviteCode}`;
    const response = await axios.get<EnrollInviteResponse>(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching invite details:', error);
    throw error;
  }
};


// Export all functions
export const subOrganizationLearnerManagementApi = {
  checkAdminAccess,
  getMembers,
  addMember,
  terminateMembers,
  getInstituteCustomFields,
};

