import * as React from 'react';
import {
    ArrowBendUpLeft,
    ArrowSquareOut,
    Checks,
    FileText,
    ImageSquare,
    Phone,
    VideoCamera,
} from '@phosphor-icons/react';

import { cn } from '@/lib/utils';
import { mediaFileName, splitTemplateText } from './template-text';

/**
 * The message as WhatsApp will render it — header, body, footer and buttons in a chat bubble.
 *
 * Every send dialog used to preview a template as `bodyText` dumped into a grey box, which showed
 * an admin the raw `Dear {{1}}` and dropped the header, the footer and the buttons entirely. What
 * arrives on the learner's phone is none of those things, so this renders the whole approved
 * template and picks the placeholders out: filled with the recipient's data once it is known,
 * labelled with the variable's name until then.
 */

export interface WhatsAppPreviewButton {
    type?: string;
    text?: string;
    url?: string;
    phoneNumber?: string;
}

/** The fields of a WhatsApp template that show up on the phone. Structurally satisfied by the DTO. */
export interface WhatsAppPreviewTemplate {
    name?: string;
    headerType?: string;
    headerText?: string;
    headerSampleUrl?: string;
    headerSampleValues?: string[];
    bodyText?: string;
    footerText?: string;
    buttons?: WhatsAppPreviewButton[];
    bodyVariableNames?: string[];
}

export interface WhatsAppTemplatePreviewProps {
    template: WhatsAppPreviewTemplate;
    /** Resolved values keyed by variable name. Placeholders without one show their name instead. */
    values?: Record<string, string>;
    /** The media going out with THIS send — falls back to the sample approved with the template. */
    mediaUrl?: string;
    /** Media-header words, so a translated dialog can pass its own. */
    labels?: { image?: string; video?: string; document?: string; emptyBody?: string };
    className?: string;
}

const DEFAULT_LABELS = {
    image: 'Image',
    video: 'Video',
    document: 'Document',
    emptyBody: 'This template has no message body.',
};

/**
 * The approved media, or a labelled tile when there is none to show.
 *
 * A document renders the way WhatsApp draws one — icon and the file's name — and opens the file
 * in a new tab, because "a PDF goes out" is not a preview: the admin needs to see WHICH one.
 *
 * Remounted per URL by its `key` so a broken image from a previous template cannot leave the tile
 * stuck in its error state.
 */
function MediaHeader({ kind, url, label }: { kind: string; url?: string; label: string }) {
    const [broken, setBroken] = React.useState(false);
    const Icon = kind === 'IMAGE' ? ImageSquare : kind === 'VIDEO' ? VideoCamera : FileText;
    const showImage = kind === 'IMAGE' && !!url && !broken;
    const fileName = kind === 'DOCUMENT' ? mediaFileName(url) : '';

    return (
        <div className="p-1.5">
            {showImage ? (
                <img
                    src={url}
                    alt={label}
                    onError={() => setBroken(true)}
                    className="h-36 w-full rounded-md object-cover"
                />
            ) : fileName ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={fileName}
                    className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-neutral-700 transition-colors hover:bg-neutral-200"
                >
                    <Icon className="size-6 shrink-0 text-neutral-500" />
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{fileName}</span>
                        <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                            {label}
                        </span>
                    </span>
                    <ArrowSquareOut className="size-3.5 shrink-0 text-neutral-400" />
                </a>
            ) : (
                <div
                    className={cn(
                        'flex flex-col items-center justify-center gap-1 rounded-md bg-neutral-100 text-neutral-500',
                        kind === 'DOCUMENT' ? 'h-16' : 'h-24'
                    )}
                >
                    <Icon className="size-6" />
                    <span className="text-2xs font-medium uppercase tracking-wide">{label}</span>
                </div>
            )}
        </div>
    );
}

function ButtonIcon({ type }: { type?: string }) {
    if (type === 'URL') return <ArrowSquareOut className="size-3.5" />;
    if (type === 'PHONE_NUMBER') return <Phone className="size-3.5" />;
    return <ArrowBendUpLeft className="size-3.5" />;
}

