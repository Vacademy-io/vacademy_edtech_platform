import {
    FormValuesStep1Signup,
    OrganizationDetailsSignupStep1Values,
} from '../onboarding/-components/Step3AddOrgDetails';

export const convertedSignupData = ({
    searchParams,
    formData,
    formDataOrg,
    signupData,
}: {
    searchParams: Record<string, boolean>;
    formData: FormValuesStep1Signup;
    formDataOrg: OrganizationDetailsSignupStep1Values;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signupData?: Record<string, any>;
}) => {
    const module_request_ids_list: string[] = [];

    if (searchParams.assess) {
        module_request_ids_list.push('1');
    }

    if (searchParams.lms) {
        module_request_ids_list.push('2');
    }
    if (searchParams.volt) {
        module_request_ids_list.push('3');
    }
    if (searchParams.vsmart) {
        module_request_ids_list.push('4');
    }

    const data = {
        full_name: formDataOrg.name,
        user_name: formDataOrg.username,
        email: formDataOrg.email,
        password: formDataOrg.password,
        user_roles: [...formDataOrg.roleType],
        subject_id: signupData?.sub ?? null,
        vendor_id: signupData?.provider ?? null,
        institute: {
            institute_name: formData.instituteName,
            id: '',
            country: '',
            state: '',
            city: '',
            address: '',
            pin_code: '',
            phone: '',
            email: '',
            website_url: '',
            institute_logo_file_id: formData.instituteProfilePic || '',
            institute_theme_code: formData.instituteThemeCode || '',
            language: '',
            description: '',
            type: formData.instituteType,
            held_by: '',
            founded_date: new Date().toISOString(),
            module_request_ids: module_request_ids_list,
            sub_modules: [],
            sessions: [
                {
                    id: '',
                    session_name: '',
                    status: '',
                    start_date: new Date().toISOString(),
                },
            ],
            batches_for_sessions: [
                {
                    id: '',
                    level: {
                        id: '',
                        level_name: '',
                        duration_in_days: 0,
                        thumbnail_id: '',
                    },
                    session: {
                        id: '',
                        session_name: '',
                        status: '',
                        start_date: new Date().toISOString(),
                    },
                    start_time: new Date().toISOString(),
                    status: '',
                    package_dto: {
                        id: '',
                        package_name: '',
                        thumbnail_file_id: '',
                        is_course_published_to_catalaouge: true,
                        course_preview_image_media_id: '',
                        course_banner_media_id: '',
                        course_media_id: '',
                        why_learn_html: '',
                        who_should_learn_html: '',
                        about_the_course_html: '',
                        tags: [],
                        course_depth: 0,
                        course_html_description_html: '',
                    },
                    group: null, // ✅ FIXED: Prevent JSON coercion error
                },
            ],
            levels: [
                {
                    id: '',
                    level_name: '',
                    duration_in_days: 0,
                    thumbnail_id: '',
                },
            ],
            genders: [],
            student_statuses: [],
            subjects: [
                {
                    id: '',
                    subject_name: '',
                    subject_code: '',
                    credit: 0,
                    thumbnail_id: '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    subject_order: 0,
                },
            ],
            session_expiry_days: [],
            package_groups: [],
            letter_head_file_id: '',
            tags: [],
        },
    };

    return data;
};
