import { WarningCircle } from '@phosphor-icons/react';
import { useStoreSites } from '../-hooks/use-store-sites';

/**
 * Custom Fields tab warning for a site's STORE product page. Custom fields
 * are saved per enroll invite, and a store page's rows are its courses' own
 * invite links (the catalogue sync adds each course through its default
 * link; an admin may add others by hand) — so a field added here also lands
 * on those links and on catalogue enrolment. Renders nothing for any other
 * product page.
 */

interface StorePageNoticeProps {
    productPageCode: string | null | undefined;
    instituteId: string;
    /** Distinct invites this page maps (each one receives every field change). */
    inviteCount: number;
}

export const StorePageNotice = ({ productPageCode, instituteId, inviteCount }: StorePageNoticeProps) => {
    // Loads the sites itself when nothing is cached: this tab may be the first
    // thing open (the site settings' "Open the store page" link opens a new
    // browser tab). Shared with the sites list's cache.
    const sites = useStoreSites(instituteId, productPageCode);
    if (!sites?.length) return null;

    const names = sites.map((s) => `“${s.tagName}”`).join(', ');
    return (
        <div role="note" className="mb-4 flex gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" weight="fill" />
            <div className="space-y-1 text-caption text-neutral-700">
                <p className="font-semibold text-warning-700">
                    This is the store page of {sites.length === 1 ? 'the site' : 'the sites'} {names}
                </p>
                <p>
                    Custom fields are saved on every enroll invite this page sells
                    {inviteCount > 0
                        ? ` (${inviteCount} invite${inviteCount === 1 ? '' : 's'})`
                        : ''}
                    . On a store page those are your courses’ own invite links, so adding, editing
                    or reordering a field here also changes the enrolment form of those courses
                    everywhere — their invite links and catalogue enrolment included. Keep the store
                    form short (name, email, phone).
                </p>
            </div>
        </div>
    );
};