/** Body/header text with each `{{…}}` picked out as a chip. */
function TemplateText({
    text,
    variableNames,
    values,
    className,
}: {
    text: string;
    variableNames?: string[];
    values?: Record<string, string>;
    className?: string;
}) {
    const parts = React.useMemo(
        () => splitTemplateText(text, { variableNames, values }),
        [text, variableNames, values]
    );

    return (
        <p className={cn('whitespace-pre-wrap break-words', className)}>
            {parts.map((part, index) => {
                if (part.kind === 'text') return <span key={index}>{part.text}</span>;
                const filled = part.value?.trim();
                return (
                    <span
                        key={index}
                        title={`{{${part.token}}}`}
                        className={cn(
                            'rounded-sm px-0.5 font-medium',
                            filled
                                ? 'bg-success-50 text-success-700'
                                : 'bg-primary-100 text-primary-600'
                        )}
                    >
                        {filled || part.name}
                    </span>
                );
            })}
        </p>
    );
}

export function WhatsAppTemplatePreview({
    template,
    values,
    mediaUrl,
    labels,
    className,
}: WhatsAppTemplatePreviewProps) {
    const copy = { ...DEFAULT_LABELS, ...labels };
    const headerKind = template.headerType?.toUpperCase() ?? 'NONE';
    const isMediaHeader =
        headerKind === 'IMAGE' || headerKind === 'VIDEO' || headerKind === 'DOCUMENT';
    const mediaLabel =
        headerKind === 'IMAGE' ? copy.image : headerKind === 'VIDEO' ? copy.video : copy.document;
    const media = mediaUrl?.trim() || template.headerSampleUrl?.trim();
    const buttons = template.buttons ?? [];

    const headerValues = React.useMemo(() => {
        const out: Record<string, string> = {};
        (template.headerSampleValues ?? []).forEach((sample, index) => {
            if (sample) out[String(index + 1)] = sample;
        });
        return out;
    }, [template.headerSampleValues]);

    // Fixed at mount: a clock that ticks with every re-render of a form is a distraction, and the
    // exact minute is set dressing — it is there so the bubble reads as a chat message.
    const sentAt = React.useMemo(
        () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        []
    );

    return (
        <div className={cn('rounded-lg bg-neutral-100 p-3', className)}>
            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-lg rounded-tl-sm border border-neutral-200 bg-white shadow-sm">
                {headerKind === 'TEXT' && template.headerText && (
                    <div className="px-3 pt-2">
                        {/* Header placeholders are numbered in their OWN namespace and the send
                            path never sets them, so they are filled from the samples approved with
                            the template — never from the body's values, which would collide on a
                            positional template where both sides are `{{1}}`. */}
                        <TemplateText
                            text={template.headerText}
                            values={headerValues}
                            className="text-sm font-semibold text-neutral-900"
                        />
                    </div>
                )}
                {isMediaHeader && (
                    <MediaHeader
                        key={media ?? headerKind}
                        kind={headerKind}
                        url={media}
                        label={mediaLabel}
                    />
                )}

                <div className="px-3 pt-2">
                    {template.bodyText?.trim() ? (
                        <TemplateText
                            text={template.bodyText}
                            variableNames={template.bodyVariableNames}
                            values={values}
                            className="text-sm leading-relaxed text-neutral-800"
                        />
                    ) : (
                        <p className="text-sm italic text-neutral-400">{copy.emptyBody}</p>
                    )}
                </div>

                {template.footerText && (
                    <p className="px-3 pt-1.5 text-2xs text-neutral-400">{template.footerText}</p>
                )}

                <div className="flex items-center justify-end gap-1 px-3 pb-2 pt-1.5 text-2xs text-neutral-400">
                    <span>{sentAt}</span>
                    <Checks className="size-3.5 text-info-500" weight="bold" />
                </div>

                {buttons.length > 0 && (
                    <div className="border-t border-neutral-200">
                        {buttons.map((button, index) => (
                            <div
                                key={`${button.text ?? 'button'}-${index}`}
                                className="flex items-center justify-center gap-1.5 border-b border-neutral-100 py-2 text-sm font-medium text-info-600 last:border-b-0"
                            >
                                <ButtonIcon type={button.type} />
                                <span className="truncate">{button.text}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default WhatsAppTemplatePreview;
