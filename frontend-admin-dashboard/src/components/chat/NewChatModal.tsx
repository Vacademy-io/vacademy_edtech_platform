import { useState } from 'react';
import { MagnifyingGlass, SpinnerGap, User as UserIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    searchPeople,
    createDirectConversation,
    type ChatPersonResponse,
    type ChatConversationResponse,
} from '@/services/chat/chatApi';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface NewChatModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConversationReady: (conversation: ChatConversationResponse) => void;
}

const PAGE_SIZE = 20;

export function NewChatModal({ open, onOpenChange, onConversationReady }: NewChatModalProps) {
    // Labels route through the institute's configured plural role terms; the
    // `value` codes (STUDENT/TEACHER/ADMIN) are the API filter values, unchanged.
    const roleFilters: { label: string; value?: string }[] = [
        { label: 'All', value: undefined },
        {
            label: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
            value: 'STUDENT',
        },
        {
            label: getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher),
            value: 'TEACHER',
        },
        { label: getTerminologyPlural(RoleTerms.Admin, SystemTerms.Admin), value: 'ADMIN' },
    ];

    const [query, setQuery] = useState('');
    const [role, setRole] = useState<string | undefined>(undefined);
    const [people, setPeople] = useState<ChatPersonResponse[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [startingId, setStartingId] = useState<string | null>(null);
    const [searched, setSearched] = useState(false);

    const runSearch = async (nextRole = role, nextQuery = query) => {
        setIsSearching(true);
        setSearched(true);
        try {
            const res = await searchPeople({
                roles: nextRole ? [nextRole] : undefined,
                nameQuery: nextQuery.trim() || undefined,
                pageNumber: 0,
                pageSize: PAGE_SIZE,
            });
            setPeople(res.people);
        } catch {
            toast.error('Failed to search people.');
            setPeople([]);
        } finally {
            setIsSearching(false);
        }
    };

    const handleRoleChange = (nextRole?: string) => {
        setRole(nextRole);
        void runSearch(nextRole, query);
    };

    const handleStartDm = async (person: ChatPersonResponse) => {
        setStartingId(person.userId);
        try {
            const conversation = await createDirectConversation({
                targetUserId: person.userId,
                targetUserName: person.fullName,
                targetUserRole: person.role,
            });
            onConversationReady(conversation);
            onOpenChange(false);
            // Reset for next open.
            setQuery('');
            setPeople([]);
            setSearched(false);
            setRole(undefined);
        } catch {
            toast.error('Could not start the conversation.');
        } finally {
            setStartingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-full max-w-lg p-0">
                <DialogHeader className="border-b border-neutral-200 px-5 py-4">
                    <DialogTitle className="text-base font-semibold text-neutral-700">
                        New message
                    </DialogTitle>
                </DialogHeader>

                <div className="px-5 py-4">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void runSearch();
                        }}
                        className="relative mb-3"
                    >
                        <MagnifyingGlass
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <Input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search by name..."
                            className="pl-9"
                        />
                    </form>

                    <div className="mb-3 flex flex-wrap gap-2">
                        {roleFilters.map((r) => (
                            <button
                                key={r.label}
                                type="button"
                                onClick={() => handleRoleChange(r.value)}
                                className={cn(
                                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                    role === r.value
                                        ? 'border-primary-500 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    <div className="max-h-72 min-h-40 overflow-y-auto">
                        {isSearching && (
                            <div className="flex items-center justify-center py-10">
                                <SpinnerGap size={22} className="animate-spin text-primary-500" />
                            </div>
                        )}

                        {!isSearching && !searched && (
                            <p className="py-10 text-center text-sm text-neutral-400">
                                Search for people to start a direct message.
                            </p>
                        )}

                        {!isSearching && searched && people.length === 0 && (
                            <p className="py-10 text-center text-sm text-neutral-400">
                                No people found.
                            </p>
                        )}

                        {!isSearching &&
                            people.map((person) => (
                                <div
                                    key={person.userId}
                                    className="flex items-center gap-3 border-b border-neutral-100 py-2.5"
                                >
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                                        <UserIcon size={18} weight="duotone" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-neutral-700">
                                            {person.fullName || person.email || 'Unknown'}
                                        </div>
                                        <div className="truncate text-xs text-neutral-400">
                                            {person.role}
                                            {person.email ? ` · ${person.email}` : ''}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={startingId === person.userId}
                                        onClick={() => handleStartDm(person)}
                                        className="bg-primary-500 text-white hover:opacity-90"
                                    >
                                        {startingId === person.userId ? (
                                            <SpinnerGap size={14} className="animate-spin" />
                                        ) : (
                                            'Message'
                                        )}
                                    </Button>
                                </div>
                            ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
