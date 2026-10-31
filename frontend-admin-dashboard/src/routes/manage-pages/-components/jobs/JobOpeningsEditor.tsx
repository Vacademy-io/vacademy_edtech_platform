import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowDown,
    ArrowUp,
    CaretDown,
    CaretUp,
    Plus,
    Trash,
    Warning,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useEditorStore } from '../../-stores/editor-store';
import { ImageUploadField } from '../ImageUploadField';
import { LinkPicker } from '../LinkPicker';
import { RichTextField } from '../RichTextField';
import { JobTemplatePicker } from './JobTemplatePicker';
import {
    TEMPLATES_WITH_COLUMNS,
    isHttpsUrl,
    liveJobSlugs,
    readJobTemplate,
    slugifyJobTitle,
    type JobDetailPair,
    type JobItem,
} from './job-templates';

/**
 * Property panel of a Job Openings section. Same shape as the other list
 * editors in this panel (Team, Program Blocks): section copy on top, then one
 * collapsible row per job with move / delete. Reuses the page builder's own
 * fields — ImageUploadField for the poster, RichTextField for the
 * description, LinkPicker for the optional second button. Each job is shown
 * with the address it will have on the site, so the admin can share it.
 */

interface JobOpeningsEditorProps {
    component: { id: string; props: Record<string, any> };
    pageId: string;
    updateComponent: (
        pageId: string,
        componentId: string,
        patch: { props: Record<string, any> }
    ) => void;
}

// "Label: Value" per line — split on the FIRST colon, so values with colons survive.
const detailsToText = (details?: JobDetailPair[]) =>
    (details || []).map((d) => `${d?.label || ''}: ${d?.value || ''}`).join('\n');
const textToDetails = (text: string): JobDetailPair[] =>
    text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const idx = line.indexOf(':');
            return idx === -1
                ? { label: '', value: line }
                : { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
        });

const newJobId = () => `job-${Math.random().toString(36).slice(2, 8)}`;

