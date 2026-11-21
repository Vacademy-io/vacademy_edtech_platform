import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Briefcase, MapPin, Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { readJobTemplate, type JobItem } from './job-templates';

/**
 * Canvas preview of a Job Openings section: the cards as the chosen template
 * lays them out, from the section's own props (no fetching). The job's own
 * page is the learner's; the iframe preview shows it when a card is opened.
 */

const GRID: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
};

const Chips: React.FC<{ job: JobItem; inverse?: boolean }> = ({ job, inverse }) => {
    const chips = [
        job.location && { icon: MapPin, text: job.location },
        job.jobType && { icon: Briefcase, text: job.jobType },
        job.compensation && { icon: Wallet, text: job.compensation },
    ].filter(Boolean) as Array<{ icon: typeof MapPin; text: string }>;
    if (!chips.length) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {chips.map((c, i) => (
                <span
                    key={i}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium',
                        inverse ? 'bg-white/10 text-white/85' : 'bg-primary-50 text-primary-500'
                    )}
                >
                    <c.icon className="size-3" /> {c.text}
                </span>
            ))}
        </div>
    );
};

export const JobOpeningsPreview: React.FC<{ props: any }> = ({ props }) => {
    const { t } = useTranslation('managePagesComponentPreviews');
    const template = readJobTemplate(props.template);
    const jobs: JobItem[] = (Array.isArray(props.jobs) ? props.jobs : []).filter(
        (j: JobItem) => j && j.enabled !== false && String(j.title || '').trim()
    );
    const view = props.viewButtonLabel || t('jobOpenings.view');
    const dark = template === 'dark';
    const rows = template === 'list' || template === 'editorial' || template === 'minimal';
    const cols = GRID[Math.min(4, Math.max(1, Number(props.columns) || 2))];

    const card = (job: JobItem, i: number, featured = false) => (
        <div
            key={i}
            className={cn(
                'flex overflow-hidden rounded-xl',
                dark
                    ? 'bg-white/5 ring-1 ring-white/10'
                    : 'border border-catalogue-border bg-catalogue-bg-elevated',
                featured ? 'flex-row' : 'flex-col'
            )}
        >
            {job.image && (template === 'poster' || template === 'dark' || featured) && (
                <img
                    src={job.image}
                    alt=""
                    className={cn('block h-auto', featured ? 'w-2/5 object-cover' : 'w-full')}
                />
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                    {job.image && template !== 'poster' && template !== 'dark' && !featured && (
                        <img
                            src={job.image}
                            alt=""
                            className="size-10 shrink-0 rounded-md object-cover"
                        />
                    )}
                    <p
                        className={cn(
                            'font-semibold',
                            featured ? 'text-lg' : 'text-sm',
                            dark ? 'text-white' : 'text-catalogue-text-primary'
                        )}
                    >
                        {job.title}
                    </p>
                </div>
                <Chips job={job} inverse={dark} />
                {job.summary && (
                    <p
                        className={cn(
                            'text-xs',
                            dark ? 'text-white/70' : 'text-catalogue-text-muted'
                        )}
                    >
                        {job.summary}
                    </p>
                )}
                <span className="mt-auto inline-flex w-fit items-center gap-1 rounded-md bg-primary-500 px-3 py-1.5 text-caption font-medium text-white">
                    {view} <ArrowRight className="size-3" />
                </span>
            </div>
        </div>
    );

    const row = (job: JobItem, i: number) => (
        <div
            key={i}
            className={cn(
                'flex items-center gap-3 py-3',
                template === 'list'
                    ? 'rounded-xl border border-catalogue-border bg-catalogue-bg-elevated px-3'
                    : 'border-b border-catalogue-border'
            )}
        >
            {template === 'editorial' && (
                <span className="w-6 font-mono text-xs text-catalogue-text-muted">
                    {String(i + 1).padStart(2, '0')}
                </span>
            )}
            {template === 'list' && job.image && (
                <img src={job.image} alt="" className="size-12 shrink-0 rounded-md object-cover" />
            )}
            <div className="min-w-0 flex-1">
                <p
                    className={cn(
                        'font-semibold text-catalogue-text-primary',
                        template === 'editorial' ? 'font-serif text-lg' : 'text-sm'
                    )}
                >
                    {job.title}
                </p>
                {template !== 'minimal' && job.summary && (
                    <p className="truncate text-xs text-catalogue-text-muted">{job.summary}</p>
                )}
            </div>
            {template === 'minimal' ? <Chips job={job} /> : null}
            <span className="shrink-0 text-caption font-medium text-primary-500">{view} →</span>
        </div>
    );

    return (
        <section
            className={cn(
                'relative overflow-hidden px-8 py-10',
                dark ? 'bg-neutral-950' : 'bg-catalogue-bg'
            )}
        >
            {props.headerText && (
                <h2
                    className={cn(
                        'catalogue-h2 mb-1',
                        template === 'editorial' ? 'text-start font-serif' : 'text-center',
                        dark ? 'text-white' : 'text-catalogue-text-primary'
                    )}
                >
                    {props.headerText}
                </h2>
            )}
            {props.subheading && (
                <p
                    className={cn(
                        'mb-6 text-sm',
                        template === 'editorial' ? 'text-start' : 'text-center',
                        dark ? 'text-white/70' : 'text-catalogue-text-muted'
                    )}
                >
                    {props.subheading}
                </p>
            )}
            {jobs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-catalogue-border p-6 text-center text-xs text-catalogue-text-muted">
                    {t('jobOpenings.empty')}
                </p>
            ) : rows ? (
                <div
                    className={cn(
                        'mx-auto max-w-4xl',
                        template === 'list' ? 'space-y-2' : 'border-t border-catalogue-border'
                    )}
                >
                    {jobs.map(row)}
                </div>
            ) : template === 'spotlight' ? (
                <div className="mx-auto max-w-4xl space-y-4">
                    {card(jobs[0]!, 0, true)}
                    {jobs.length > 1 && (
                        <div className={cn('grid gap-4', cols)}>
                            {jobs.slice(1).map((j, i) => card(j, i + 1))}
                        </div>
                    )}
                </div>
            ) : (
                <div className={cn('mx-auto grid max-w-4xl items-start gap-4', cols)}>
                    {jobs.map((j, i) => card(j, i))}
                </div>
            )}
            <p
                className={cn(
                    'mt-4 text-center text-caption',
                    dark ? 'text-white/60' : 'text-catalogue-text-muted'
                )}
            >
                {t('jobOpenings.liveNote')}
            </p>
        </section>
    );
};

export default JobOpeningsPreview;
