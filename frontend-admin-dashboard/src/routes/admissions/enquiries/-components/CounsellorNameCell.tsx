import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ADMIN_DETAILS_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { UserProfile } from '@/services/student-list-section/getAdminDetails';
import { MyButton } from '@/components/design-system/button';
import { AssignCounsellorDialog } from './AssignCounsellorDialog';

interface CounsellorNameCellProps {
    counsellorId: string | null | undefined;
    enquiryId: string;
}

const fetchCounsellorDetails = async (counsellorId: string): Promise<UserProfile> => {
    const INSTITUTE_ID = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ADMIN_DETAILS_URL,
        params: {
            instituteId: INSTITUTE_ID,
            userId: counsellorId,
        },
    });
    return response.data;
};

export const CounsellorNameCell = ({ counsellorId, enquiryId }: CounsellorNameCellProps) => {
    const { t } = useTranslation('admissionsCounsellorNameCell');
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const { data, isLoading, error } = useQuery({
        queryKey: ['counsellor-details', counsellorId],
        queryFn: () => fetchCounsellorDetails(counsellorId!),
        enabled: !!counsellorId,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // Show assign button when no counsellor
    if (!counsellorId) {
        return (
            <>
                <div className="p-3">
                    <MyButton
                        buttonType="secondary"
                        size="sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsDialogOpen(true);
                        }}
                    >
                        {t('assign')}
                    </MyButton>
                </div>
                <AssignCounsellorDialog
                    open={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                    enquiryId={enquiryId}
                    onSuccess={() => {
                        // Refetch will happen via query invalidation
                    }}
                />
            </>
        );
    }

    if (isLoading) {
        return (
            <div className="p-3">
                <div className="h-4 w-24 animate-pulse rounded bg-neutral-200"></div>
            </div>
        );
    }

    if (error) {
        return <div className="p-3 text-sm text-red-500">{t('errorLoading')}</div>;
    }

    return (
        <div className="p-3 text-sm text-neutral-700">{data?.full_name || t('unknown')}</div>
    );
};
