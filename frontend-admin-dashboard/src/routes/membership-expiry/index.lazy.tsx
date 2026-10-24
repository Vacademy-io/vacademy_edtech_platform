import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MembershipExpiryTable } from './-components/MembershipExpiryTable';
import { MembershipExpiryFilters } from './-components/MembershipExpiryFilters';
import { MembershipExpiryAnalytics } from './-components/MembershipExpiryAnalytics';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ActiveFiltersDisplay } from '@/components/common/filters/ActiveFiltersDisplay';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAllMembershipExpiry,
  fetchMembershipExpiry,
  getMembershipExpiryQueryKey,
} from '@/services/membership-expiry';
import { exportMembershipExpiryCsv } from './-utils/membership-expiry-csv';
import { Button } from '@/components/ui/button';
import { DownloadSimple, SpinnerGap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { BatchForSession, PackageSessionFilter } from '@/types/payment-logs';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useMemo } from 'react';

import { keepPreviousData } from '@tanstack/react-query';

export const Route = createLazyFileRoute('/membership-expiry/')({
  component: MembershipExpiryPage,
});

function MembershipExpiryPage() {
  const { t } = useTranslation('membershipExpiryIndexLazy');
  const [pageNo, setPageNo] = useState(0);
  const [pageSize] = useState(20);

  // Filter State
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [packageSessionFilter, setPackageSessionFilter] = useState<PackageSessionFilter>({
    packageId: undefined,
    sessionId: undefined,
    levelId: undefined,
    packageSessionId: undefined,
  });

  // Get institute details from Zustand store
  const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);

  // Extract batches for sessions from institute data
  const batchesForSessions: BatchForSession[] = useMemo(() => {
    const batches = instituteDetails?.batches_for_sessions;
    return batches && Array.isArray(batches) ? (batches as unknown as BatchForSession[]) : [];
  }, [instituteDetails]);

  // Build request filters
  const requestFilters = useMemo(() => {
    const filters: any = {
      start_date_in_utc: startDate || undefined,
      end_date_in_utc: endDate || undefined,
    };

    if (packageSessionFilter.packageSessionIds && packageSessionFilter.packageSessionIds.length > 0) {
      filters.package_session_ids = packageSessionFilter.packageSessionIds;
    } else if (packageSessionFilter.packageSessionId) {
      filters.package_session_ids = [packageSessionFilter.packageSessionId];
    } else if (packageSessionFilter.packageId) {
      // Resolve all matching batches for the selected package and optional level/session
      const resolvedIds = batchesForSessions
        .filter((batch) =>
          batch.package_dto.id === packageSessionFilter.packageId &&
          (!packageSessionFilter.levelId || batch.level.id === packageSessionFilter.levelId) &&
          (!packageSessionFilter.sessionId || batch.session.id === packageSessionFilter.sessionId)
        )
        .map((batch) => batch.id);

      if (resolvedIds.length > 0) {
        filters.package_session_ids = resolvedIds;
      }
    }

    return filters;
  }, [startDate, endDate, packageSessionFilter, batchesForSessions]);

  const queryKey = getMembershipExpiryQueryKey(pageNo, pageSize, requestFilters);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchMembershipExpiry(pageNo, pageSize, requestFilters),
    placeholderData: keepPreviousData,
  });

  const [isExporting, setIsExporting] = useState(false);

  // Exports every row matching the current filters (date range + course/session),
  // not just the visible page.
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const rows = await fetchAllMembershipExpiry(requestFilters);
      if (rows.length === 0) {
        toast.info(t('exportEmpty'));
        return;
      }
      exportMembershipExpiryCsv(rows, { startDate, endDate });
      toast.success(t('exportSuccess', { count: rows.length }));
    } catch {
      toast.error(t('exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handlePackageSessionFilterChange =(filter: PackageSessionFilter) => {
    setPackageSessionFilter(filter);
    setPageNo(0);
  };

  const handleClearFilter = (filterType: string, value?: string) => {
    switch (filterType) {
      case 'all':
        handleClearFilters();
        break;
      case 'startDate':
        setStartDate('');
        setPageNo(0);
        break;
      case 'endDate':
        setEndDate('');
        setPageNo(0);
        break;
      case 'packageSession':
        if (value) {
          setPackageSessionFilter(prev => ({
            ...prev,
            packageSessionIds: prev.packageSessionIds?.filter(id => id !== value)
          }));
        } else {
          setPackageSessionFilter({
            packageId: undefined,
            sessionId: undefined,
            levelId: undefined,
            packageSessionId: undefined,
          });
        }
        setPageNo(0);
        break;
    }
  };

  const handleQuickFilter = (range: { start: string; end: string }) => {
    setStartDate(range.start);
    setEndDate(range.end);
    setPageNo(0);
  };

  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setPackageSessionFilter({
      packageId: undefined,
      sessionId: undefined,
      levelId: undefined,
      packageSessionId: undefined,
    });
    setPageNo(0);
  };

  return (
    <LayoutContainer>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
            disabled={isExporting || !data?.totalElements}
          >
            {isExporting ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <DownloadSimple size={16} />
            )}
            {isExporting ? t('exporting') : t('exportCsv')}
          </Button>
        </div>

        <MembershipExpiryAnalytics
          packageSessionIds={requestFilters.package_session_ids}
          onCardClick={(range) => {
            // handle analytics card click to set filters
            // range has start, end, status. 
            // MembershipExpiryFilters handles dates.
            // But table filter by status? The table doesn't seem to support status filter in `fetchMembershipExpiry`?
            // Wait, fetchMembershipExpiry accepts `membership_statuses`.
            // But MembershipExpiryFilters doesn't have status input. 
            // Use QuickFilter logic for dates.
            setStartDate(range.start.toISOString());
            setEndDate(range.end.toISOString());
            // Status filter not fully implemented in UI yet
          }}
        />

        <div className="space-y-4">
          <MembershipExpiryFilters
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            packageSessionFilter={packageSessionFilter}
            onPackageSessionFilterChange={handlePackageSessionFilterChange}
            batchesForSessions={batchesForSessions}
            onQuickFilterSelect={handleQuickFilter}
            onClearFilters={handleClearFilters}
          />

          <ActiveFiltersDisplay
            startDate={startDate}
            endDate={endDate}
            packageSessionFilter={packageSessionFilter}
            batchesForSessions={batchesForSessions}
            onClearFilter={handleClearFilter}
          />

          <MembershipExpiryTable
            data={data}
            isLoading={isLoading}
            error={error as Error | null}
            currentPage={pageNo}
            onPageChange={setPageNo}
          />
        </div>
      </div>
    </LayoutContainer>
  );
}
