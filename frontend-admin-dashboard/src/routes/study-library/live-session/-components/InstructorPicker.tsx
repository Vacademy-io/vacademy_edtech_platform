import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MyInput } from '@/components/design-system/input';
import {
    fetchEligibleOrgUsers,
    type InstituteUser,
} from '@/routes/manage-institute/teams/-services/institute-users-service';

interface InstructorPickerProps {
    instituteId: string;
    /** Selected instructor user ids. */
    value: string[];
    onChange: (userIds: string[]) => void;
    disabled?: boolean;
}

/**
 * Multi-select for a live session's instructors / presenters.
 *
 * Staff only (`fetchEligibleOrgUsers` excludes STUDENT), because an instructor
 * is a person who teaches the class, not someone enrolled in it.
 *
 * An empty selection is allowed and meaningful: the backend falls back to
 * whoever scheduled the session, so a class can never end up with nobody
 * responsible for it.
 */
export function InstructorPicker({
    instituteId,
    value,
    onChange,
    disabled = false,
}: InstructorPickerProps) {
    const [users, setUsers] = useState<InstituteUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [query, setQuery] = useState('');

    useEffect(() => {
        let cancelled = false;
        if (!instituteId) return;
        (async () => {
            try {
                setLoading(true);
                const fetched = await fetchEligibleOrgUsers(instituteId);
                if (cancelled) return;
                setUsers(fetched);
                setLoadFailed(false);
            } catch {
                if (!cancelled) setLoadFailed(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [instituteId]);

    const usersById = useMemo(() => {
        const map = new Map<string, InstituteUser>();
        users.forEach((u) => map.set(u.id, u));
        return map;
    }, [users]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return users;
        return users.filter(
            (u) =>
                u.full_name?.toLowerCase().includes(needle) ||
                u.email?.toLowerCase().includes(needle)
        );
    }, [users, query]);

    const toggle = (userId: string, checked: boolean) => {
        if (checked) {
            if (!value.includes(userId)) onChange([...value, userId]);
        } else {
            onChange(value.filter((id) => id !== userId));
        }
    };

    // A selected id whose user the directory didn't return (removed from the
    // institute, or the fetch failed) still renders as a chip so that simply
    // opening the form doesn't quietly drop them from the session.
    const labelFor = (userId: string) => {
        const user = usersById.get(userId);
        return user?.full_name || user?.email || userId;
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                {value.length === 0 ? (
                    <span className="text-sm text-neutral-500">
                        {
                            'No instructors selected — the person who scheduled this class will be used.'
                        }
                    </span>
                ) : (
                    value.map((userId) => (
                        <Badge
                            key={userId}
                            variant="secondary"
                            className="flex items-center gap-1 py-1 ps-2 pe-1"
                        >
                            {labelFor(userId)}
                            {!disabled && (
                                <button
                                    type="button"
                                    aria-label={'Remove instructor'}
                                    className="rounded-full p-0.5 hover:bg-neutral-200"
                                    onClick={() => toggle(userId, false)}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </Badge>
                    ))
                )}
            </div>

            <Popover>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" disabled={disabled} className="w-fit">
                        {'Add instructor'}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="start">
                    <MyInput
                        inputType="text"
                        input={query}
                        onChangeFunction={(e) => setQuery(e.target.value)}
                        inputPlaceholder={'Search by name or email'}
                        className="mb-2 w-full"
                    />
                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <p className="py-2 text-sm text-neutral-500">{'Loading people…'}</p>
                        ) : loadFailed ? (
                            <p className="py-2 text-sm text-danger-600">
                                {"Couldn't load the institute's people."}
                            </p>
                        ) : filtered.length === 0 ? (
                            <p className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                                <MagnifyingGlass size={14} />
                                {'No one matches that search.'}
                            </p>
                        ) : (
                            filtered.map((user) => (
                                <label
                                    key={user.id}
                                    className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-neutral-700"
                                >
                                    <Checkbox
                                        checked={value.includes(user.id)}
                                        onCheckedChange={(c) => toggle(user.id, c === true)}
                                    />
                                    <span className="flex flex-col">
                                        <span>{user.full_name || user.email || user.id}</span>
                                        {user.full_name && user.email && (
                                            <span className="text-xs text-neutral-500">
                                                {user.email}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            ))
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
