import { useTranslation } from 'react-i18next';
import { CheckCircle, CircleDashed, Hourglass } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DoubtStatusKind } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/add-doubt-type';
import { effectiveStatusKey, useDoubtStatuses } from '../-services/use-doubt-statuses';

const KIND_CLASSES: Record<DoubtStatusKind, string> = {
    OPEN: 'border-warning-200 bg-warning-50 text-warning-700',
    IN_PROGRESS: 'border-info-200 bg-info-50 text-info-700',
    RESOLVED: 'border-success-200 bg-success-50 text-success-700',
};

const KIND_ICON: Record<DoubtStatusKind, typeof CheckCircle> = {
    OPEN: CircleDashed,
    IN_PROGRESS: Hourglass,
    RESOLVED: CheckCircle,
};

/**
 * The doubt's workflow status as a small pill — tone by kind (open / in progress / resolved), an
 * admin-picked colour when the status has one. Shared by the inbox row, the board card and the
 * conversation header so the same doubt reads the same everywhere.
 */
export const DoubtStatusChip = ({
    doubt,
    className,
}: {
    doubt: { workflow_status?: string | null; status: string };
    className?: string;
}) => {
    const { t } = useTranslation('studyLibraryDoubtStatus');
    const { byKey, labelByKey, kindByKey } = useDoubtStatuses();
    const key = effectiveStatusKey(doubt);
    const cfg = byKey(key);
    const kind = kindByKey(key);
    const Icon = KIND_ICON[kind];
    const color = cfg?.color?.trim();
    return (
        <span
            title={t('statusTitle', { label: labelByKey(key) })}
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold',
                !color && KIND_CLASSES[kind],
                color && 'border-neutral-200 bg-white text-neutral-700',
                className
            )}
        >
            {color ? (
                // Status colour is an arbitrary admin-picked hex — no token equivalent.
                <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: color }} // design-lint-ignore: admin-picked status colour
                />
            ) : (
                <Icon size={12} weight={kind === 'RESOLVED' ? 'fill' : 'bold'} aria-hidden />
            )}
            {labelByKey(key)}
        </span>
    );
};
