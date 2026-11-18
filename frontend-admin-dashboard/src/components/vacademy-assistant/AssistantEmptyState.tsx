import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkle, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { RecentChatsCompact } from './AssistantHistoryList';
import type { AssistantChatSummary } from './types';

/** Capability cards shown before "Show all". */
const VISIBLE_CAPABILITIES = 6;
/** Starter prompt chips shown. */
const VISIBLE_STARTERS = 4;

const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1';

export interface CapabilityItem {
    key: string;
    blurb: string;
    Icon: Icon;
}

/**
 * The panel before the first question: a short greeting, what this user can ask about (only the
 * groups their role has), a few starter prompts and their latest chats.
 */
export function AssistantEmptyState({
    firstName,
    capabilities,
    starters,
    recentChats,
    busy,
    onAsk,
    onOpenChat,
    onViewAllChats,
}: {
    firstName: string;
    capabilities: CapabilityItem[];
    starters: string[];
    recentChats: AssistantChatSummary[];
    busy: boolean;
    onAsk: (text: string) => void;
    onOpenChat: (id: string) => void;
    onViewAllChats: () => void;
}) {
    const { t } = useTranslation('dashboardIndex');
    const capsId = useId();
    const startersId = useId();
    const [showAll, setShowAll] = useState(false);
    const shown = showAll ? capabilities : capabilities.slice(0, VISIBLE_CAPABILITIES);

    return (
        <div className="flex flex-col gap-5 py-2">
            <div className="flex items-start gap-3">
                <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500"
                    aria-hidden="true"
                >
                    <Sparkle size={20} weight="fill" />
                </span>
                <div className="min-w-0">
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {firstName
                            ? t('assistant.panel.greeting', { name: firstName })
                            : t('assistant.panel.greetingNoName')}
                    </h2>
                    <p className="mt-0.5 text-caption text-neutral-500">
                        {capabilities.length
                            ? t('assistant.panel.greetingHint')
                            : t('assistant.helpDescription')}
                    </p>
                </div>
            </div>

            {capabilities.length > 0 && (
                <section aria-labelledby={capsId} className="flex flex-col gap-2">
                    <h3
                        id={capsId}
                        className="text-2xs font-semibold uppercase tracking-wide text-neutral-500"
                    >
                        {t('assistant.panel.canHelpWith')}
                    </h3>
                    <ul className="grid grid-cols-2 gap-2">
                        {shown.map(({ key, blurb, Icon }) => (
                            <li
                                key={key}
                                className="flex min-w-0 items-start gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-2"
                                title={blurb}
                            >
                                <Icon
                                    size={16}
                                    className="mt-0.5 shrink-0 text-primary-500"
                                    aria-hidden="true"
                                />
                                <span className="line-clamp-2 min-w-0 text-caption text-neutral-700">
                                    {blurb}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {capabilities.length > VISIBLE_CAPABILITIES && (
                        <button
                            type="button"
                            onClick={() => setShowAll((v) => !v)}
                            aria-expanded={showAll}
                            className={cn(
                                'w-fit rounded-sm text-caption font-medium text-primary-600 hover:underline',
                                FOCUS_RING
                            )}
                        >
                            {showAll
                                ? t('assistant.panel.showFewerCapabilities')
                                : t('assistant.panel.showAllCapabilities', {
                                      count: capabilities.length,
                                  })}
                        </button>
                    )}
                </section>
            )}

            {starters.length > 0 && (
                <section aria-labelledby={startersId} className="flex flex-col gap-2">
                    <h3
                        id={startersId}
                        className="text-2xs font-semibold uppercase tracking-wide text-neutral-500"
                    >
                        {t('assistant.panel.tryAsking')}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {starters.slice(0, VISIBLE_STARTERS).map((s) => (
                            <button
                                key={s}
                                type="button"
                                disabled={busy}
                                onClick={() => onAsk(s)}
                                className={cn(
                                    'min-h-8 max-w-full rounded-full border border-neutral-200 bg-white px-3 py-1 text-start text-caption text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
                                    FOCUS_RING
                                )}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            <RecentChatsCompact
                chats={recentChats}
                onOpen={onOpenChat}
                onViewAll={onViewAllChats}
            />
        </div>
    );
}
