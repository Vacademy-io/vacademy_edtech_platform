import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { UsersThree } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LEAD_MERGE_BASE } from '@/constants/urls';

interface NameMatch {
    response_id: string;
    user_id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    list_name: string | null;
    status_key: string | null;
    submitted_at: string | null;
    exact_name: boolean;
}

interface SimilarNames {
    matches: NameMatch[];
    not_shown: number;
    days: number;
}

async function fetchSimilarNames(instituteId: string, name: string): Promise<SimilarNames> {
    const { data } = await authenticatedAxiosInstance.get<SimilarNames>(
        `${LEAD_MERGE_BASE}/similar-names`,
        { params: { instituteId, name } }
    );
    return data;
}

/**
 * A warning while a lead is added by hand: live leads here with a very similar name, submitted
 * recently, with contact masked. It never blocks the add; each match links to the leads list
 * filtered to that name, so the user can open the existing lead instead.
 */
export function SimilarNameWarning({ instituteId, name }: { instituteId?: string; name: string }) {
    const [applied, setApplied] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setApplied(name.trim()), 600);
        return () => clearTimeout(t);
    }, [name]);

    const { data } = useQuery({
        queryKey: ['lead-similar-names', instituteId, applied],
        queryFn: () => fetchSimilarNames(instituteId ?? '', applied),
        enabled: !!instituteId && applied.length >= 3,
        staleTime: 60 * 1000,
        retry: 0,
    });

    const matches = data?.matches ?? [];
    const hidden = data?.not_shown ?? 0;
    if (!applied || (matches.length === 0 && hidden === 0)) return null;

    return (
        <div className="mx-4 mb-4 rounded-lg border border-warning-200 bg-warning-50 p-3 sm:mx-6">
            <div className="flex items-start gap-2">
                <UsersThree weight="bold" className="mt-0.5 size-4 shrink-0 text-warning-700" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-warning-700">
                        Someone with a very similar name is already a lead
                    </p>
                    <p className="text-xs text-warning-700">
                        Added in the last {data?.days ?? 180} days. If it’s the same person, open
                        their lead instead. You can still add this one.
                    </p>
                    {matches.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1.5">
                            {matches.map((m) => (
                                <li
                                    key={m.response_id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5"
                                >
                                    <div className="min-w-0 text-xs">
                                        <p className="truncate font-medium text-neutral-800">
                                            {m.name || 'Unnamed lead'}
                                        </p>
                                        <p className="truncate text-neutral-500">
                                            {[
                                                m.phone,
                                                m.email,
                                                m.list_name,
                                                m.submitted_at
                                                    ? format(new Date(m.submitted_at), 'd MMM yyyy')
                                                    : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </div>
                                    <Link
                                        to="/audience-manager/recent-leads"
                                        search={{ search: m.name ?? applied, range: 'ALL' }}
                                        className="text-xs font-medium text-primary-500 hover:underline"
                                    >
                                        Open
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                    {hidden > 0 && (
                        <p className="mt-1.5 text-xs text-warning-700">
                            {hidden} more {hidden === 1 ? 'lead' : 'leads'} with a similar name
                            {matches.length === 0 ? '' : ' not shown'}.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
