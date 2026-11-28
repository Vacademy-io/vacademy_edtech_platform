import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowsInLineHorizontal,
    Check,
    Copy,
    Link as LinkIcon,
    SpinnerGap,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { cn } from '@/lib/utils';
import { useShortLink } from '@/hooks/use-short-link';
import { useAudienceShortLinksEnabled } from '@/hooks/use-audience-short-links-enabled';
import { SHORT_LINK_SOURCE } from '@/services/short-link';
import createCampaignLink from '../../-utils/createCampaignLink';

interface CampaignLinkProps {
    campaignId?: string;
    presetLink?: string;
    label?: string;
    className?: string;
    /**
     * Offer a "Short" toggle that swaps the form URL for a `u.<domain>/s/<code>`
     * one. Off by default because shortening inserts a row server-side — it has
     * to be an explicit action, not a side effect of rendering a list. Still
     * subject to the institute's Short links switch.
     */
    enableShortLink?: boolean;
}

const CampaignLink: React.FC<CampaignLinkProps> = ({
    campaignId,
    presetLink,
    label,
    className,
    enableShortLink = false,
}) => {
    const { t } = useTranslation('audienceManagerCampaignLink');
    const { instituteDetails } = useInstituteDetailsStore();
    const [copySuccess, setCopySuccess] = useState(false);
    const [preferShort, setPreferShort] = useState(false);
    const { enabled: shortLinksEnabled, isResolved: shortLinksResolved } =
        useAudienceShortLinksEnabled();

    const shareableLink = useMemo(() => {
        if (presetLink) return presetLink;
        if (!campaignId) return '';
        return createCampaignLink(campaignId, instituteDetails?.learner_portal_base_url);
    }, [campaignId, presetLink, instituteDetails?.learner_portal_base_url]);

    // A short link is keyed on the campaign id, so a preset (already-built) link
    // with no campaign behind it can't be shortened. The institute switch gates
    // it on top of that.
    const canShorten = enableShortLink && !!campaignId && shortLinksEnabled;

    const {
        shortUrl,
        isLoading: isShortening,
        isError: shortLinkFailed,
    } = useShortLink({
        source: SHORT_LINK_SOURCE.AUDIENCE_CAMPAIGN,
        sourceId: campaignId,
        destinationUrl: shareableLink,
        instituteId: instituteDetails?.id,
        // `shortLinksResolved` as well as `canShorten`: this call WRITES a row,
        // and `shortLinksEnabled` reads optimistically true while the institute's
        // preference is still loading. Without it an opted-out institute would
        // still get a short link minted on a fast click.
        enabled: canShorten && preferShort && shortLinksResolved,
    });

    // Gated on `canShorten`, not just `preferShort`: the institute switch reads
    // ON while it loads, so an admin can toggle to the short URL a moment before
    // it resolves OFF. Without that guard the toggle button unmounts while the
    // card keeps displaying — and copying — a short link the institute disabled,
    // with no control left to get back. Pinned by a test in
    // -components/audience-short-link.test.tsx.
    //
    // `shortUrl` is also tested inside the conditional itself rather than via
    // `showingShort` — a boolean const carries no narrowing, so going through it
    // would leave `displayedLink` typed `string | null`.
    const displayedLink = canShorten && preferShort && shortUrl ? shortUrl : shareableLink;
    const showingShort = displayedLink !== shareableLink;

    // Shortening is a convenience: if it fails, say so once and drop straight
    // back to the long URL rather than leaving the admin with no link to share.
    // Guarded on `isShortening` so a retry doesn't re-toast while it is in flight.
    useEffect(() => {
        if (shortLinkFailed && !isShortening && preferShort) {
            toast.error(t('shortLink.failed'));
            setPreferShort(false);
        }
    }, [shortLinkFailed, isShortening, preferShort, t]);

    if (!shareableLink) {
        return null;
    }

    const handleCopy = () => {
        navigator.clipboard
            .writeText(displayedLink)
            .then(() => {
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
            })
            .catch((error) => {
                console.error('Unable to copy campaign link', error);
            });
    };

    return (
        <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
            {label && (
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
            )}
            <div className="group flex w-full min-w-0 items-stretch overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50/60 transition-colors focus-within:border-primary-300 focus-within:bg-white hover:border-neutral-300">
                <div className="flex shrink-0 items-center pl-3 pr-2 text-neutral-400">
                    <LinkIcon size={16} weight="bold" />
                </div>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <a
                                href={displayedLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={displayedLink}
                                className="min-w-0 flex-1 truncate py-2 pe-3 font-mono text-xs text-neutral-700 hover:text-primary-600 sm:text-body"
                            >
                                {displayedLink}
                            </a>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-md break-all">
                            {displayedLink}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                {canShorten && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isShortening}
                                    onClick={() => setPreferShort(!showingShort)}
                                    aria-label={
                                        showingShort
                                            ? t('shortLink.showFull')
                                            : t('shortLink.shorten')
                                    }
                                    className={cn(
                                        'shrink-0 rounded-none border-l border-neutral-200 px-3 hover:bg-neutral-100 hover:text-neutral-900',
                                        showingShort
                                            ? 'bg-primary-50 text-primary-600'
                                            : 'text-neutral-600'
                                    )}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {isShortening ? (
                                            <SpinnerGap
                                                size={14}
                                                weight="bold"
                                                className="animate-spin"
                                            />
                                        ) : (
                                            <ArrowsInLineHorizontal size={14} weight="bold" />
                                        )}
                                        <span className="hidden text-xs font-medium sm:inline">
                                            {showingShort
                                                ? t('shortLink.showFull')
                                                : t('shortLink.shorten')}
                                        </span>
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                                {showingShort
                                    ? t('shortLink.showFullHint')
                                    : t('shortLink.shortenHint')}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    aria-label={copySuccess ? t('copiedAriaLabel') : t('copyLinkAriaLabel')}
                    className="shrink-0 rounded-none border-l border-neutral-200 px-3 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                >
                    {copySuccess ? (
                        <span className="flex items-center gap-1.5 text-success-600">
                            <Check size={14} weight="bold" />
                            <span className="text-xs font-medium">{t('copied')}</span>
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5">
                            <Copy size={14} weight="bold" />
                            <span className="hidden text-xs font-medium sm:inline">
                                {t('copy')}
                            </span>
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default CampaignLink;
