import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DownloadSimple, Eye, FileText } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MonthPicker, formatMonthValue, previousMonthValue, type MonthValue } from '@/components/design-system/month-picker';
import { MyDropdown } from '@/components/design-system/dropdown';
import { reportApiError } from '@/lib/report-api-error';
import { useHrRole } from '@/hooks/use-hr-role';
import { getInstituteId } from '@/constants/helper';
import {
    HR_COMPLIANCE_24Q_DOWNLOAD,
    HR_COMPLIANCE_ESI_RETURN_DOWNLOAD,
    HR_COMPLIANCE_FORM16_DOWNLOAD,
    HR_COMPLIANCE_PF_ECR_DOWNLOAD,
    HR_COMPLIANCE_PT_RETURN_DOWNLOAD,
    HR_COMPLIANCE_WPS_DOWNLOAD,
} from '@/constants/urls';
import {
    downloadComplianceFile,
    fetchTaxConfiguration,
    hrKeys,
    resolveComplianceCountry,
} from '@/routes/erp/-shared/hr-service';
import { HrNoAccessCard } from '@/routes/erp/people/-components/HrStates';
import { FY_QUARTERS, financialYearOf, recentFinancialYears } from './compliance-shared';
import { EcrPreview, EsiPreview, PtPreview, WpsPreview } from './MonthlyFilingPreviews';
import { Form16Preview, Form24QPreview } from './TdsFilingPreviews';

type FilingKey = 'ECR' | 'ESI' | 'PT' | 'WPS' | 'FORM16' | 'FORM24Q';

interface FilingDef {
    key: FilingKey;
    title: string;
    blurb: string;
    /** Which period control this filing is driven by. */
    period: 'month' | 'fy' | 'fy-quarter';
    /** Countries this filing exists for. */
    countries: Array<'IND' | 'ARE' | 'SAU'>;
    downloadUrl: string;
    fileHint?: string;
}

const buildFilings = (t: TFunction): FilingDef[] => [
    {
        key: 'ECR',
        title: t('filings.ecr.title'),
        blurb: t('filings.ecr.blurb'),
        period: 'month',
        countries: ['IND'],
        downloadUrl: HR_COMPLIANCE_PF_ECR_DOWNLOAD,
        fileHint: t('filings.ecr.fileHint'),
    },
    {
        key: 'ESI',
        title: t('filings.esi.title'),
        blurb: t('filings.esi.blurb'),
        period: 'month',
        countries: ['IND'],
        downloadUrl: HR_COMPLIANCE_ESI_RETURN_DOWNLOAD,
    },
    {
        key: 'PT',
        title: t('filings.pt.title'),
        blurb: t('filings.pt.blurb'),
        period: 'month',
        countries: ['IND'],
        downloadUrl: HR_COMPLIANCE_PT_RETURN_DOWNLOAD,
    },
    {
        key: 'FORM24Q',
        title: t('filings.form24q.title'),
        blurb: t('filings.form24q.blurb'),
        period: 'fy-quarter',
        countries: ['IND'],
        downloadUrl: HR_COMPLIANCE_24Q_DOWNLOAD,
        fileHint: t('filings.form24q.fileHint'),
    },
    {
        key: 'FORM16',
        title: t('filings.form16.title'),
        blurb: t('filings.form16.blurb'),
        period: 'fy',
        countries: ['IND'],
        downloadUrl: HR_COMPLIANCE_FORM16_DOWNLOAD,
    },
    {
        key: 'WPS',
        title: t('filings.wps.title'),
        blurb: t('filings.wps.blurb'),
        period: 'month',
        countries: ['ARE', 'SAU'],
        downloadUrl: HR_COMPLIANCE_WPS_DOWNLOAD,
        fileHint: t('filings.wps.fileHint'),
    },
];

/**
 * Statutory filings for the institute's country.
 *
 * Previews are deliberately lazy: opening this page fires no filing requests at
 * all (each report is an expensive per-employee aggregation), and only the card
 * you ask about runs. Cards for filings that do not apply to the configured
 * country are not rendered — a disabled "PF ECR" on a Dubai institute is noise,
 * not information.
 */
