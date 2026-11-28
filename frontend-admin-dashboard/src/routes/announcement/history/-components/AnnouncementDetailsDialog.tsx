import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartBar, UsersThree } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AnnouncementService } from '@/services/announcement';
import type { Announcement } from '../-types';
import { joinParts, humanize, utcParts } from '../-utils/format';
import { useDescribeRecipient, useUserNames } from '../-hooks/useRecipientNames';
import { AnnouncementStatusChip, EnumChips, NameAvatar, ScheduleSummary } from './primitives';

export function AnnouncementDetailsDialog({
    announcement,
    onClose,
    onOpenStats,
}: {
    announcement: Announcement | null;
    onClose: () => void;
    onOpenStats: (a: Announcement) => void;
}) {
    const { t } = useTranslation('announcementHistoryIndex');

    // Planned / Past rows come from the calendar endpoints, which carry no content or recipients.
    const needsFull = !!announcement && !announcement.recipients;
    const fullQ = useQuery({
        queryKey: ['announcementHistoryDetails', announcement?.id],
        queryFn: async (): Promise<Announcement> => AnnouncementService.getById(announcement!.id),
        enabled: needsFull,
        refetchOnWindowFocus: false,
    });
    const a: Announcement | null = needsFull ? fullQ.data ?? announcement : announcement;
    const loadingFull = needsFull && fullQ.isLoading;

    return (
        <MyDialog
            heading={t('detailsDialog.title')}
            open={!!announcement}
            onOpenChange={(open) => !open && onClose()}
            dialogWidth="max-w-4xl"
            footer={
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('detailsDialog.close')}
                    </MyButton>
                    {a && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                onClose();
                                onOpenStats(a);
                            }}
                        >
                            <ChartBar className="size-4" />
                            {t('detailsDialog.viewStats')}
                        </MyButton>
                    )}
                </>
            }
        >
            {a && (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="text-h3-semibold text-neutral-900">{a.title}</h3>
                            <p className="mt-1 text-caption text-neutral-500">
                                {t('detailsDialog.createdLine', {
                                    name: a.createdByName || t('detailsDialog.system'),
                                    when: joinParts(utcParts(a.createdAt)),
                                })}
                            </p>
                        </div>
                        <AnnouncementStatusChip status={a.status} />
                    </div>

                    <div className="grid gap-4 md:grid-cols-5">
                        <div className="flex flex-col gap-4 md:col-span-3">
                            <InfoCard a={a} />
                            <ContentCard a={a} loading={loadingFull} />
                        </div>
                        <div className="md:col-span-2">
                            <RecipientsCard a={a} loading={loadingFull} />
                        </div>
                    </div>
                </div>
            )}
        </MyDialog>
    );
}

function InfoCard({ a }: { a: Announcement }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const rows: Array<{ label: string; value: React.ReactNode }> = [
        {
            label: t('detailsDialog.createdBy'),
            value: (
                <span>
                    {a.createdByName || t('detailsDialog.system')}
                    {a.createdByRole && (
                        <span className="text-neutral-500">
                            {' · '}
                            {t(`roles.${a.createdByRole}`, {
                                defaultValue: humanize(a.createdByRole),
                            })}
                        </span>
                    )}
                </span>
            ),
        },
        { label: t('detailsDialog.createdAt'), value: joinParts(utcParts(a.createdAt)) },
        {
            label: t('detailsDialog.modes'),
            value: <EnumChips group="modes" values={(a.modes ?? []).map((m) => m.modeType)} />,
        },
        {
            label: t('detailsDialog.mediums'),
            value: (
                <EnumChips
                    group="mediums"
                    variant="outline"
                    values={(a.mediums ?? []).map((m) => m.mediumType)}
                />
            ),
        },
        {
            label: t('detailsDialog.schedule'),
            value: <ScheduleSummary scheduling={a.scheduling} />,
        },
    ];
    return (
        <dl className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white shadow-sm">
            {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-3 gap-3 px-4 py-3">
                    <dt className="text-caption font-semibold text-neutral-500">{r.label}</dt>
                    <dd className="col-span-2 text-body text-neutral-800">{r.value}</dd>
                </div>
            ))}
        </dl>
    );
}

function ContentCard({ a, loading }: { a: Announcement; loading: boolean }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const raw = a.content?.content?.trim() ?? '';
    const html = useMemo(
        () => (a.content?.type === 'html' && raw ? DOMPurify.sanitize(raw) : ''),
        [a.content?.type, raw]
    );
    return (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h4 className="mb-2 text-subtitle font-semibold text-neutral-800">
                {t('detailsDialog.content')}
            </h4>
            {loading ? (
                <Skeleton className="h-16 w-full" />
            ) : html ? (
                <div
                    className="prose prose-sm max-h-64 max-w-none overflow-auto text-neutral-700"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            ) : raw ? (
                <p className="max-h-64 overflow-auto whitespace-pre-wrap text-body text-neutral-700">
                    {raw}
                </p>
            ) : (
                <p className="text-body text-neutral-400">{t('detailsDialog.noContent')}</p>
            )}
        </section>
    );
}

function RecipientsCard({ a, loading }: { a: Announcement; loading: boolean }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const recipients = useMemo(() => a.recipients ?? [], [a.recipients]);
    const userIds = useMemo(
        () => recipients.filter((r) => r.recipientType === 'USER').map((r) => r.recipientId),
        [recipients]
    );
    const { names, isLoading } = useUserNames(userIds);
    const describe = useDescribeRecipient(names);

    return (
        <section className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
                <UsersThree className="size-5 text-primary-500" />
                <h4 className="text-subtitle font-semibold text-neutral-800">
                    {t('detailsDialog.recipientsCount', { count: recipients.length })}
                </h4>
            </div>
            {loading || isLoading ? (
                <div className="flex flex-col gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                    ))}
                </div>
            ) : recipients.length === 0 ? (
                <p className="p-4 text-body text-neutral-400">{t('detailsDialog.noRecipients')}</p>
            ) : (
                <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto">
                    {recipients.map((r, i) => {
                        const label = describe(r);
                        return (
                            <li key={r.id ?? i} className="flex items-center gap-3 px-4 py-2">
                                <NameAvatar name={label.name} muted={!label.isUser} />
                                <div className="min-w-0">
                                    <div className="truncate text-body text-neutral-800">
                                        {label.name}
                                    </div>
                                    <div className="text-caption text-neutral-500">
                                        {label.kind}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
