import {
    ArrowsClockwise,
    CalendarCheck,
    CaretRight,
    ChatCircleText,
    Lightbulb,
    PenNib,
    Timer,
    type Icon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type AssessmentTypeKey = 'EXAM' | 'MOCK' | 'PRACTICE' | 'SURVEY' | 'MANUAL_UPLOAD_EXAM';

interface OnlineType {
    key: Exclude<AssessmentTypeKey, 'MANUAL_UPLOAD_EXAM'>;
    i18nKey: 'examination' | 'mock' | 'practice' | 'survey';
    icon: Icon;
    /** Keys under typePicker.values — kept in step with the wizard's rules
     * (getTestBoundation for "opens", Step2 validation for timer/marks). */
    opens: 'setDateTime' | 'anytime' | 'anytimeOrDates';
    timer: 'fixed' | 'optional';
    marks: 'scored' | 'notScored';
}

const ONLINE_TYPES: OnlineType[] = [
    {
        key: 'EXAM',
        i18nKey: 'examination',
        icon: CalendarCheck,
        opens: 'setDateTime',
        timer: 'fixed',
        marks: 'scored',
    },
    {
        key: 'MOCK',
        i18nKey: 'mock',
        icon: Timer,
        opens: 'anytime',
        timer: 'fixed',
        marks: 'scored',
    },
    {
        key: 'PRACTICE',
        i18nKey: 'practice',
        icon: ArrowsClockwise,
        opens: 'anytime',
        timer: 'optional',
        marks: 'scored',
    },
    {
        key: 'SURVEY',
        i18nKey: 'survey',
        icon: ChatCircleText,
        opens: 'anytimeOrDates',
        timer: 'optional',
        marks: 'notScored',
    },
];

/** Width of the comparison columns; the header row reuses it so they line up. */
const FACTS_COLUMNS = 'w-80 shrink-0 grid-cols-3 gap-3';

const rowClass =
    'group flex w-full items-center gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-start transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

const TypeIcon = ({ icon: IconComponent }: { icon: Icon }) => (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-white">
        <IconComponent size={22} weight="duotone" />
    </span>
);

const GroupHeading = ({ label, showColumns }: { label: string; showColumns?: boolean }) => {
    const { t } = useTranslation('assessmentScheduleTestHeaderDescription');
    return (
        <div className="flex items-end gap-4 border-x border-transparent px-4 pb-2">
            <span className="flex-1 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                {label}
            </span>
            {showColumns && (
                <>
                    <span
                        className={cn(
                            'hidden text-caption font-medium text-neutral-500 md:grid',
                            FACTS_COLUMNS
                        )}
                    >
                        <span>{t('typePicker.columns.opens')}</span>
                        <span>{t('typePicker.columns.timer')}</span>
                        <span>{t('typePicker.columns.marks')}</span>
                    </span>
                    {/* Matches the caret column in each row. */}
                    <span className="hidden size-5 shrink-0 md:block" />
                </>
            )}
        </div>
    );
};

/**
 * The assessment-type chooser used by the "Create Assessment" dialog and the
 * /assessment home page: a compact, comparable list so an admin can decide
 * without scrolling through illustration cards. Picking a row is the whole action.
 */
export const AssessmentTypePicker = ({ onPick }: { onPick: (type: AssessmentTypeKey) => void }) => {
    const { t } = useTranslation('assessmentScheduleTestHeaderDescription');

    return (
        <div className="flex flex-col gap-5">
            <section>
                <GroupHeading label={t('typePicker.onlineGroup')} showColumns />
                <div className="flex flex-col gap-2">
                    {ONLINE_TYPES.map((type) => {
                        const facts = [
                            {
                                label: t('typePicker.columns.opens'),
                                value: t(`typePicker.values.${type.opens}`),
                                muted: false,
                            },
                            {
                                label: t('typePicker.columns.timer'),
                                value: t(`typePicker.values.${type.timer}`),
                                muted: type.timer === 'optional',
                            },
                            {
                                label: t('typePicker.columns.marks'),
                                value: t(`typePicker.values.${type.marks}`),
                                muted: type.marks === 'notScored',
                            },
                        ];
                        return (
                            <button
                                key={type.key}
                                type="button"
                                onClick={() => onPick(type.key)}
                                className={rowClass}
                                data-testid={`assessment-type-${type.key}`}
                            >
                                <TypeIcon icon={type.icon} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-subtitle font-semibold text-neutral-800">
                                        {t(`examTypes.${type.i18nKey}.title`)}
                                    </span>
                                    <span className="block text-caption text-neutral-500">
                                        {t(`typePicker.bestFor.${type.i18nKey}`)}
                                    </span>
                                    {/* Phones: the comparison columns collapse into one line. */}
                                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-neutral-600 md:hidden">
                                        {facts.map((fact) => (
                                            <span key={fact.label}>
                                                <span className="text-neutral-400">
                                                    {fact.label}:
                                                </span>{' '}
                                                {fact.value}
                                            </span>
                                        ))}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        'hidden text-body text-neutral-700 md:grid',
                                        FACTS_COLUMNS
                                    )}
                                >
                                    {facts.map((fact) => (
                                        <span
                                            key={fact.label}
                                            className={cn(fact.muted && 'text-neutral-500')}
                                        >
                                            {fact.value}
                                        </span>
                                    ))}
                                </span>
                                <CaretRight
                                    size={20}
                                    className="shrink-0 text-neutral-300 transition-colors group-hover:text-primary-500 rtl:rotate-180"
                                />
                            </button>
                        );
                    })}
                </div>
            </section>

            <section>
                <GroupHeading label={t('typePicker.paperGroup')} />
                <button
                    type="button"
                    onClick={() => onPick('MANUAL_UPLOAD_EXAM')}
                    className={rowClass}
                    data-testid="assessment-type-MANUAL_UPLOAD_EXAM"
                >
                    <TypeIcon icon={PenNib} />
                    <span className="min-w-0 flex-1">
                        <span className="block text-subtitle font-semibold text-neutral-800">
                            {t('examTypes.manualUploadExam.title')}
                        </span>
                        <span className="block text-caption text-neutral-500">
                            {t('typePicker.bestFor.manualUploadExam')}
                        </span>
                        <span className="mt-2 block text-caption text-neutral-600 md:hidden">
                            {t('typePicker.paperFlow')}
                        </span>
                    </span>
                    <span className="hidden w-80 shrink-0 text-body text-neutral-700 md:block">
                        {t('typePicker.paperFlow')}
                    </span>
                    <CaretRight
                        size={20}
                        className="shrink-0 text-neutral-300 transition-colors group-hover:text-primary-500 rtl:rotate-180"
                    />
                </button>
            </section>

            <p className="flex items-start gap-2 rounded-lg bg-neutral-50 p-3 text-caption text-neutral-600">
                <Lightbulb
                    size={16}
                    weight="duotone"
                    className="mt-0.5 shrink-0 text-primary-500"
                />
                {t('typePicker.notSure')}
            </p>
        </div>
    );
};
