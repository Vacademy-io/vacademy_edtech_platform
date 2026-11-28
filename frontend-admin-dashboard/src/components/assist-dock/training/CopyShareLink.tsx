import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ShareNetwork } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import { SHORT_LINK_SOURCE, getOrCreateShortLink, toShortCodeHint } from '@/services/short-link';
import type { LibraryVideo } from './search';

const stripScheme = (url: string) => url.replace(/^https?:\/\//, '');

/**
 * Copies a short, public link to the video file — for pasting into WhatsApp or
 * an email when someone asks "how do I …?".
 *
 * The link is minted on click, not on render (get-or-create inserts a
 * `short_links` row), and keyed on the video id, so every admin who shares the
 * same video gets the same code. No instituteId on purpose: these are platform
 * videos, and `u.vacademy.io` always resolves, whereas an institute's own short
 * domain may not have its DNS set up yet.
 *
 * If the shortener is down, the full file URL is copied instead — sharing the
 * video matters more than the link being short.
 */
export function CopyShareLink({ video }: { video: LibraryVideo }) {
    const { t } = useTranslation('trainingViewer');
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);

    const copy = async () => {
        setBusy(true);
        let url = video.fileUrl;
        let shortened = false;
        try {
            const link = await queryClient.fetchQuery({
                queryKey: ['short-link', SHORT_LINK_SOURCE.TRAINING_VIDEO, video.id],
                queryFn: () =>
                    getOrCreateShortLink({
                        source: SHORT_LINK_SOURCE.TRAINING_VIDEO,
                        sourceId: video.id,
                        destinationUrl: video.fileUrl,
                        shortCode: toShortCodeHint(video.id),
                    }),
                staleTime: Infinity,
            });
            url = link.absoluteUrl;
            shortened = true;
        } catch {
            // Fall back to the long URL below.
        }
        const copied = await copyTextToClipboard(url);
        setBusy(false);
        if (!copied) toast.error(t('shareLinkCopyFailed'));
        else if (shortened) toast.success(t('shareLinkCopied', { url: stripScheme(url) }));
        else toast.success(t('shareLinkFallbackCopied'));
    };

    return (
        <MyButton buttonType="secondary" scale="medium" onClick={copy} disable={busy}>
            <ShareNetwork size={14} /> {t('copyShareLink')}
        </MyButton>
    );
}
