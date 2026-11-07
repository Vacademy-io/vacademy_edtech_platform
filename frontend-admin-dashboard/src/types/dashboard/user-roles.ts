interface Role {
    role_name: string;
    status: string;
    role_id: string;
}

export interface UserRolesDataEntry {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string | null;
    city: string | null;
    region: string | null;
    pin_code: string | null;
    mobile_number: string | null;
    date_of_birth: string | null;
    gender: string | null;
    password: string | null;
    profile_pic_file_id: string | null;
    author_subtitle?: string | null;
    author_description?: string | null;
    roles: Role[];
    root_user: boolean;
    status: string;
}

// Define the type for the entire data structure
export interface RolesDummyDataType {
    instituteUsers: UserRolesDataEntry[];
    invites: UserRolesDataEntry[];
}
