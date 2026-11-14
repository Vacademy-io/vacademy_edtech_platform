import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Plus, Spinner } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { getInstituteId } from '@/constants/helper';
import { useAutosuggestUsers } from '@/routes/manage-students/students-list/-hooks/useAutosuggestUsers';

export interface LearnerOption {
    id: string;
    label: string;
}

/**
 * Search-as-you-type learner picker on the auth-service autosuggest endpoint
 * (the same one the bulk-assign dialog uses; STUDENT role only). Picking adds
 * the learner to `selected`; the chips are rendered by the caller.
 */
export function LearnerSearchPicker({
    selected,
    onAdd,
}: {
    selected: LearnerOption[];
    onAdd: (learner: LearnerOption) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [query]);

    const { data, isFetching } = useAutosuggestUsers({
        instituteId: getInstituteId() ?? '',
        query: debounced,
    });

    const chosen = new Set(selected.map((s) => s.id));
    const rows = (data ?? []).filter((u) => !chosen.has(u.id));

    return (
        <div className="flex flex-col gap-2">
            <div className="relative">
                <MagnifyingGlass
                    size={16}
                    className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('form.who.studentSearch')}
                    className="ps-9"
                />
                {isFetching && (
                    <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-neutral-400" />
                )}
            </div>
            {debounced.length >= 2 && (
                <div className="max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                    {!isFetching && rows.length === 0 && (
                        <p className="p-3 text-caption text-neutral-500">
                            {t('form.who.noStudents')}
                        </p>
                    )}
                    {rows.map((user) => {
                        const name = user.full_name || user.username || user.email;
                        return (
                            <button
                                key={user.id}
                                type="button"
                                onClick={() => onAdd({ id: user.id, label: name })}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-neutral-50"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-body text-neutral-700">
                                        {name}
                                    </span>
                                    {user.email && (
                                        <span className="block truncate text-caption text-neutral-500">
                                            {user.email}
                                        </span>
                                    )}
                                </span>
                                <Plus className="size-4 shrink-0 text-primary-500" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
