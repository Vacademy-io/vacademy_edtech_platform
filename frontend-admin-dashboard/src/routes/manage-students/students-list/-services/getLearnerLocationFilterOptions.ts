import { useQuery } from '@tanstack/react-query';
import { GET_LEARNER_LOCATION_FILTER_OPTIONS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface LearnerLocationOption {
    /** As most learners spell it. Sent back as-is in the list filter. */
    value: string;
    /** How many of the institute's learners have it. */
    count: number;
}

export interface LearnerLocationFilterOptions {
    cities: LearnerLocationOption[];
    regions: LearnerLocationOption[];
}

export const fetchLearnerLocationFilterOptions = async (
    instituteId: string
): Promise<LearnerLocationFilterOptions> => {
    const response = await authenticatedAxiosInstance.get<LearnerLocationFilterOptions>(
        GET_LEARNER_LOCATION_FILTER_OPTIONS,
        { params: { instituteId } }
    );
    return {
        cities: response.data?.cities ?? [],
        regions: response.data?.regions ?? [],
    };
};

/**
 * The cities and regions the institute's learners have, for the learner-list City and
 * Region filters. Only fetched while at least one of the two filters is switched on.
 */
export const useLearnerLocationFilterOptions = (
    instituteId: string | undefined,
    enabled: boolean
) =>
    useQuery({
        queryKey: ['learner-location-filter-options', instituteId],
        queryFn: () => fetchLearnerLocationFilterOptions(instituteId as string),
        enabled: Boolean(instituteId) && enabled,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
