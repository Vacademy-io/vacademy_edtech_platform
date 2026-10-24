import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Lock } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/formatters';
import { useUsageSummaryQuery } from '@/services/ai-credits/usage-v2';
import { apiErrorMessage, useEffectiveLimitsQuery } from '../../-services/ai-limits-service';
import { amount, limitCell, scopeText, subjectText, unitText } from './limit-labels';
import { DecisionChip } from './DecisionChip';

/** "Why is this person blocked?" — every limit that applies to one member. */
export function EffectiveLimitsCard({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsAiLimits');
    const [userId, setUserId] = useState<string | null>(null);
    const usersQ = useUsageSummaryQuery(instituteId, 90, 'user', 'list');
    const effectiveQ = useEffectiveLimitsQuery(instituteId, userId);

    const options = useMemo(
        () =>
            (usersQ.data?.rows ?? [])
                .filter((r) => !!r.key)
                .map((r) => ({ value: r.key, label: r.label || r.key })),
        [usersQ.data]
    );

    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <MagnifyingGlass className="size-5 text-primary-500" />
                    {t('effective.title')}
                </CardTitle>
                <CardDescription>{t('effective.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="w-full sm:w-96">
                    <SearchableSelect
                        options={options}
                        value={userId ?? ''}
                        onChange={(v) => setUserId(v || null)}
                        placeholder={usersQ.isLoading ? t('dialog.loading') : t('dialog.pickUser')}
                        searchPlaceholder={t('dialog.searchUser')}
                        emptyText={t('dialog.noUsers')}
                    />
                </div>

                {userId && effectiveQ.isLoading && (
                    <p className="text-sm text-neutral-500">{t('dialog.loading')}</p>
                )}
                {userId && effectiveQ.isError && (
                    <p className="text-sm text-danger-600">
                        {apiErrorMessage(effectiveQ.error) || t('effective.failed')}
                    </p>
                )}
                {userId && effectiveQ.data && effectiveQ.data.length === 0 && (
                    <p className="text-sm text-neutral-500">{t('effective.none')}</p>
                )}
                {userId && effectiveQ.data && effectiveQ.data.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-neutral-200">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('table.feature')}</TableHead>
                                    <TableHead>{t('effective.source')}</TableHead>
                                    <TableHead>{t('table.period')}</TableHead>
                                    <TableHead className="text-end">
                                        {t('effective.used')}
                                    </TableHead>
                                    <TableHead className="text-end">{t('table.soft')}</TableHead>
                                    <TableHead className="text-end">{t('table.hard')}</TableHead>
                                    <TableHead>{t('effective.resets')}</TableHead>
                                    <TableHead>{t('effective.status')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {effectiveQ.data.map((e, i) => {
                                    const row = e.row;
                                    const isPlatform = row?.origin === 'PLATFORM';
                                    return (
                                        <TableRow
                                            key={`${row?.id ?? 'x'}-${e.period ?? ''}-${i}`}
                                            className={e.selected ? undefined : 'opacity-60'}
                                        >
                                            <TableCell className="text-sm">
                                                {e.scope_label || (row ? scopeText(t, row) : '—')}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                <span className="flex items-center gap-1.5">
                                                    {isPlatform && (
                                                        <Lock className="size-3.5 text-neutral-500" />
                                                    )}
                                                    {row ? subjectText(t, row) : e.scope ?? ''}
                                                </span>
                                                {e.why && (
                                                    <span className="block text-caption text-neutral-500">
                                                        {e.why}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {e.period
                                                    ? t(`period.${e.period}`, {
                                                          defaultValue: e.period,
                                                      })
                                                    : ''}
                                            </TableCell>
                                            <TableCell className="text-end text-sm font-medium">
                                                {e.used === null ? (
                                                    '—'
                                                ) : (
                                                    <>
                                                        {amount(e.used)}{' '}
                                                        <span className="text-caption font-normal text-neutral-500">
                                                            {unitText(t, e.metric ?? row?.metric)}
                                                        </span>
                                                    </>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-end text-sm">
                                                {limitCell(t, e.soft, false)}
                                            </TableCell>
                                            <TableCell className="text-end text-sm">
                                                {limitCell(t, e.hard, true)}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {e.resets_at ? formatDateTime(e.resets_at) : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <DecisionChip decision={e.decision} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
