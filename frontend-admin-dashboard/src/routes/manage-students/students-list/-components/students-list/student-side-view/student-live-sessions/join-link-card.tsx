import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LinkSimple, VideoCamera } from '@phosphor-icons/react';
import { StatusChip } from '@/components/design-system/status-chips';
import { Skeleton } from '@/components/ui/skeleton';
import { copyTextToClipboard } from '@/lib/clipboard';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useShortLink } from '@/hooks/use-short-link';
import { useAudienceShortLinksEnabled } from '@/hooks/use-audience-short-links-enabled';
import { SHORT_LINK_SOURCE } from '@/services/short-link';
import {
    getLearnerUpcomingLiveSessionsQuery,
    type LearnerUpcomingClass,
} from '@/services/learner-live-sessions';
import {
    formatMeetingDate,
    formatTimeRange,
} from '@/routes/study-library/live-session/-utils/live-sesstions';
import { ProfileFieldRow, ProfileSectionCard } from '../profile-ui';
import { browserTimezone } from './live-session-helpers';

const UPCOMING_LIMIT = 5;

/** Learner-portal page listing the learner's live classes — the same link for every class. */
const LIVE_CLASSES_ROUTE = '/study-library/live-class';

/** `learner_portal_base_url` is stored with and without a scheme / trailing slash. */
const liveClassesUrl = (portalBase: string) => {
    if (!portalBase) return null;
    const base = (portalBase.startsWith('http') ? portalBase : `https://${portalBase}`).replace(/\/+$/, '');
    return `${base}${LIVE_CLASSES_ROUTE}`;
};

/** "Tue, 28 Oct 2026 · 11:00 AM – 12:00 PM (Asia/Kolkata)" — zone only when it differs from the viewer's. */
const describeWhen = (c: LearnerUpcomingClass) => {
    const parts = [formatMeetingDate(c.meeting_date), formatTimeRange(c.start_time, c.last_entry_time)]
        .filter(Boolean)
        .join(' · ');
    return c.timezone && c.timezone !== browserTimezone() ? `${parts} (${c.timezone})` : parts;
};

const LinkValue = ({ url }: { url: string }) => (
    <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 hover:underline"
        title={url}
    >
        {url}
    </a>
);

/** A link row with its own copied-tick state. */
const CopyableLinkRow = ({ label, url }: { label: string; url: string }) => {
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        if (await copyTextToClipboard(url)) {
            setCopied(true);
            toast.success(`${label} copied`);
            setTimeout(() => setCopied(false), 1500);
        } else {
            toast.error('Could not copy the link');
        }
    };
    return <ProfileFieldRow label={label} value={<LinkValue url={url} />} copied={copied} onCopy={onCopy} />;
};

/** Portal live-classes link + its short link. One short link per institute, shared by every learner. */
const PortalLinks = ({ portalLink }: { portalLink: string }) => {
    const instituteId = getCurrentInstituteId() ?? undefined;
    const shortLinks = useAudienceShortLinksEnabled();
    const { shortUrl, isLoading: shortLoading } = useShortLink({
        source: SHORT_LINK_SOURCE.LIVE_CLASSES_PAGE,
        sourceId: instituteId,
        destinationUrl: portalLink,
        instituteId,
        // Shortening writes a row — only once the institute's switch is known to be on.
        enabled: shortLinks.isResolved && shortLinks.enabled,
    });

    return (
        <>
            <CopyableLinkRow label="Join link" url={portalLink} />
            {shortLinks.enabled &&
                (shortUrl ? (
                    <CopyableLinkRow label="Short link" url={shortUrl} />
                ) : shortLoading ? (
                    <ProfileFieldRow label="Short link" value={<Skeleton className="h-3 w-32" />} />
                ) : null)}
        </>
    );
};

const UpcomingRow = ({ c }: { c: LearnerUpcomingClass }) => (
    <li className="py-1.5">
        <p className="truncate text-caption font-medium text-card-foreground">{c.title || 'Live class'}</p>
        <p className="truncate text-2xs text-muted-foreground">{describeWhen(c)}</p>
    </li>
);

export const JoinLinkCard = ({ userId, batchId }: { userId: string; batchId?: string }) => {
    const portalBase = useInstituteDetailsStore((s) => s.instituteDetails?.learner_portal_base_url) ?? '';
    const portalLink = liveClassesUrl(portalBase);
    const { data, isLoading, isError } = useQuery(
        getLearnerUpcomingLiveSessionsQuery(userId, UPCOMING_LIMIT, batchId)
    );
    const [next, ...later] = data ?? [];

    return (
        <ProfileSectionCard icon={LinkSimple} heading={next?.live ? 'Live now' : 'Next class'}>
            <div className="flex flex-col gap-2">
                {/* Not class-specific, so shown even when nothing is scheduled. */}
                {portalLink && (
                    <dl className="flex flex-col">
                        <PortalLinks portalLink={portalLink} />
                    </dl>
                )}
                {isLoading ? (
                    <div className="flex flex-col gap-2 py-1">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                ) : isError ? (
                    <p className="py-1 text-2xs text-danger-600">Couldn't load upcoming classes.</p>
                ) : !next ? (
                    <div className="flex items-center gap-2 py-1 text-2xs text-muted-foreground">
                        <VideoCamera className="size-4" />
                        No upcoming live classes for this learner.
                    </div>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-2 border-t border-border pt-2">
                            <div className="min-w-0">
                                <p className="truncate text-body font-semibold text-card-foreground">
                                    {next.title || 'Live class'}
                                </p>
                                <p className="text-2xs text-muted-foreground">
                                    {[next.subject, describeWhen(next)].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            {next.live && (
                                <StatusChip text="Live" textSize="text-caption" status="SUCCESS" />
                            )}
                        </div>
                        {next.meeting_link && (
                            <dl className="flex flex-col">
                                <CopyableLinkRow label="Meeting room" url={next.meeting_link} />
                            </dl>
                        )}
                        {later.length > 0 && (
                            <div className="border-t border-border pt-1.5">
                                <p className="text-2xs font-semibold text-muted-foreground">Coming up</p>
                                <ul className="flex flex-col divide-y divide-border">
                                    {later.map((c) => (
                                        <UpcomingRow key={c.schedule_id} c={c} />
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ProfileSectionCard>
    );
};
