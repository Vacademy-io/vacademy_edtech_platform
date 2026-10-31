import { ChatsCircle, Flag, NotePencil, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export type ChatView = 'messages' | 'reports';

interface ChatPageHeaderProps {
    view: ChatView;
    onViewChange?: (view: ChatView) => void;
    onNewMessage?: () => void;
    /** Unread messages across the listed conversations, shown on the Messages tab. */
    unreadTotal?: number;
}

/**
 * Page header for In-App Messages: icon, title, one-line description, the "New message" action and
 * the Messages / Reports tabs. Tabs and the action are omitted when no handler is given (e.g. while
 * chat is switched off for the institute).
 */
export function ChatPageHeader({
    view,
    onViewChange,
    onNewMessage,
    unreadTotal = 0,
}: ChatPageHeaderProps) {
    const batch = getTerminology(ContentTerms.Batch, SystemTerms.Batch).toLowerCase();
    const tabs: { key: ChatView; label: string; icon: Icon; count?: number }[] = [
        { key: 'messages', label: 'Messages', icon: ChatsCircle, count: unreadTotal },
        { key: 'reports', label: 'Reports review', icon: Flag },
    ];

    return (
        <div className="flex shrink-0 flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <ChatsCircle size={20} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h3">In-App Messages</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-caption">
                                Real-time chat inside the app: direct messages, one group per{' '}
                                {batch}, and a moderated community.
                            </span>
                        </p>
                    </div>
                </div>
                {onNewMessage && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={onNewMessage}
                        className="gap-1.5"
                    >
                        <NotePencil size={16} />
                        New message
                    </MyButton>
                )}
            </div>

            {onViewChange && (
                <div className="flex gap-1 overflow-x-auto border-b border-neutral-200">
                    {tabs.map((tab) => {
                        const active = view === tab.key;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => onViewChange(tab.key)}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 font-medium transition-colors',
                                    active
                                        ? 'border-primary-500 text-primary-600'
                                        : 'border-transparent text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                <tab.icon size={16} weight={active ? 'duotone' : 'regular'} />
                                <span className="text-body">{tab.label}</span>
                                {tab.count ? (
                                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-500 px-1.5 font-semibold text-white">
                                        <span className="text-caption">
                                            {tab.count > 99 ? '99+' : tab.count}
                                        </span>
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
