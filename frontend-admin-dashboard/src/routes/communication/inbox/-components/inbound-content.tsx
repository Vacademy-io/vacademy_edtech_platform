import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    FileText,
    ImageBroken,
    MapPin,
    Microphone,
    Spinner,
    UserCircle,
} from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import {
    getInboundMedia,
    InboundMediaFetchError,
    type InboundMediaError,
    type InboxMessage,
} from '../-services/inbox-api';

/**
 * Meta's template categories, in the colours the WhatsApp Templates list already uses for them, so
 * a marketing send reads the same in both places.
 */
const CATEGORY_STYLE: Record<string, string> = {
    MARKETING: 'bg-purple-100 text-purple-700',
    UTILITY: 'bg-blue-100 text-blue-700',
    AUTHENTICATION: 'bg-cyan-100 text-cyan-700', // design-lint-ignore: categorical, matches the Templates list
};

export function TemplateCategoryBadge({ category }: { category?: string }) {
    const { t } = useTranslation('communicationChatPanel');
    if (!category) return null;
    const key = category.toUpperCase();
    const label =
        key === 'MARKETING' || key === 'UTILITY' || key === 'AUTHENTICATION'
            ? t(`templateCategory.${key}`)
            : category;
    return (
        <span
            className={`rounded px-1 py-px font-medium not-italic ${CATEGORY_STYLE[key] ?? 'bg-black/5 text-gray-600'}`}
        >
            {label}
        </span>
    );
}

/**
 * The photo, sticker, voice note, video or document a learner sent. The file sits with WhatsApp
 * (or WATI) behind the institute's token, so it is fetched through our API as a Blob and shown from
 * an object URL; nothing loads until the bubble is drawn.
 */
export function InboundMedia({ msg }: { msg: InboxMessage }) {
    const { t } = useTranslation('communicationChatPanel');
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<InboundMediaError | null>(null);
    const [attempt, setAttempt] = useState(0);
    const kind = msg.mediaType || msg.messageKind || 'image';

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        setError(null);
        setUrl(null);
        getInboundMedia(msg.id, getInstituteId() || '')
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof InboundMediaFetchError ? err.reason : 'failed');
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [msg.id, attempt]);

    if (error) {
        return (
            <div className="mb-1 flex items-start gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-caption text-gray-600">
                <ImageBroken size={14} className="mt-px shrink-0" />
                <div className="min-w-0">
                    <p className="font-medium">{t(`inbound.kind.${labelKey(kind)}`)}</p>
                    <p>{t(`inbound.mediaError.${error}`)}</p>
                    {error === 'failed' && (
                        <button
                            onClick={() => setAttempt((n) => n + 1)}
                            className="mt-0.5 inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                        >
                            <ArrowClockwise size={11} /> {t('loadError.tryAgain')}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (!url) {
        return (
            <div className="mb-1 flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-caption text-gray-500">
                <Spinner size={12} className="animate-spin" />
                {t('inbound.loading', { kind: t(`inbound.kind.${labelKey(kind)}`) })}
            </div>
        );
    }

    if (kind === 'sticker') {
        return (
            <img
                src={url}
                alt={t('inbound.kind.sticker')}
                className="mb-1 size-32 object-contain"
            />
        );
    }
    if (kind === 'video') {
        return (
            <video src={url} controls className="mb-1.5 max-h-64 w-full rounded-md bg-black/5" />
        );
    }
    if (kind === 'audio' || kind === 'voice') {
        return (
            <div className="mb-1 flex items-center gap-1.5">
                {kind === 'voice' && <Microphone size={16} className="shrink-0 text-green-700" />}
                <audio src={url} controls className="h-9 w-60 max-w-full" />
            </div>
        );
    }
    if (kind === 'document') {
        return (
            <a
                href={url}
                download={msg.mediaFilename || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-1.5 flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-caption text-blue-600 hover:underline"
            >
                <FileText size={14} />
                <span className="truncate">{msg.mediaFilename || t('viewDocument')}</span>
            </a>
        );
    }
    return (
        <a href={url} target="_blank" rel="noopener noreferrer">
            <img
                src={url}
                alt={t('attachmentAlt')}
                className="mb-1.5 max-h-64 w-full rounded-md bg-black/5 object-contain"
            />
        </a>
    );
}

/** A shared location, opened in Google Maps. */
export function LocationCard({ msg }: { msg: InboxMessage }) {
    const { t } = useTranslation('communicationChatPanel');
    const hasPoint = msg.latitude != null && msg.longitude != null;
    const href = hasPoint
        ? `https://www.google.com/maps/search/?api=1&query=${msg.latitude},${msg.longitude}`
        : undefined;
    const content = (
        <>
            <MapPin size={16} weight="fill" className="mt-px shrink-0 text-red-500" />
            <span className="min-w-0">
                <span className="block font-medium">
                    {msg.locationName || t('inbound.kind.location')}
                </span>
                {msg.locationAddress && (
                    <span className="block text-gray-500">{msg.locationAddress}</span>
                )}
                {hasPoint && <span className="block text-blue-600">{t('inbound.openInMaps')}</span>}
            </span>
        </>
    );
    return href ? (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 flex items-start gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-caption hover:bg-black/10"
        >
            {content}
        </a>
    ) : (
        <div className="mb-1 flex items-start gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-caption">
            {content}
        </div>
    );
}

/** A shared contact card: the names on it. */
export function ContactsCard({ names }: { names?: string[] }) {
    const { t } = useTranslation('communicationChatPanel');
    return (
        <div className="mb-1 rounded-md bg-black/5 px-2 py-1.5 text-caption">
            <p className="mb-0.5 font-medium text-gray-600">{t('inbound.kind.contacts')}</p>
            {(names?.length ? names : [t('inbound.unnamedContact')]).map((name, i) => (
                <p key={`${name}-${i}`} className="flex items-center gap-1 text-gray-800">
                    <UserCircle size={14} className="shrink-0 text-gray-500" /> {name}
                </p>
            ))}
        </div>
    );
}

/** The emoji a learner put on one of our messages, pinned to that bubble like WhatsApp does. */
export function ReactionPill({ emoji, alignRight }: { emoji: string; alignRight: boolean }) {
    return (
        <span
            className={`absolute -bottom-3 ${alignRight ? 'right-2' : 'left-2'} rounded-full border border-gray-200 bg-white px-1.5 text-sm leading-5 shadow-sm`}
        >
            {emoji}
        </span>
    );
}

/** i18n key under `inbound.kind.*` for a message kind; unknown kinds share one label. */
export function labelKey(kind?: string): string {
    switch (kind) {
        case 'image':
        case 'video':
        case 'audio':
        case 'voice':
        case 'sticker':
        case 'document':
        case 'location':
        case 'contacts':
        case 'reaction':
        case 'unsupported':
        case 'form_response':
            return kind;
        default:
            return 'other';
    }
}
