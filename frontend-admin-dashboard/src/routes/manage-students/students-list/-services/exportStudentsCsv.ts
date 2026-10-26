// services/student-list-section/exportStudentsCsv.ts
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_STUDENTS_CSV } from '@/constants/urls';
import { StudentFilterRequest } from '@/types/student-table-types';
import { toast } from 'sonner';
import { getAccessiblePackageFilters } from '@/lib/auth/facultyAccessUtils';
import type { TFunction } from 'i18next';
import { normalizeStudentFilters } from '../-utils/normalizeStudentFilters';

interface ExportParams {
    filters: StudentFilterRequest;
    pageNo?: number;
    pageSize?: number;
}

export const buildExportStudentsCsv = (t: TFunction) => async ({
    filters,
    pageNo = 0,
    pageSize = 10,
}: ExportParams) => {
    try {
        // Sub-org admin: restrict export to accessible package sessions only
        const accessibleFilters = getAccessiblePackageFilters();
        const exportFilters = normalizeStudentFilters(filters);
        if (accessibleFilters?.package_session_ids?.length) {
            const allowed = new Set(accessibleFilters.package_session_ids);
            if (exportFilters.package_session_ids?.length) {
                // Intersect: keep only IDs that are both selected and allowed
                exportFilters.package_session_ids = exportFilters.package_session_ids.filter(id => allowed.has(id));
            } else {
                // No filter set — restrict to allowed sessions
                exportFilters.package_session_ids = accessibleFilters.package_session_ids;
            }
        }

        const response = await authenticatedAxiosInstance({
            url: `${GET_STUDENTS_CSV}?pageNo=${pageNo}&pageSize=${pageSize}`,
            method: 'POST',
            data: exportFilters,
            responseType: 'blob',
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute(
            'download',
            `students_export_${new Date().toISOString().split('T')[0]}.csv`
        );
        document.body.appendChild(link);
        link.click();

        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch {
        toast.error(t('manageStudentsExportStudentsCsvService:errors.exportFailed'));
    }
};
