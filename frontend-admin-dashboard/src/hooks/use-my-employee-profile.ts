import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { HR_EMPLOYEE_ME } from '@/constants/urls';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';

/**
 * The signed-in user's own employee profile in this institute, or null.
 *
 * "My HR" is the employee's own workspace — their payslips, leave and tax
 * declaration — and it only means anything for someone who HAS an HR profile.
 * Plenty of staff (and every admin at an institute that has not onboarded
 * payroll) do not, and for them every screen behind it would 404. So the
 * sidebar hides the section unless this resolves, mirroring how
 * `mentorship-my-mentorship` is gated by `useIsMentor`.
 *
 * A 404 here is a normal answer ("you are not an employee"), not an error worth
 * retrying or reporting — hence `retry: false` and a session-long cache. Being
 * an employee does not change while someone is signed in.
 */
export function useMyEmployeeProfile(enabled = true): {
    profile: EmployeeProfileDTO | null;
    employeeId: string | null;
    isLoading: boolean;
} {
    const instituteId = getInstituteId();

    const query = useQuery({
        queryKey: ['erp', 'my-employee-profile', instituteId],
        queryFn: async (): Promise<EmployeeProfileDTO | null> => {
            try {
                const { data } = await authenticatedAxiosInstance.get(HR_EMPLOYEE_ME, {
                    params: { instituteId },
                });
                return data ?? null;
            } catch {
                return null;
            }
        },
        enabled: !!instituteId && enabled,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
    });

    return {
        profile: query.data ?? null,
        employeeId: query.data?.id ?? null,
        isLoading: query.isLoading,
    };
}
