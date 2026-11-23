import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CheckIssue } from '../../-types/learner-home-types';
import { instantToWall, wallToInstant, windowState, zoneLabel } from '../../-utils/schedule';
import { useInstituteZone } from '../../-hooks/usePickerOptions';
import { FieldIssues } from './FieldIssues';
import { exact } from './issues';

interface ScheduleEditorProps {
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    onChange: (next: { starts_at: string | null; ends_at: string | null }) => void;
    issues: CheckIssue[];
    /** Path prefix of the two fields ('' for a block, 'config.slides[0].' for a slide). */
    pathPrefix?: string;
    startLabel?: string;
    endLabel?: string;
    /** Hide the "always shown / scheduled" line (slides). */
    compact?: boolean;
}

/**
 * Start and end in the INSTITUTE's timezone, stored as UTC instants (spec 8.3).
 * The admin's own browser zone is never used.
 */
export function ScheduleEditor({
    id,
    startsAt,
    endsAt,
    onChange,
    issues,
    pathPrefix = '',
    startLabel,
    endLabel,
    compact = false,
}: ScheduleEditorProps) {
    const { t } = useTranslation('learnerHome');
    const zone = useInstituteZone();
    const state = windowState(startsAt, endsAt);
    const field = (key: 'starts_at' | 'ends_at', label: string, value: string | null) => (
        <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${id}-${key}`}>{label}</Label>
            <div className="flex items-center gap-1">
                <Input
                    id={`${id}-${key}`}
                    type="datetime-local"
                    value={instantToWall(value, zone)}
                    onChange={(e) =>
                        onChange({
                            starts_at:
                                key === 'starts_at'
                                    ? wallToInstant(e.target.value, zone)
                                    : startsAt,
                            ends_at:
                                key === 'ends_at' ? wallToInstant(e.target.value, zone) : endsAt,
                        })
                    }
                />
                {value && (
                    <button
                        type="button"
                        className="rounded-sm p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${t('schedule.clear')}: ${label}`}
                        onClick={() =>
                            onChange({
                                starts_at: key === 'starts_at' ? null : startsAt,
                                ends_at: key === 'ends_at' ? null : endsAt,
                            })
                        }
                    >
                        <X className="size-4" aria-hidden />
                    </button>
                )}
            </div>
            <FieldIssues issues={exact(issues, `${pathPrefix}${key}`)} />
        </div>
    );
    return (
        <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row">
                {field('starts_at', startLabel ?? t('schedule.start'), startsAt)}
                {field('ends_at', endLabel ?? t('schedule.end'), endsAt)}
            </div>
            <p className="text-caption text-neutral-500">
                {t('schedule.zone', { zone: `${zone}, ${zoneLabel(zone)}` })}
                {!compact && (
                    <>
                        {' · '}
                        {state === 'always' ? t('schedule.always') : t(`schedule.states.${state}`)}
                    </>
                )}
            </p>
        </div>
    );
}
