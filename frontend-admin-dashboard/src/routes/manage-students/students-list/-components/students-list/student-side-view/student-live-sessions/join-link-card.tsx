import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, LinkSimple, VideoCamera } from '@phosphor-icons/react';
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
    getSessionJoinLink,
    formatMeetingDate,
    formatTimeRange,
} from '@/routes/study-library/live-session/-utils/live-sesstions';
import { ProfileFieldRow, ProfileSectionCard } from '../profile-ui';
import { browserTimezone } from './live-session-helpers';

const UPCOMING_LIMIT = 5;

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

/** Portal join link + short link for one class. The short link is minted once per class and shared by every learner. */
const NextClassLinks = ({ next, portalBase }: { next: LearnerUpcomingClass; portalBase: string }) => {
    const instituteId = getCurrentInstituteId() ?? undefined;
    const shortLinks = useAudienceShortLinksEnabled();
    const portalLink = portalBase
        ? getSessionJoinLink(
              { access_level: next.access_level, schedule_id: next.schedule_id, session_id: next.session_id },
              portalBase
          )
        : null;
    // getSessionJoinLink keys private classes on the schedule and public ones on the session;
    // the short link is keyed the same way so it always points where the long link does.
    const shortLinkSourceId = next.access_level === 'private' ? next.schedule_id : next.session_id;
    const { shortUrl, isLoading: shortLoading } = useShortLink({
        source: SHORT_LINK_SOURCE.LIVE_SESSION,
        sourceId: shortLinkSourceId,
        destinationUrl: portalLink ?? undefined,
        instituteId,
        // Shortening writes a row — only once the institute's switch is known to be on.
        enabled: shortLinks.isResolved && shortLinks.enabled && !!portalLink,
    });

    return (
        <dl className="flex flex-col">
            {portalLink && <CopyableLinkRow label="Join link" url={portalLink} />}
            {shortLinks.enabled && portalLink && (
                shortUrl ? (
                    <CopyableLinkRow label="Short link" url={shortUrl} />
                ) : shortLoading ? (
                    <ProfileFieldRow label="Short link" value={<Skeleton className="h-3 w-32" />} />
                ) : null
            )}
            {next.meeting_link && <CopyableLinkRow label="Meeting room" url={next.meeting_link} />}
            {!portalLink && !next.meeting_link && (
                <p className="py-1 text-2xs text-muted-foreground">
                    No join link is set up for this class yet.
                </p>
            )}
        </dl>
    );
};

const UpcomingRow = ({ c, portalBase }: { c: LearnerUpcomingClass; portalBase: string }) => {
    const [copied, setCopied] = useState(false);
    const link = portalBase
        ? getSessionJoinLink(
              { access_level: c.access_level, schedule_id: c.schedule_id, session_id: c.session_id },
              portalBase
          )
        : c.meeting_link;
    const onCopy = async () => {
        if (link && (await copyTextToClipboard(link))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };
    return (
        <li className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
                <p className="truncate text-caption font-medium text-card-foreground">
                    {c.title || 'Live class'}
                </p>
                <p className="truncate text-2xs text-muted-foreground">{describeWhen(c)}</p>
            </div>
            {link && (
                <button
                    type="button"
                    onClick={onCopy}
                    aria-label={`Copy join link for ${c.title || 'this class'}`}
                    title="Copy join link"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    {copied ? (
                        <Check className="size-3.5 text-success-600" />
                    ) : (
                        <Copy className="size-3.5" />
                    )}
                </button>
            )}
        </li>
    );
};

export const JoinLinkCard = ({ userId, batchId }: { userId: string; batchId?: string }) => {
    const portalBase = useInstituteDetailsStore((s) => s.instituteDetails?.learner_portal_base_url) ?? '';
    const { data, isLoading, isError } = useQuery(
        getLearnerUpcomingLiveSessionsQuery(userId, UPCOMING_LIMIT, batchId)
    );
    const [next, ...later] = data ?? [];

    return (
        <ProfileSectionCard icon={LinkSimple} heading={next?.live ? 'Live now' : 'Next class'}>
            {isLoading ? (
                <div className="flex flex-col gap-2 py-1">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
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
                <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
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
                    <NextClassLinks next={next} portalBase={portalBase} />
                    {later.length > 0 && (
                        <div className="border-t border-border pt-1.5">
                            <p className="text-2xs font-semibold text-muted-foreground">
                                Coming up
                            </p>
                            <ul className="flex flex-col divide-y divide-border">
                                {later.map((c) => (
                                    <UpcomingRow key={c.schedule_id} c={c} portalBase={portalBase} />
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </ProfileSectionCard>
    );
};
