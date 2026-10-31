import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WhatsAppTemplateButtons } from '@/components/shared/whatsapp/whatsapp-template-buttons';
import type { TemplateButton } from '../-services/template-api';

interface WhatsAppTemplateBubbleProps {
    headerType?: string;
    headerText?: string;
    headerSampleUrl?: string;
    bodyText: string;
    footerText?: string;
    buttons?: TemplateButton[];
    /** Shown bottom-right like WhatsApp's send time; omitted when not given. */
    timestamp?: string;
    /** Cut a long body to a few lines (list view); the caller offers the way to expand. */
    clampBody?: boolean;
    className?: string;
}

const PLACEHOLDER = /(\{\{\s*[\w.]+\s*\}\})/g;

/** Body text with every `{{n}}` drawn as a chip, so it is clear where a value gets filled in. */
function BodyWithPlaceholders({ text }: { text: string }) {
    return (
        <>
            {text.split(PLACEHOLDER).map((part, i) =>
                i % 2 === 1 ? (
                    <span
                        key={i}
                        className="mx-px rounded-sm bg-info-50 px-1 font-mono text-caption text-info-700"
                    >
                        {part}
                    </span>
                ) : (
                    <Fragment key={i}>{part}</Fragment>
                )
            )}
        </>
    );
}

/**
 * One WhatsApp template drawn the way the learner receives it: header, body, footer and its
 * buttons. Shared by the template builder's live preview and the template list.
 */
export function WhatsAppTemplateBubble({
    headerType,
    headerText,
    headerSampleUrl,
    bodyText,
    footerText,
    buttons,
    timestamp,
    clampBody,
    className,
}: WhatsAppTemplateBubbleProps) {
    const { t } = useTranslation('communicationTemplateBuilder');
    const type = (headerType || 'NONE').toUpperCase();
    const mediaBox =
        'flex items-center justify-center rounded-md bg-muted text-caption text-muted-foreground';

    return (
        <div className={cn('overflow-hidden rounded-lg bg-card shadow-sm', className)}>
            {type !== 'NONE' && (
                <div className="px-1 pt-1">
                    {type === 'TEXT' && (
                        <p className="px-2 pt-2 text-body font-semibold text-neutral-800">
                            {headerText || t('preview.headerTextFallback')}
                        </p>
                    )}
                    {type === 'IMAGE' &&
                        (headerSampleUrl ? (
                            <img src={headerSampleUrl} alt="" className="h-36 w-full rounded-md object-cover" />
                        ) : (
                            <div className={cn(mediaBox, 'h-32')}>{t('preview.imageFallback')}</div>
                        ))}
                    {type === 'VIDEO' && (
                        <div className={cn(mediaBox, 'h-32')}>{t('preview.videoFallback')}</div>
                    )}
                    {type === 'DOCUMENT' && (
                        <div className={cn(mediaBox, 'h-16')}>{t('preview.documentFallback')}</div>
                    )}
                </div>
            )}

            <div className="px-3 pb-1 pt-2">
                <p className={cn('whitespace-pre-wrap break-words text-body text-neutral-800', clampBody && 'line-clamp-6')}>
                    {bodyText ? <BodyWithPlaceholders text={bodyText} /> : t('preview.bodyFallback')}
                </p>
                {footerText && <p className="mt-1 text-caption text-neutral-400">{footerText}</p>}
                {timestamp && <p className="text-right text-caption text-neutral-400">{timestamp}</p>}
            </div>

            {buttons && buttons.length > 0 && (
                <WhatsAppTemplateButtons
                    buttons={buttons.map((btn, i) => ({
                        ...btn,
                        text: btn.text || t('preview.buttonFallback', { n: i + 1 }),
                    }))}
                    className="border-t border-border"
                />
            )}
        </div>
    );
}
