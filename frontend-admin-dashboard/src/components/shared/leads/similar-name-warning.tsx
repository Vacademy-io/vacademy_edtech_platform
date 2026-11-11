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
    /** same phone | same email | same phone and email | same name | similar name */
    reason?: string | null;
}

interface SimilarNames {
    matches: NameMatch[];
    not_shown: number;
    days: number;
}

interface Probe {
    name: string;
    phone: string;
    email: string;
}

async function fetchSimilarNames(instituteId: string, probe: Probe): Promise<SimilarNames> {
    const params: Record<string, string> = { instituteId };
    if (probe.name) params.name = probe.name;
    if (probe.phone) params.phone = probe.phone;
    if (probe.email) params.email = probe.email;
    const { data } = await authenticatedAxiosInstance.get<SimilarNames>(
        `${LEAD_MERGE_BASE}/similar-names`,
        { params }
    );
    return data;
}

const SAME_CONTACT = new Set(['same phone', 'same email', 'same phone and email']);

/** Enough of a phone (10 digits) or an email to look it up. */
function usablePhone(phone: string): string {
    return phone.replace(/\D/g, '').length >= 10 ? phone.trim() : '';
}
function usableEmail(email: string): string {
    const e = email.trim();
    return /^[^@\s]+@[^@\s]+$/.test(e) ? e : '';
}

/**
 * A warning while a lead is added by hand: open leads here with the same phone or email first,
 * then live leads with a very similar name submitted recently, each with why it matched and
 * contact masked. It never blocks the add; each match links to the leads list filtered to that
 * name, so the user can open the existing lead instead.
 */
export function SimilarNameWarning({
    instituteId,
    name,
    phone = '',
    email = '',
}: {
    instituteId?: string;
    name: string;
    phone?: string;
    email?: string;
}) {
    const [applied, setApplied] = useState<Probe>({ name: '', phone: '', email: '' });

    useEffect(() => {
        const t = setTimeout(() => {
            const n = name.trim();
            setApplied({
                name: n.length >= 3 ? n : '',
                phone: usablePhone(phone),
                email: usableEmail(email),
            });
        }, 600);
        return () => clearTimeout(t);
    }, [name, phone, email]);

    const hasProbe = !!(applied.name || applied.phone || applied.email);
    const { data } = useQuery({
        queryKey: ['lead-similar-names', instituteId, applied.name, applied.phone, applied.email],
        queryFn: () => fetchSimilarNames(instituteId ?? '', applied),
        enabled: !!instituteId && hasProbe,
        staleTime: 60 * 1000,
        retry: 0,
    });

    const matches = data?.matches ?? [];
    const hidden = data?.not_shown ?? 0;
    if (!hasProbe || (matches.length === 0 && hidden === 0)) return null;
    const sameContact = matches.some((m) => m.reason && SAME_CONTACT.has(m.reason));

    return (
        <div className="mx-4 mb-4 rounded-lg border border-warning-200 bg-warning-50 p-3 sm:mx-6">
            <div className="flex items-start gap-2">
                <UsersThree weight="bold" className="mt-0.5 size-4 shrink-0 text-warning-700" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-warning-700">
                        {sameContact
                            ? 'This phone number or email already has an open lead'
                            : 'Someone with a very similar name is already a lead'}
                    </p>
                    <p className="text-xs text-warning-700">
                        {sameContact
                            ? 'If it’s the same person, open their lead instead of adding another one. '
                            : `Added in the last ${data?.days ?? 180} days. If it’s the same person, open their lead instead. `}
                        You can still add this one.
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
                                            {m.reason && (
                                                <span className="ms-2 rounded bg-warning-100 px-1.5 py-0.5 text-xs font-medium text-warning-700">
                                                    {m.reason.charAt(0).toUpperCase() + m.reason.slice(1)}
                                                </span>
                                            )}
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
                                        search={{ search: m.name ?? applied.name, range: 'ALL' }}
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
                            {hidden} more matching {hidden === 1 ? 'lead' : 'leads'}
                            {matches.length === 0 ? '' : ' not shown'}.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
