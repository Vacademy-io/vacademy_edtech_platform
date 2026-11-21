/**
 * Template gallery for a Job Openings section (`props.template`).
 *
 * Same idiom as the lead-form template gallery (components/audience/
 * FormTemplatePicker.tsx): a radiogroup of tiles, each a miniature drawn in
 * plain blocks and tinted with the institute's own `primary-*` scale, so what
 * the admin clicks is what the visitor gets. That component is typed to the
 * form appearance object, so the tiles are mirrored here rather than shared.
 * The learner renderer is JobOpeningsComponent.tsx; keep the miniatures in
 * step with it. A template changes only the look — the jobs stay as typed.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { JOB_TEMPLATES, readJobTemplate, type JobOpeningsTemplate } from './job-templates';

// ─── Miniature building blocks ───────────────────────────────────────────────

const Line = ({ className, light }: { className?: string; light?: boolean }) => (
    <div className={cn('h-1 rounded-full', light ? 'bg-white/70' : 'bg-neutral-300', className)} />
);

const Title = ({ className, light }: { className?: string; light?: boolean }) => (
    <div className={cn('h-1.5 rounded-full', light ? 'bg-white' : 'bg-neutral-700', className)} />
);

const Btn = ({ className }: { className?: string }) => (
    <div className={cn('h-1.5 w-6 rounded-sm bg-primary-500', className)} />
);

const Chips = ({ light }: { light?: boolean }) => (
    <div className="flex gap-0.5">
        <div className={cn('h-1 w-3 rounded-full', light ? 'bg-white/30' : 'bg-primary-100')} />
        <div className={cn('h-1 w-2.5 rounded-full', light ? 'bg-white/30' : 'bg-primary-100')} />
    </div>
);

/** A white card with a small thumbnail, title, chips, a line and a button. */
const ClassicCard = () => (
    <div className="flex flex-col gap-1 rounded-sm border border-neutral-200 bg-white p-1.5">
        <div className="flex items-center gap-1">
            <div className="size-2.5 shrink-0 rounded-sm bg-primary-300" />
            <Title className="w-3/4" />
        </div>
        <Chips />
        <Line className="w-full" />
        <Btn />
    </div>
);

const Heading = ({ light, left }: { light?: boolean; left?: boolean }) => (
    <div className={cn('flex flex-col gap-0.5', left ? 'items-start' : 'items-center')}>
        <Title light={light} className="w-1/2" />
        <Line light={light} className="w-1/3" />
    </div>
);

// ─── The eight miniatures ────────────────────────────────────────────────────

