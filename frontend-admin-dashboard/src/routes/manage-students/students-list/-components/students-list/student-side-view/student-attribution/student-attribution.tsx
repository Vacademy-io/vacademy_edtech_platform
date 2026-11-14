import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Megaphone } from '@phosphor-icons/react';
import { ProfileSectionCard, ProfileFieldRow } from '../profile-ui';
import {
    fetchUtmAttributionForUser,
    utmAttributionQueryKey,
    type UtmAttributionRecord,
} from '@/services/utm-attribution';
import { cn } from '@/lib/utils';

/**
 * "Where did this learner come from?" — the campaign that produced them.
 *
 * Renders NOTHING when there is no attribution, which is the normal case for
 * most learners: they arrived before the institute started tagging links, or on
 * an untagged one. An empty "Campaign source — N/A" card on every profile would
 * be pure noise, so absence is silence rather than an empty state.
 *
 * Not gated on the UTM builder switch. That switch decides whether an admin can
 * GENERATE tagged links; a learner who arrived on a link someone tagged by hand
 * still has a real campaign behind them, and hiding it because a setting is off
 * would be hiding data the institute already has.
 */
export const StudentAttribution = ({
    userId,
    instituteId,
    email,
    mobileNumber,
}: {
    userId: string | undefined;
    instituteId: string | undefined;
    /** Sent so touches captured before this learner had a user id still match. */
    email?: string;
    mobileNumber?: string;
}) => {
    const { t } = useTranslation('manageStudentsAttribution');

    const { data: touches = [] } = useQuery({
        queryKey: utmAttributionQueryKey(userId ?? '', instituteId ?? '', email, mobileNumber),
        queryFn: () => fetchUtmAttributionForUser(userId ?? '', instituteId ?? '', email, mobileNumber),
        enabled: Boolean(instituteId && (userId || email || mobileNumber)),
        staleTime: 5 * 60 * 1000,
    });

    if (touches.length === 0) return null;

    // Oldest first from the API. First touch is the one that gets the credit —
    // the campaign that introduced them — while the most recent is what a
    // counsellor picking up the phone today wants to reference.
    const firstTouch = touches[0] as UtmAttributionRecord;
    const latestTouch = touches[touches.length - 1] as UtmAttributionRecord;
    const hasMultiple = touches.length > 1;

    const formatDate = (raw: string | null) => {
        if (!raw) return '';
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString();
    };

    const renderTouch = (touch: UtmAttributionRecord, keyPrefix: string) => (
        <>
            <ProfileFieldRow
                key={`${keyPrefix}-source`}
                label={t('fields.source')}
                value={touch.utm_source || ''}
            />
            <ProfileFieldRow
                key={`${keyPrefix}-medium`}
                label={t('fields.medium')}
                value={touch.utm_medium || ''}
            />
            <ProfileFieldRow
                key={`${keyPrefix}-campaign`}
                label={t('fields.campaign')}
                value={touch.utm_campaign || ''}
            />
            {touch.utm_content && (
                <ProfileFieldRow
                    key={`${keyPrefix}-content`}
                    label={t('fields.content')}
                    value={touch.utm_content}
                />
            )}
            {touch.utm_term && (
                <ProfileFieldRow
                    key={`${keyPrefix}-term`}
                    label={t('fields.term')}
                    value={touch.utm_term}
                />
            )}
            <ProfileFieldRow
                key={`${keyPrefix}-surface`}
                label={t('fields.capturedOn')}
                value={t(`surface.${touch.source_type}`, { defaultValue: touch.source_type })}
            />
            {touch.referrer_host && (
                <ProfileFieldRow
                    key={`${keyPrefix}-referrer`}
                    label={t('fields.referrer')}
                    value={touch.referrer_host}
                />
            )}
            <ProfileFieldRow
                key={`${keyPrefix}-date`}
                label={t('fields.date')}
                value={formatDate(touch.created_at)}
            />
        </>
    );

    return (
        <ProfileSectionCard icon={Megaphone} heading={t('heading')}>
            <div className="space-y-4">
                <div>
                    {hasMultiple && (
                        <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('labels.firstTouch')}
                        </p>
                    )}
                    <dl>{renderTouch(firstTouch, 'first')}</dl>
                </div>

                {hasMultiple && (
                    <div className={cn('border-t border-neutral-200 pt-4')}>
                        <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('labels.latestTouch', { count: touches.length })}
                        </p>
                        <dl>{renderTouch(latestTouch, 'latest')}</dl>
                    </div>
                )}
            </div>
        </ProfileSectionCard>
    );
};

export default StudentAttribution;
