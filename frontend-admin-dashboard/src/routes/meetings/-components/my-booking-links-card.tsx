import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, Copy, LinkSimple, Plus, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { getUserId } from '@/utils/userDetails';
import { useBookingPages } from '../-hooks/use-meetings';
import { publicBookingLink } from '../-utils/meetings-utils';
import { SideCard } from './meetings-page-parts';

const MAX_SHOWN = 3;

/**
 * "Your booking links" side card on My Schedule. Uses the same params — so the
 * same query key and cache entry — as BookingPagesManagerDialog, so opening the
 * dialog does not fetch a second list and its create / edit / delete refresh this
 * card too. Nothing is fetched when the page opens: the card shows the list if the
 * dialog already loaded it, otherwise a button loads it on demand.
 */
export function MyBookingLinksCard({ onManage }: { onManage: () => void }) {
    const { t } = useTranslation('meetingsMyScheduleIndexLazy');
    const instituteId = getInstituteId();
    const currentUserId = getUserId();
    const [requested, setRequested] = useState(false);
    const {
        data: pages,
        isLoading,
        error,
    } = useBookingPages({
        instituteId,
        hostUserId: currentUserId || undefined,
        enabled: requested,
    });

    const copy = async (link: string) => {
        try {
            await navigator.clipboard.writeText(link);
            toast.success(t('linksCard.copied'));
        } catch {
            toast.error(t('linksCard.copyFailed'));
        }
    };

    const list = pages ?? [];
    const shown = list.slice(0, MAX_SHOWN);
    const more = list.length - shown.length;

    let body: React.ReactNode;
    if (!pages && !requested) {
        body = (
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="sm:min-w-0"
                onClick={() => setRequested(true)}
            >
                <LinkSimple className="mr-1 size-3.5" />
                {t('linksCard.show')}
            </MyButton>
        );
    } else if (isLoading) {
        body = (
            <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
            </div>
        );
    } else if (error) {
        body = (
            <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                <WarningCircle size={14} className="shrink-0 text-danger-600" />
                {t('linksCard.error')}
            </p>
        );
    } else if (list.length === 0) {
        body = (
            <div className="flex flex-col items-start gap-2">
                <p className="text-caption text-neutral-500">{t('linksCard.empty')}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="sm:min-w-0"
                    onClick={onManage}
                >
                    <Plus className="mr-1 size-3.5" />
                    {t('linksCard.create')}
                </MyButton>
            </div>
        );
    } else {
        body = (
            <div className="flex flex-col gap-2">
                {shown.map((page) => {
                    const link = publicBookingLink(page.slug);
                    return (
                        <div
                            key={page.id ?? page.slug ?? page.title}
                            className="flex items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-caption font-semibold text-neutral-700">
                                    {page.title}
                                    {page.duration_minutes != null && (
                                        <span className="font-normal text-neutral-500">
                                            {' · '}
                                            {t('linksCard.minutes', {
                                                count: page.duration_minutes,
                                            })}
                                        </span>
                                    )}
                                </p>
                                <p className="truncate text-caption text-neutral-500">
                                    {link ?? t('linksCard.noLink')}
                                </p>
                            </div>
                            {link && (
                                <div className="flex shrink-0 items-center gap-1">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        layoutVariant="icon"
                                        title={t('linksCard.copy')}
                                        aria-label={t('linksCard.copy')}
                                        onClick={() => copy(link)}
                                    >
                                        <Copy className="size-3.5" />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        layoutVariant="icon"
                                        title={t('linksCard.open')}
                                        aria-label={t('linksCard.open')}
                                        onClick={() =>
                                            window.open(link, '_blank', 'noopener,noreferrer')
                                        }
                                    >
                                        <ArrowSquareOut className="size-3.5" />
                                    </MyButton>
                                </div>
                            )}
                        </div>
                    );
                })}
                {more > 0 && (
                    <button
                        type="button"
                        onClick={onManage}
                        className="self-start text-caption font-medium text-primary-600 hover:underline"
                    >
                        {t('linksCard.more', { count: more })}
                    </button>
                )}
            </div>
        );
    }

    return (
        <SideCard
            icon={LinkSimple}
            title={t('linksCard.title')}
            footer={t('linksCard.footer')}
            action={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="sm:min-w-0"
                    onClick={onManage}
                >
                    {t('linksCard.manage')}
                </MyButton>
            }
        >
            {body}
        </SideCard>
    );
}
