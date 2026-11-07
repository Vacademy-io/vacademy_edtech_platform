import { GET_SIGNED_URL_PUBLIC, SIGNUP_URL } from '@/constants/urls';
import { isNullOrEmptyOrUndefined } from '@/lib/utils';
import axios from 'axios';
import { convertedSignupData } from '../-utils/helper';
import {
    FormValuesStep1Signup,
    OrganizationDetailsSignupStep1Values,
} from '../onboarding/-components/Step3AddOrgDetails';
import i18n from '@/i18n';

const NAMESPACE = 'signupServices';

export const UploadFileInS3Public = async (
    file: File,
    setIsUploadingFile: React.Dispatch<React.SetStateAction<boolean>> = () => false,
    source?: string,
    sourceId?: string
) => {
    setIsUploadingFile(true);
    const effectiveSource = source || 'FLOOR_DOCUMENTS';
    const effectiveSourceId = sourceId || 'STUDENTS';

    try {
        if (isNullOrEmptyOrUndefined(file)) {
            throw new Error(i18n.t(`${NAMESPACE}:invalidFile`));
        }

        if (file) {
            const signedURLData = await getSignedURLPublic(
                file.name.toLowerCase().replace(/\s+/g, '_'),
                file.type,
                effectiveSource,
                effectiveSourceId
            );

            await axios({
                method: 'PUT',
                url: signedURLData.url,
                data: file,
                headers: {
                    // S3 stores whatever Content-Type the PUT sends. Without
                    // this, axios uses its PUT default
                    // (application/x-www-form-urlencoded), so the file is stored
                    // with the wrong type — e.g. an institute logo then fails to
                    // render in social/link previews. Use the file's real MIME
                    // type (same value passed to getSignedURLPublic above).
                    'Content-Type': file.type || 'application/octet-stream',
                },
            });

            setIsUploadingFile(false);
            return signedURLData.id;
        }
    } catch (error) {
        console.error(error);
        setIsUploadingFile(false);
        throw error;
    }
};

const getSignedURLPublic = async (
    file_name: string,
    file_type: string,
    source: string,
    source_id: string
) => {
    const requestBody = {
        file_name,
        file_type,
        source,
        source_id,
    };
    const response = await axios.post(GET_SIGNED_URL_PUBLIC, requestBody);
    return response.data;
};

// ✅ Updated to accept signupData and pass it to the converter
export const handleSignupInstitute = async ({
    searchParams,
    formData,
    formDataOrg,
    signupData,
}: {
    searchParams: Record<string, boolean>;
    formData: FormValuesStep1Signup;
    formDataOrg: OrganizationDetailsSignupStep1Values;
    signupData?: Record<string, any>;
}) => {
    const convertedData = convertedSignupData({ searchParams, formData, formDataOrg, signupData });

    const response = await axios({
        method: 'POST',
        url: SIGNUP_URL,
        data: convertedData,
    });

    return response.data;
};
