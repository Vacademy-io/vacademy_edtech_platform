import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Share,
    Users,
    Envelope,
    Phone,
    Calendar,
    CaretLeft,
    CaretRight,
    Download,
} from '@phosphor-icons/react';
import type { CampaignListResponse } from '@/types/challenge-analytics';
import { useReferralLeads } from '../-hooks/useAnalyticsData';
import { format } from 'date-fns';

interface ReferralTrackingProps {
    referralData: CampaignListResponse | undefined;
    organicData: CampaignListResponse | undefined;
    isLoading: boolean;
    startDate: string;
    endDate: string;
}

export function ReferralTracking({
    referralData,
    organicData,
    isLoading,
    startDate,
    endDate,
}: ReferralTrackingProps) {
    const { t, i18n } = useTranslation('challengeAnalyticsReferralTracking');
    // Get REFERRAL type campaigns only for the leads
    const referralCampaigns = useMemo(() => {
        return referralData?.content?.filter((c) => c.campaign_type === 'REFERRAL') || [];
    }, [referralData]);

    // State for selected campaign and pagination
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
    const [page, setPage] = useState(0);
    const pageSize = 10;

    // Auto-select first referral campaign
    useMemo(() => {
        if (referralCampaigns.length > 0 && !selectedCampaignId) {
            setSelectedCampaignId(referralCampaigns[0]?.id || '');
        }
    }, [referralCampaigns, selectedCampaignId]);

    // Fetch leads for selected campaign
    const { data: leadsData, isLoading: leadsLoading } = useReferralLeads(
        selectedCampaignId,
        startDate,
        endDate,
        page,
        pageSize,
        !!selectedCampaignId
    );

    const selectedCampaign = referralCampaigns.find((c) => c.id === selectedCampaignId);

    // Calculate stats
    const referralUsers = referralCampaigns.reduce((sum, c) => sum + (c.total_users || 0), 0);
    const organicUsers = (organicData?.content || []).reduce(
        (sum, c) => sum + (c.total_users || 0),
        0
    );
    const totalUsers = referralUsers + organicUsers;
    const referralPercentage =
        totalUsers > 0 ? ((referralUsers / totalUsers) * 100).toFixed(1) : '0';

    // Resolve a field value by matching fieldName in custom_field_metadata
    const getCF = (lead: any, ...fieldNames: string[]): string => {
        const meta: Record<string, { fieldName?: string }> = lead.custom_field_metadata || {};
        const values: Record<string, string> = lead.custom_field_values || {};
        for (const name of fieldNames) {
            const lower = name.toLowerCase();
            for (const [id, m] of Object.entries(meta)) {
                if ((m.fieldName || '').toLowerCase() === lower && values[id]) {
                    return values[id] ?? '';
                }
            }
        }
        return '';
    };

    const getLeadName = (lead: any) =>
        lead.user?.full_name ||
        getCF(lead, 'parent name', 'first name', 'name') || '';

    const getLeadEmail = (lead: any) =>
        lead.user?.email || getCF(lead, 'email', 'Email', 'alternate email') || '';

    const getLeadPhone = (lead: any) =>
        lead.user?.mobile_number || getCF(lead, 'phone', 'mobile', 'phone number') || '';

    const exportToCSV = () => {
        if (!leadsData?.content) return;

        const headers = [t('csv.name'), t('csv.email'), t('csv.phone'), t('csv.source'), t('csv.submittedAt')];
        const rows = leadsData.content.map((lead) => [
            getLeadName(lead) || t('csv.notAvailable'),
            getLeadEmail(lead) || t('csv.notAvailable'),
            getLeadPhone(lead) || t('csv.notAvailable'),
            lead.source_type || t('csv.notAvailable'),
            lead.submitted_at_local
                ? new Date(lead.submitted_at_local).toLocaleString(i18n.language)
                : t('csv.notAvailable'),
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `referral_leads_${selectedCampaign?.campaign_name || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    if (isLoading) {
        return (
            <Card className="shadow-sm">
                <CardHeader>
                    <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] animate-pulse rounded bg-gray-100" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-emerald-100 p-2">
                            <Share className="size-5 text-emerald-600" weight="fill" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-semibold">
                                {t('title')}
                            </CardTitle>
                            <p className="text-xs text-gray-500">
                                {t('subtitle')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <div className="rounded-lg bg-emerald-50 px-3 py-2">
                            <span className="text-xs text-gray-500">{t('referralUsers')}</span>
                            <p className="font-bold text-emerald-700">
                                {referralUsers.toLocaleString(i18n.language)}
                            </p>
                        </div>
                        <div className="rounded-lg bg-blue-50 px-3 py-2">
                            <span className="text-xs text-gray-500">{t('referralRate')}</span>
                            <p className="font-bold text-blue-700">{referralPercentage}%</p>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* Campaign Selector */}
                <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-700">{t('selectCampaign')}</span>
                        <Select
                            value={selectedCampaignId}
                            onValueChange={(val) => {
                                setSelectedCampaignId(val);
                                setPage(0);
                            }}
                        >
                            <SelectTrigger className="w-[250px]">
                                <SelectValue placeholder={t('selectCampaignPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {referralCampaigns.map((campaign) => (
                                    <SelectItem key={campaign.id} value={campaign.id}>
                                        {t('campaignUsers', { name: campaign.campaign_name, count: campaign.total_users || 0 })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {leadsData?.content && leadsData.content.length > 0 && (
                        <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-2">
                            <Download className="size-4" />
                            {t('exportCsv')}
                        </Button>
                    )}
                </div>

                {/* Leads Table */}
                {referralCampaigns.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center text-gray-500">
                        {t('noCampaigns')}
                    </div>
                ) : leadsLoading ? (
                    <div className="flex h-[200px] items-center justify-center">
                        <div className="text-center">
                            <div className="border-primary mx-auto size-8 animate-spin rounded-full border-2 border-t-transparent"></div>
                            <p className="mt-2 text-sm text-gray-500">{t('loadingLeads')}</p>
                        </div>
                    </div>
                ) : !leadsData?.content || leadsData.content.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center text-gray-500">
                        {t('noLeads')}
                    </div>
                ) : (
                    <>
                        <div className="overflow-hidden rounded-lg border">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium text-gray-700">
                                            {t('table.index')}
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-700">
                                            {t('table.user')}
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-700">
                                            {t('table.contact')}
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-700">
                                            {t('table.source')}
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-700">
                                            {t('table.submitted')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leadsData.content.map((lead, index) => (
                                        <tr
                                            key={lead.response_id}
                                            className="border-t hover:bg-gray-50"
                                        >
                                            <td className="px-4 py-3 text-gray-500">
                                                {page * pageSize + index + 1}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                                        <Users className="size-4" weight="fill" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-gray-800">
                                                            {getLeadName(lead) || t('table.anonymous')}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {t('table.idLabel', { id: lead.user_id?.substring(0, 8) })}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="space-y-1">
                                                    {getLeadEmail(lead) && (
                                                        <div className="flex items-center gap-1 text-xs text-gray-600">
                                                            <Envelope className="size-3" />
                                                            <span className="max-w-[150px] truncate">
                                                                {getLeadEmail(lead)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {getLeadPhone(lead) && (
                                                        <div className="flex items-center gap-1 text-xs text-gray-600">
                                                            <Phone className="size-3" />
                                                            <span>{getLeadPhone(lead)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                                    {lead.source_type?.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1 text-xs text-gray-600">
                                                    <Calendar className="size-3" />
                                                    <span>
                                                        {lead.submitted_at_local
                                                            ? format(
                                                                  new Date(lead.submitted_at_local),
                                                                  'MMM dd, yyyy HH:mm'
                                                              )
                                                            : t('csv.notAvailable')}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {leadsData.totalPages > 1 && (
                            <div className="mt-4 flex items-center justify-between">
                                <span className="text-sm text-gray-500">
                                    {t('pagination.showing', {
                                        from: page * pageSize + 1,
                                        to: Math.min((page + 1) * pageSize, leadsData.totalElements),
                                        count: leadsData.totalElements,
                                    })}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(page - 1)}
                                        disabled={page === 0}
                                    >
                                        <CaretLeft className="size-4" />
                                        {t('pagination.previous')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(page + 1)}
                                        disabled={leadsData.last}
                                    >
                                        {t('pagination.next')}
                                        <CaretRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