export const FilingsHub = () => {
    const { t } = useTranslation('erpFilingsHub');
    const { isHrAdmin } = useHrRole();
    const [month, setMonth] = useState<MonthValue>(() => previousMonthValue());
    const [financialYear, setFinancialYear] = useState<string>(() => financialYearOf());
    const [quarter, setQuarter] = useState<string>('Q1');
    const [openFiling, setOpenFiling] = useState<FilingKey | null>(null);

    const FILINGS = useMemo(() => buildFilings(t), [t]);

    const { data: taxConfig } = useQuery({
        queryKey: hrKeys.taxConfig(),
        queryFn: fetchTaxConfiguration,
        enabled: !!getInstituteId() && isHrAdmin,
        staleTime: 10 * 60 * 1000,
    });

    if (!isHrAdmin) {
        return <HrNoAccessCard />;
    }

    // No config yet → assume India rather than hiding everything: a fresh
    // institute has not set a country, and India is the platform's default.
    const country = resolveComplianceCountry(taxConfig) ?? 'IND';
    const visibleFilings = FILINGS.filter((f) => f.countries.includes(country));

    const periodLabel = (filing: FilingDef) =>
        filing.period === 'month'
            ? formatMonthValue(month)
            : filing.period === 'fy'
              ? `FY ${financialYear}`
              : `FY ${financialYear} · ${quarter}`;

    const handleDownload = async (filing: FilingDef) => {
        const params: Record<string, unknown> =
            filing.period === 'month'
                ? { month: month.month, year: month.year }
                : filing.period === 'fy'
                  ? { financialYear }
                  : { financialYear, quarter };

        // Form 16 is per-employee; it is downloaded from inside its own preview
        // where an employee has been chosen.
        if (filing.key === 'FORM16') {
            setOpenFiling('FORM16');
            return;
        }

        const stamp =
            filing.period === 'month' ? `${month.month}_${month.year}` : `${financialYear}${filing.period === 'fy-quarter' ? `_${quarter}` : ''}`;
        const ext = filing.key === 'ECR' || filing.key === 'WPS' ? 'txt' : 'csv';

        try {
            await downloadComplianceFile(
                filing.downloadUrl,
                params,
                `${filing.key.toLowerCase()}_${stamp}.${ext}`
            );
            toast.success(t('downloadedToast', { title: filing.title }));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('downloadErrorFallback', { title: filing.title }),
            });
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
                <p className="text-body text-neutral-500">{t('intro')}</p>
                <div className="flex flex-wrap items-center gap-3">
                    <MonthPicker
                        value={month}
                        onChange={setMonth}
                        disableFuture
                        label={t('monthlyFilingsLabel')}
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-body text-neutral-500">{t('tdsLabel')}</span>
                        <MyDropdown
                            currentValue={financialYear}
                            dropdownList={recentFinancialYears()}
                            handleChange={(v) => setFinancialYear(String(v))}
                        />
                        <MyDropdown
                            currentValue={
                                FY_QUARTERS.find((q) => q.value === quarter)?.label ?? quarter
                            }
                            dropdownList={FY_QUARTERS.map((q) => q.label)}
                            handleChange={(v) =>
                                setQuarter(
                                    FY_QUARTERS.find((q) => q.label === String(v))?.value ?? 'Q1'
                                )
                            }
                        />
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleFilings.map((filing) => (
                    <Card key={filing.key} className="flex flex-col gap-3 p-5">
                        <div className="flex items-start gap-3">
                            <span className="rounded-md bg-primary-50 p-2 text-primary-500">
                                <FileText size={20} />
                            </span>
                            <div className="flex flex-col">
                                <span className="text-subtitle font-semibold text-neutral-700">
                                    {filing.title}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {periodLabel(filing)}
                                </span>
                            </div>
                        </div>
                        <p className="text-body text-neutral-600">{filing.blurb}</p>
                        {filing.fileHint && (
                            <p className="text-caption text-warning-700">{filing.fileHint}</p>
                        )}
                        <div className="mt-auto flex items-center gap-2 pt-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setOpenFiling(filing.key)}
                            >
                                <Eye size={15} />
                                {t('preview')}
                            </MyButton>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onAsyncClick={async () => {
                                    await handleDownload(filing);
                                }}
                                loadingText={t('preparing')}
                            >
                                <DownloadSimple size={15} />
                                {t('download')}
                            </MyButton>
                        </div>
                    </Card>
                ))}
            </div>

            <Sheet open={!!openFiling} onOpenChange={(open) => !open && setOpenFiling(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
                    <SheetHeader>
                        <SheetTitle>
                            {FILINGS.find((f) => f.key === openFiling)?.title}
                            <span className="ms-2 text-body font-normal text-neutral-500">
                                {openFiling
                                    ? periodLabel(FILINGS.find((f) => f.key === openFiling)!)
                                    : ''}
                            </span>
                        </SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">
                        {openFiling === 'ECR' && <EcrPreview period={month} />}
                        {openFiling === 'ESI' && <EsiPreview period={month} />}
                        {openFiling === 'PT' && <PtPreview period={month} />}
                        {openFiling === 'WPS' && <WpsPreview period={month} />}
                        {openFiling === 'FORM16' && <Form16Preview financialYear={financialYear} />}
                        {openFiling === 'FORM24Q' && (
                            <Form24QPreview financialYear={financialYear} quarter={quarter} />
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
};