export const JobOpeningsEditor = ({
    component,
    pageId,
    updateComponent,
}: JobOpeningsEditorProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const jobs: JobItem[] = Array.isArray(props.jobs) ? props.jobs : [];
    const [expanded, setExpanded] = useState<number | null>(0);
    const template = readJobTemplate(props.template);
    // The page this section sits on, for the job addresses shown below.
    const pageRoute = useEditorStore((s) => s.config?.pages?.find((p) => p.id === pageId)?.route);

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const setJobs = (next: JobItem[]) => updateProp('jobs', next);
    const updateJob = (i: number, patch: Partial<JobItem>) =>
        setJobs(jobs.map((j, idx) => (idx === i ? { ...j, ...patch } : j)));

    const addJob = () => {
        setJobs([
            ...jobs,
            {
                id: newJobId(),
                slug: '',
                title: t('jobOpenings.defaults.newJob'),
                image: '',
                imageAlt: '',
                summary: '',
                location: '',
                jobType: '',
                compensation: '',
                details: [],
                description: '',
                applyUrl: '',
                applyLabel: '',
                enabled: true,
            },
        ]);
        setExpanded(jobs.length);
    };
    const deleteJob = (i: number) => {
        setJobs(jobs.filter((_, idx) => idx !== i));
        if (expanded === i) setExpanded(null);
    };
    const moveJob = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= jobs.length) return;
        const next = [...jobs];
        [next[i], next[j]] = [next[j]!, next[i]!];
        setJobs(next);
        setExpanded(j);
    };

    const slugs = liveJobSlugs(jobs);
    const route = String(pageRoute || '').replace(/^\/+|\/+$/g, '');
    const onHome = !route || route === 'home' || route === 'homepage';
    const addressOf = (slug: string) => (onHome ? `/?job=${slug}` : `/${route}/${slug}`);

    const pill = (active: boolean) =>
        cn(
            'rounded px-2.5 py-1 text-caption font-medium',
            active ? 'bg-primary-100 text-primary-500' : 'bg-neutral-100 text-neutral-600'
        );

    return (
        <div className="space-y-4" data-job-openings-editor>
            <div className="rounded border border-neutral-200 bg-neutral-50 p-2 text-caption text-neutral-500">
                {t('jobOpenings.hint')}
            </div>

            <div className="space-y-2">
                <Label className="text-xs">{t('jobOpenings.template')}</Label>
                <JobTemplatePicker
                    value={props.template}
                    onChange={(v) => updateProp('template', v)}
                />
            </div>

            <div>
                <Label className="text-xs">{t('jobOpenings.headerText')}</Label>
                <Input
                    className="mt-1"
                    value={props.headerText || ''}
                    onChange={(e) => updateProp('headerText', e.target.value)}
                />
            </div>
            <div>
                <Label className="text-xs">{t('jobOpenings.subheading')}</Label>
                <Textarea
                    className="mt-1"
                    rows={2}
                    value={props.subheading || ''}
                    onChange={(e) => updateProp('subheading', e.target.value)}
                />
            </div>

            {TEMPLATES_WITH_COLUMNS.has(template) && (
                <div>
                    <Label className="text-xs">{t('jobOpenings.columns')}</Label>
                    <div className="mt-1 flex gap-1">
                        {[1, 2, 3, 4].map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => updateProp('columns', c)}
                                className={pill((props.columns ?? 2) === c)}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-caption text-neutral-400">
                        {t('jobOpenings.columnsHint')}
                    </p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                <div>
                    <Label className="text-xs">{t('jobOpenings.viewButtonLabel')}</Label>
                    <Input
                        className="mt-1"
                        value={props.viewButtonLabel || ''}
                        placeholder={t('jobOpenings.defaults.view')}
                        onChange={(e) => updateProp('viewButtonLabel', e.target.value)}
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('jobOpenings.applyButtonLabel')}</Label>
                    <Input
                        className="mt-1"
                        value={props.applyButtonLabel || ''}
                        placeholder={t('jobOpenings.defaults.apply')}
                        onChange={(e) => updateProp('applyButtonLabel', e.target.value)}
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('jobOpenings.backLabel')}</Label>
                    <Input
                        className="mt-1"
                        value={props.backLabel || ''}
                        placeholder={t('jobOpenings.defaults.back')}
                        onChange={(e) => updateProp('backLabel', e.target.value)}
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('jobOpenings.emptyMessage')}</Label>
                    <Input
                        className="mt-1"
                        value={props.emptyMessage || ''}
                        placeholder={t('jobOpenings.defaults.empty')}
                        onChange={(e) => updateProp('emptyMessage', e.target.value)}
                    />
                </div>
            </div>

            <div className="space-y-2 border-t pt-4">
                <div className="flex items-center justify-between">
                    <Label className="text-xs">
                        {t('jobOpenings.jobsCount', { count: jobs.length })}
                    </Label>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-caption"
                        onClick={addJob}
                    >
                        <Plus className="me-1 size-3" /> {t('jobOpenings.addJob')}
                    </Button>
                </div>

                {jobs.map((job, i) => {
                    const open = expanded === i;
                    const slug = slugs[i];
                    const badApply = !!job.applyUrl && !isHttpsUrl(job.applyUrl);
                    return (
                        <div
                            key={job.id || i}
                            className={cn(
                                'rounded border border-neutral-200',
                                job.enabled === false && 'opacity-60'
                            )}
                        >
                            <div className="flex items-center gap-1 bg-neutral-50 px-2 py-1.5">
                                <button
                                    type="button"
                                    onClick={() => setExpanded(open ? null : i)}
                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs font-medium"
                                >
                                    {open ? (
                                        <CaretUp className="size-3.5 shrink-0" />
                                    ) : (
                                        <CaretDown className="size-3.5 shrink-0" />
                                    )}
                                    <span className="truncate">
                                        {job.title || t('jobOpenings.jobN', { n: i + 1 })}
                                    </span>
                                </button>
                                <Switch
                                    checked={job.enabled !== false}
                                    onCheckedChange={(c) => updateJob(i, { enabled: c })}
                                    aria-label={t('jobOpenings.visible')}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    disabled={i === 0}
                                    onClick={() => moveJob(i, -1)}
                                    title={t('actions.moveUp')}
                                >
                                    <ArrowUp className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0"
                                    disabled={i === jobs.length - 1}
                                    onClick={() => moveJob(i, 1)}
                                    title={t('actions.moveDown')}
                                >
                                    <ArrowDown className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-6 p-0 text-danger-600"
                                    onClick={() => deleteJob(i)}
                                    title={t('actions.delete')}
                                >
                                    <Trash className="size-3" />
                                </Button>
                            </div>

                            {open && (
                                <div className="space-y-3 p-2">
                                    <div>
                                        <Label className="text-xs">{t('jobOpenings.title')}</Label>
                                        <Input
                                            className="mt-1"
                                            value={job.title || ''}
                                            onChange={(e) =>
                                                updateJob(i, { title: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">{t('jobOpenings.slug')}</Label>
                                        <Input
                                            className="mt-1 font-mono text-caption"
                                            value={job.slug || ''}
                                            placeholder={
                                                slugifyJobTitle(job.title) ||
                                                t('jobOpenings.slugAuto')
                                            }
                                            onChange={(e) => updateJob(i, { slug: e.target.value })}
                                            onBlur={(e) =>
                                                updateJob(i, {
                                                    slug: slugifyJobTitle(e.target.value),
                                                })
                                            }
                                        />
                                        <p className="mt-1 break-all text-caption text-neutral-400">
                                            {slug
                                                ? t('jobOpenings.address', {
                                                      address: addressOf(slug),
                                                  })
                                                : t('jobOpenings.addressHidden')}
                                        </p>
                                    </div>
                                    <ImageUploadField
                                        slot="free"
                                        label={t('jobOpenings.image')}
                                        value={job.image || ''}
                                        onChange={(url) => updateJob(i, { image: url })}
                                        aiKind="image"
                                    />
                                    {job.image && (
                                        <div>
                                            <Label className="text-xs">
                                                {t('jobOpenings.imageAlt')}
                                            </Label>
                                            <Input
                                                className="mt-1"
                                                value={job.imageAlt || ''}
                                                placeholder={job.title || ''}
                                                onChange={(e) =>
                                                    updateJob(i, { imageAlt: e.target.value })
                                                }
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <Label className="text-xs">
                                            {t('jobOpenings.summary')}
                                        </Label>
                                        <Textarea
                                            className="mt-1"
                                            rows={2}
                                            value={job.summary || ''}
                                            onChange={(e) =>
                                                updateJob(i, { summary: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">
                                                {t('jobOpenings.location')}
                                            </Label>
                                            <Input
                                                className="mt-1"
                                                value={job.location || ''}
                                                onChange={(e) =>
                                                    updateJob(i, { location: e.target.value })
                                                }
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">
                                                {t('jobOpenings.jobType')}
                                            </Label>
                                            <Input
                                                className="mt-1"
                                                value={job.jobType || ''}
                                                placeholder={t('jobOpenings.jobTypePlaceholder')}
                                                onChange={(e) =>
                                                    updateJob(i, { jobType: e.target.value })
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="text-xs">
                                            {t('jobOpenings.compensation')}
                                        </Label>
                                        <Input
                                            className="mt-1"
                                            value={job.compensation || ''}
                                            onChange={(e) =>
                                                updateJob(i, { compensation: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">
                                            {t('jobOpenings.details')}
                                        </Label>
                                        <Textarea
                                            className="mt-1 font-mono text-caption"
                                            rows={3}
                                            value={detailsToText(job.details)}
                                            onChange={(e) =>
                                                updateJob(i, {
                                                    details: textToDetails(e.target.value),
                                                })
                                            }
                                            placeholder={t('jobOpenings.detailsPlaceholder')}
                                        />
                                    </div>
                                    <RichTextField
                                        key={`description-${job.id || i}`}
                                        label={t('jobOpenings.description')}
                                        value={job.description || ''}
                                        onChange={(html) => updateJob(i, { description: html })}
                                    />
                                    <div>
                                        <Label className="text-xs">
                                            {t('jobOpenings.applyUrl')}
                                        </Label>
                                        <Input
                                            className="mt-1"
                                            type="url"
                                            inputMode="url"
                                            value={job.applyUrl || ''}
                                            placeholder="https://"
                                            onChange={(e) =>
                                                updateJob(i, { applyUrl: e.target.value.trim() })
                                            }
                                        />
                                        {badApply ? (
                                            <p className="mt-1 flex items-center gap-1 text-caption text-warning-600">
                                                <Warning className="size-3 shrink-0" />{' '}
                                                {t('jobOpenings.applyUrlInvalid')}
                                            </p>
                                        ) : (
                                            <p className="mt-1 text-caption text-neutral-400">
                                                {t('jobOpenings.applyUrlHint')}
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <Label className="text-xs">
                                            {t('jobOpenings.applyLabel')}
                                        </Label>
                                        <Input
                                            className="mt-1"
                                            value={job.applyLabel || ''}
                                            placeholder={
                                                props.applyButtonLabel ||
                                                t('jobOpenings.defaults.apply')
                                            }
                                            onChange={(e) =>
                                                updateJob(i, { applyLabel: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2 rounded border border-dashed border-neutral-200 p-2">
                                        <p className="text-caption font-medium text-neutral-500">
                                            {t('jobOpenings.secondary')}
                                        </p>
                                        <Input
                                            value={job.secondaryLabel || ''}
                                            placeholder={t('jobOpenings.secondaryLabel')}
                                            onChange={(e) =>
                                                updateJob(i, { secondaryLabel: e.target.value })
                                            }
                                        />
                                        <LinkPicker
                                            value={job.secondaryUrl || ''}
                                            onChange={(v) => updateJob(i, { secondaryUrl: v })}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default JobOpeningsEditor;