const THUMBNAILS: Record<JobOpeningsTemplate, ReactNode> = {
    classic: (
        <div className="flex h-full flex-col gap-1.5 bg-neutral-50 p-2">
            <Heading />
            <div className="grid grid-cols-2 gap-1.5">
                <ClassicCard />
                <ClassicCard />
            </div>
        </div>
    ),
    poster: (
        <div className="flex h-full flex-col gap-1.5 bg-neutral-50 p-2">
            <Heading />
            <div className="grid grid-cols-2 items-start gap-1.5">
                {[0, 1].map((i) => (
                    <div
                        key={i}
                        className="overflow-hidden rounded-sm border border-neutral-200 bg-white"
                    >
                        <div
                            className={cn(
                                'bg-gradient-to-b from-primary-300 to-primary-500',
                                i ? 'h-8' : 'h-10'
                            )}
                        />
                        <div className="flex flex-col gap-0.5 p-1">
                            <Title className="w-3/4" />
                            <Btn className="w-full" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    ),
    list: (
        <div className="flex h-full flex-col gap-1 bg-neutral-50 p-2">
            <Heading />
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="flex items-center gap-1 rounded-sm border border-neutral-200 bg-white p-1"
                >
                    <div className="size-3 shrink-0 rounded-sm bg-primary-300" />
                    <div className="flex flex-1 flex-col gap-0.5">
                        <Title className="w-1/2" />
                        <Line className="w-2/3" />
                    </div>
                    <Btn className="w-5" />
                </div>
            ))}
        </div>
    ),
    editorial: (
        <div className="flex h-full flex-col bg-white px-2 py-1.5">
            <div className="mb-1 h-2 w-1/2 rounded-sm bg-neutral-800" />
            {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-1.5 border-t border-neutral-300 py-1">
                    {/* the row number ("01") */}
                    <div className="h-1.5 w-2 shrink-0 rounded-sm bg-neutral-400" />

                    <div className="flex flex-1 flex-col gap-0.5">
                        <div className="h-1.5 w-2/3 rounded-sm bg-neutral-700" />
                        <Line className="w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    ),
    dark: (
        <div className="relative flex h-full flex-col gap-1.5 overflow-hidden bg-neutral-900 p-2">
            <div className="absolute inset-x-0 -top-6 mx-auto size-16 rounded-full bg-primary-500 opacity-40 blur-xl" />
            <div className="relative">
                <Heading light />
            </div>
            <div className="relative grid grid-cols-2 gap-1.5">
                {[0, 1].map((i) => (
                    <div
                        key={i}
                        className="flex flex-col gap-1 rounded-sm bg-white/10 p-1.5 ring-1 ring-white/10"
                    >
                        <Title light className="w-3/4" />
                        <Chips light />
                        <Btn />
                    </div>
                ))}
            </div>
        </div>
    ),
    minimal: (
        <div className="flex h-full flex-col bg-white px-2 py-1.5">
            <Heading left />
            <div className="mt-1.5 flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-1 py-1">
                        <Title className="w-1/3" />
                        <Line className="ml-auto w-1/5" />
                        <div className="h-1 w-3 rounded-full bg-primary-500" />
                    </div>
                ))}
            </div>
        </div>
    ),
    spotlight: (
        <div className="flex h-full flex-col gap-1.5 bg-neutral-50 p-2">
            <div className="flex overflow-hidden rounded-sm border border-neutral-200 bg-white">
                <div className="w-2/5 bg-gradient-to-br from-primary-300 to-primary-500" />
                <div className="flex flex-1 flex-col gap-1 p-1.5">
                    <Title className="w-3/4" />
                    <Line className="w-full" />
                    <Btn />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                <ClassicCard />
                <ClassicCard />
            </div>
        </div>
    ),
    split: (
        <div className="flex h-full flex-col gap-1 bg-white p-2">
            <Title className="w-1/2" />
            <div className="flex flex-1 gap-1.5">
                <div className="flex flex-1 flex-col gap-1">
                    <div className="h-6 rounded-sm bg-primary-100" />
                    <Line className="w-full" />
                    <Line className="w-5/6" />
                    <Line className="w-full" />
                    <Line className="w-2/3" />
                </div>
                <div className="flex w-1/3 flex-col gap-1 rounded-sm border border-neutral-200 p-1">
                    <Line className="w-full" />
                    <Line className="w-2/3" />
                    <Btn className="mt-auto w-full" />
                </div>
            </div>
        </div>
    ),
};

// ─── Picker ──────────────────────────────────────────────────────────────────

interface JobTemplatePickerProps {
    value: unknown;
    onChange: (template: JobOpeningsTemplate) => void;
}

export const JobTemplatePicker = ({ value, onChange }: JobTemplatePickerProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const current = readJobTemplate(value);
    return (
        <div
            role="radiogroup"
            aria-label={t('jobOpenings.template')}
            className="grid grid-cols-2 gap-2"
            data-job-template-picker
        >
            {JOB_TEMPLATES.map((template) => {
                const selected = current === template;
                return (
                    <button
                        key={template}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(template)}
                        className={cn(
                            'group flex flex-col overflow-hidden rounded-md border bg-white text-start transition-all',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            selected
                                ? 'border-primary-500 ring-2 ring-primary-500'
                                : 'border-neutral-200 hover:border-primary-300 hover:shadow-sm'
                        )}
                    >
                        <div
                            aria-hidden="true"
                            className="pointer-events-none h-20 w-full overflow-hidden border-b border-neutral-200 [&>div]:w-full"
                        >
                            {THUMBNAILS[template]}
                        </div>
                        <div className="flex items-start justify-between gap-1 p-1.5">
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-neutral-800">
                                    {t(`jobOpenings.templates.${template}.name`)}
                                </p>
                                <p className="text-caption leading-tight text-neutral-500">
                                    {t(`jobOpenings.templates.${template}.hint`)}
                                </p>
                            </div>
                            {selected && (
                                <CheckCircle
                                    weight="fill"
                                    className="size-4 shrink-0 text-primary-500"
                                />
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};

export default JobTemplatePicker;
