import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { getInstituteId } from '@/constants/helper';
import { fetchEmployees, hrKeys } from '@/routes/erp/-shared/hr-service';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

/** How many employees one page of the picker holds. See the note on search below. */
const PICKER_PAGE_SIZE = 50;

export interface EmployeePickerProps {
    /** Selected employee id, or '' / undefined for nothing selected. */
    value: string | null | undefined;
    /** Called with the chosen employee's id. */
    onChange: (employeeId: string) => void;
    disabled?: boolean;
    placeholder?: string;
    /**
     * `employment_status` to restrict the list to. Defaults to `ACTIVE` — salary and
     * payroll screens should not offer exited staff. Pass `null` for every status.
     */
    filterStatus?: string | null;
    /**
     * Pass `false` when the picker is rendered inside a Dialog or Sheet:
     * react-remove-scroll blocks wheel/touch on portalled nodes, so a portalled
     * option list can't be scrolled from inside a modal.
     */
    portal?: boolean;
    className?: string;
}

/** `EMP001 — Jane Doe (Senior Teacher)`, degrading gracefully when fields are absent. */
export function formatEmployeeLabel(employee: EmployeeProfileDTO): string {
    const name = employee.full_name?.trim() || i18n.t('erpEmployeePicker:unnamedEmployee');
    const code = employee.employee_code?.trim();
    const designation = employee.designation_name?.trim();
    return [code ? `${code} — ${name}` : name, designation ? `(${designation})` : '']
        .filter(Boolean)
        .join(' ');
}

/**
 * Single-select over the institute's employees, searchable by code, name or designation.
 *
 * **Search is client-side, on purpose.** `GET /hr/employees` takes page/size/status/
 * department/designation/employmentType and has no free-text `search` param, so there is
 * nothing to debounce against — sending one would be silently ignored and the user would
 * see a list that doesn't respond to typing. Instead one page of {@link PICKER_PAGE_SIZE}
 * is fetched (scoped by `filterStatus`) and `SearchableSelect`'s Command filter matches
 * over the rendered label. When the institute has more employees than that page holds, a
 * caption says so rather than pretending the list is complete — the honest failure mode
 * for a picker whose backend can't search yet.
 *
 * Kept deliberately small so other ERP screens can drop it into a form field:
 * `value` / `onChange(employeeId)` and nothing else required.
 */
export const EmployeePicker = ({
    value,
    onChange,
    disabled = false,
    placeholder,
    filterStatus = 'ACTIVE',
    portal = true,
    className,
}: EmployeePickerProps) => {
    const { t } = useTranslation('erpEmployeePicker');
    const instituteId = getInstituteId();
    const filters = useMemo(
        () => ({ size: PICKER_PAGE_SIZE, status: filterStatus ?? undefined }),
        [filterStatus]
    );

    const { data, isLoading, isError } = useQuery({
        queryKey: hrKeys.employees(filters),
        queryFn: () => fetchEmployees(filters),
        enabled: !!instituteId,
    });

    const options = useMemo(
        () =>
            (data?.content ?? [])
                .filter((employee) => !!employee.id)
                .map((employee) => ({
                    label: formatEmployeeLabel(employee),
                    value: employee.id as string,
                })),
        [data?.content]
    );

    const loadedCount = options.length;
    const totalCount = data?.total_elements ?? loadedCount;
    const isTruncated = totalCount > loadedCount;
    const resolvedPlaceholder = placeholder ?? t('placeholder.default');

    return (
        <div className={cn('flex w-full flex-col gap-1', className)}>
            <SearchableSelect
                options={options}
                value={value ?? ''}
                onChange={onChange}
                disabled={disabled || isLoading || isError}
                portal={portal}
                placeholder={
                    isLoading
                        ? t('placeholder.loading')
                        : isError
                          ? t('placeholder.unavailable')
                          : resolvedPlaceholder
                }
                searchPlaceholder={t('searchPlaceholder')}
                emptyText={t('emptyText')}
            />
            {isError && <p className="text-caption text-danger-600">{t('errorHint')}</p>}
            {!isLoading && !isError && loadedCount === 0 && (
                <p className="text-caption text-neutral-500">
                    {filterStatus
                        ? t('noneForStatus', { status: filterStatus.toLowerCase() })
                        : t('noneAtAll')}
                </p>
            )}
            {!isLoading && !isError && isTruncated && (
                <p className="text-caption text-neutral-500">
                    {t('truncatedHint', { loadedCount, totalCount })}
                </p>
            )}
        </div>
    );
};
