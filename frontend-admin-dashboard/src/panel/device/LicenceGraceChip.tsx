/**
 * Phase 2: "Licence ends {date}" on the sign-in card while the room is in grace. Part of
 * the plain card, so it stays out of the refused views' lazy chunk (LicenceCard.tsx).
 */
import { useTranslation } from 'react-i18next';
import { usePanelSession } from '../lib/session';
import { ensurePhase2Strings } from './phase2Strings';
import { useSyncSnapshot } from './syncLoop';

function formatDate(iso: string | null, language: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    try {
        return date.toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return date.toDateString();
    }
}

/** "Licence ends {date}" on the sign-in card while the room is in grace. Never signed in. */
export function LicenceGraceChip() {
    ensurePhase2Strings();
    const { t, i18n } = useTranslation('panel');
    const { isSignedIn } = usePanelSession();
    const { licence } = useSyncSnapshot();
    if (isSignedIn || !licence || !licence.enforced || licence.state !== 'GRACE') return null;
    const date = formatDate(licence.grace_ends_at || licence.ends_at, i18n.language);
    if (!date) return null;
    return (
        <div className="flex justify-center pt-2">
            <span className="rounded-full border border-warning-300 bg-warning-50 px-4 py-1 text-subtitle text-warning-700">
                {t('licence.endsOn', { date })}
            </span>
        </div>
    );
}
