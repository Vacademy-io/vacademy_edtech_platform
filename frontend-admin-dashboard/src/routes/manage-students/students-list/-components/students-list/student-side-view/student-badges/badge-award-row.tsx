import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { X } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { awardSource, type LearnerBadgeAward } from '@/services/student-badges';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';

/** Same shape the neighbouring side-view tabs use (application-details.tsx). */
export const formatAwardDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return format(date, 'd MMM yyyy');
    } catch {
        return null;
    }
};

export const BadgePill = ({ children, className }: { children: string; className?: string }) => (
    <span
        className={cn(
            'inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-700 ring-1 ring-primary-200',
            className
        )}
    >
        {children}
    </span>
);

export interface BadgeAwardRowProps {
    award: LearnerBadgeAward;
    /** True when the catalogue entry for this badge is hidden-until-earned. */
    hidden?: boolean;
    disabled?: boolean;
    /** Called only after the admin confirms in the AlertDialog. */
    onRevoke: (badgeId: string) => Promise<void> | void;
}

/**
 * One awarded-badge row for the narrow side view: visual, name, optional quoted note,
 * a meta line that says how the row came to exist (staff award vs auto-unlock), and a revoke
 * icon that confirms with source-specific copy before firing.
 */
export function BadgeAwardRow({ award, hidden, disabled, onRevoke }: BadgeAwardRowProps) {
    const { t } = useTranslation('manageStudentsBadges');
    const [confirmOpen, setConfirmOpen] = useState(false);

    const source = awardSource(award);
    const name = award.badgeName || t('awarded.badgeFallback');
    const date = formatAwardDate(award.awardedAt);
    const meta =
        source === 'AUTO'
            ? date
                ? t('awarded.metaAuto', { date })
                : t('awarded.metaAutoNoDate')
            : date
              ? t('awarded.metaManual', { date })
              : t('awarded.metaManualNoDate');

    return (
        <div className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50">
                <BadgeVisual
                    icon={award.badgeIcon || 'Trophy'}
                    fill
                    className="size-5 text-primary-500"
                />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 truncate text-body font-semibold text-card-foreground">
                        {name}
                    </p>
                    {hidden && <BadgePill>{t('awarded.hidden')}</BadgePill>}
                </div>
                {award.reason && (
                    <p className="text-caption text-muted-foreground">
                        &ldquo;{award.reason}&rdquo;
                    </p>
                )}
                <p className="text-2xs text-muted-foreground">{meta}</p>
            </div>
            <button
                type="button"
                className={cn(
                    'shrink-0 rounded-full p-1 text-danger-500 transition-colors hover:bg-danger-50',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400 disabled:opacity-50'
                )}
                onClick={() => setConfirmOpen(true)}
                disabled={disabled}
                aria-label={t('awarded.revokeAriaLabel', { name })}
            >
                <X className="size-4" />
            </button>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent className="max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('revoke.title', { name })}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {source === 'AUTO' ? t('revoke.autoBody') : t('revoke.manualBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('revoke.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-500 hover:bg-danger-600"
                            onClick={() => {
                                setConfirmOpen(false);
                                void onRevoke(award.badgeId);
                            }}
                        >
                            {t('revoke.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
