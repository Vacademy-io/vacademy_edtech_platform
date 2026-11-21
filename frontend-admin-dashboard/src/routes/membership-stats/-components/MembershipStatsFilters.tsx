import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SelectChips from '@/components/design-system/SelectChips';
import PackageSelector from '@/components/design-system/PackageSelector';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { SelectOption } from '@/components/design-system/SelectChips';
import { Calendar, Funnel, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { BatchForSession, PackageSessionFilter } from '@/types/payment-logs';

interface MembershipStatsFiltersProps {
    startDate: string;
    endDate: string;
    onStartDateChange: (date: string) => void;
    onEndDateChange: (date: string) => void;
    selectedUserTypes: SelectOption[];
    onUserTypesChange: (types: SelectOption[]) => void;
    packageSessionFilter: PackageSessionFilter;
    onPackageSessionFilterChange: (filter: PackageSessionFilter) => void;
    batchesForSessions: BatchForSession[];
    onQuickFilterSelect: (range: { start: string; end: string }) => void;
    onClearFilters: () => void;
}

const buildUserTypeOptions = (t: TFunction): SelectOption[] => [
    { value: 'NEW_USER', label: t('userType.newUser') },
    { value: 'RETAINER', label: t('userType.retainer') },
];

export function MembershipStatsFilters({
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
    selectedUserTypes,
    onUserTypesChange,
    packageSessionFilter,
    onPackageSessionFilterChange,
    batchesForSessions,
    onQuickFilterSelect,
    onClearFilters,
}: MembershipStatsFiltersProps) {
    const { t } = useTranslation('membershipStatsMembershipStatsFilters');
    const [showFilters, setShowFilters] = useState(false);
    const userTypeOptions = buildUserTypeOptions(t);

    // Simplified package session ID logic
    const handlePackageSessionChange = (selection: {
        packageSessionId: string | null;
        levelId: string;
        sessionId: string;
        packageId: string;
        packageSessionIds?: string[];
    }) => {
        onPackageSessionFilterChange({
            ...packageSessionFilter,
            packageSessionId: selection.packageSessionId || '',
            levelId: selection.levelId,
            sessionId: selection.sessionId,
            packageId: selection.packageId,
            packageSessionIds: selection.packageSessionIds,
        });
    };

    const handleQuickFilter = (type: string) => {
        const now = new Date();
        const start = new Date();

        switch (type) {
            case '1h':
                start.setHours(now.getHours() - 1);
                break;
            case 'today':
                start.setHours(0, 0, 0, 0);
                break;
            case '7d':
                start.setDate(now.getDate() - 7);
                break;
            case '30d':
                start.setDate(now.getDate() - 30);
                break;
            case 'all':
                onQuickFilterSelect({ start: '', end: '' });
                return;
        }

        onQuickFilterSelect({
            start: start.toISOString(),
            end: now.toISOString(),
        });
    };

    const hasActiveFilters =
        startDate ||
        endDate ||
        selectedUserTypes.length > 0 ||
        !!packageSessionFilter.packageId;

    return (
        <div className="space-y-4">
            {/* Filter Toggle & Quick Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn('gap-2', hasActiveFilters && 'border-primary-500 bg-primary-50')}
                >
                    <Funnel size={16} weight={hasActiveFilters ? 'fill' : 'regular'} />
                    {t('filters')}
                    {hasActiveFilters && (
                        <span className="ms-1 flex size-5 items-center justify-center rounded-full bg-primary-500 text-xs text-white">
                            {(selectedUserTypes.length || 0) +
                                (startDate ? 1 : 0) +
                                (endDate ? 1 : 0) +
                                (packageSessionFilter.packageSessionIds?.length || (packageSessionFilter.packageId ? 1 : 0))}
                        </span>
                    )}
                </Button>

                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">{t('quick')}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuickFilter('1h')}
                        className="h-8"
                    >
                        {t('last1Hour')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuickFilter('today')}
                        className="h-8"
                    >
                        {t('today')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuickFilter('7d')}
                        className="h-8"
                    >
                        {t('last7Days')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuickFilter('30d')}
                        className="h-8"
                    >
                        {t('last30Days')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuickFilter('all')}
                        className="h-8"
                    >
                        {t('allTime')}
                    </Button>
                </div>

                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="ms-auto gap-2 text-red-600 hover:text-red-700"
                    >
                        <X size={16} />
                        {t('clearAll')}
                    </Button>
                )}
            </div>

            {/* Expanded Filter Panel */}
            {showFilters && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    {/* Package Session Filter Section */}
                    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3">
                        <Label className="mb-2 block text-sm font-semibold text-blue-900">
                            {t('filterByCourseSession')}
                        </Label>

                        <PackageSelector
                            instituteId={getCurrentInstituteId() || ''}
                            onChange={handlePackageSessionChange}
                            initialLevelId={packageSessionFilter.levelId}
                            initialSessionId={packageSessionFilter.sessionId}
                            initialPackageId={packageSessionFilter.packageId}
                            multiSelect={true}
                            batchesForSessions={batchesForSessions}
                        />
                    </div>

                    {/* Other Filters */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {/* Start Date */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-700">
                                <Calendar size={14} className="me-1 inline" />
                                {t('startDate')}
                            </Label>
                            <Input
                                type="datetime-local"
                                value={
                                    startDate ? new Date(startDate).toISOString().slice(0, 16) : ''
                                }
                                onChange={(e) =>
                                    onStartDateChange(
                                        e.target.value ? new Date(e.target.value).toISOString() : ''
                                    )
                                }
                                className="h-9"
                            />
                        </div>

                        {/* End Date */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-700">
                                <Calendar size={14} className="me-1 inline" />
                                {t('endDate')}
                            </Label>
                            <Input
                                type="datetime-local"
                                value={endDate ? new Date(endDate).toISOString().slice(0, 16) : ''}
                                onChange={(e) =>
                                    onEndDateChange(
                                        e.target.value ? new Date(e.target.value).toISOString() : ''
                                    )
                                }
                                className="h-9"
                            />
                        </div>

                        {/* User Type */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-700">
                                {t('userTypeLabel')}
                            </Label>
                            <SelectChips
                                options={userTypeOptions}
                                selected={selectedUserTypes}
                                onChange={onUserTypesChange}
                                placeholder={t('selectUserTypes')}
                                multiSelect={true}
                                clearable={true}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
