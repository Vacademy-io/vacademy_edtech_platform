import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Archive,
    ArrowsCounterClockwise,
    Check,
    Copy,
    EnvelopeSimple,
    Eye,
    PencilSimple,
    Sparkle,
    Trash,
    Warning,
    XCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { cn } from '@/lib/utils';
import { ToneBadge } from './ToneBadge';
import { Chip } from './engine-ui';
import { GenerateTemplatesDialog } from './GenerateTemplatesDialog';
import { VariableSourceField } from './VariableSourceField';
import { useEmailTemplateMutation, useEmailTemplatePreview, useEmailTemplates } from '../-hooks/templates';
import {
    isCompleteSource,
    type EmailMode,
    type EmailTemplate,
    type EmailTemplateEditRequest,
    type EmailTemplateStatus,
    type GenerateMode,
} from '../-types/templates';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<EmailTemplateStatus, Tone> = {
    AI_PROPOSED: 'info',
    USER_REVIEW: 'warning',
    APPROVED: 'success',
    SUPERSEDED: 'neutral',
    ARCHIVED: 'neutral',
};

const REVIEWABLE = new Set<EmailTemplateStatus>(['AI_PROPOSED', 'USER_REVIEW']);
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g;

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Client-side render with sample values, for the live preview while editing. */
function renderSample(html: string, names: string[], samples: string[]): string {
    return html.replace(PLACEHOLDER, (_m, name: string) => {
        const i = names.indexOf(name);
        return i >= 0 && samples[i] ? escapeHtml(samples[i]!) : `{{${name}}}`;
    });
}

/** Plain-text fill for the subject line (React escapes it on render). */
function fillPlain(text: string, names: string[], samples: string[]): string {
    return text.replace(PLACEHOLDER, (_m, name: string) => {
        const i = names.indexOf(name);
        return i >= 0 && samples[i] ? samples[i]! : `{{${name}}}`;
    });
}

/** The rendered email in a sandboxed frame: no scripts, no navigation, no access to the app. */
function EmailFrame({ html, title }: { html: string; title: string }) {
    return (
        <iframe
            title={title}
            sandbox=""
            srcDoc={`<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:12px">${html}</body></html>`}
            className="h-72 w-full rounded-lg border border-neutral-200 bg-white"
        />
    );
}

export function EmailTemplatesPanel({
    engineId,
    language,
    emailMode,
}: {
    engineId: string;
    language?: string;
    emailMode?: EmailMode;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const { data: templates, isLoading, isError, refetch } = useEmailTemplates(engineId);
    const m = useEmailTemplateMutation();
    const [generate, setGenerate] = useState<{ mode: GenerateMode; basedOn?: EmailTemplate } | null>(null);
    const [editing, setEditing] = useState<EmailTemplate | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [showOld, setShowOld] = useState(false);

    const visible = useMemo(
        () =>
            (templates ?? []).filter(
                (tpl) => showOld || (tpl.status !== 'ARCHIVED' && tpl.status !== 'SUPERSEDED')
            ),
        [templates, showOld]
    );
    const approvedCount = (templates ?? []).filter((tpl) => tpl.status === 'APPROVED').length;
    const hiddenCount = (templates?.length ?? 0) - visible.length;

    return (
        <SectionCard
            title={t('email.heading')}
            subtitle={t('email.approvedCount', { count: approvedCount })}
            icon={EnvelopeSimple}
            right={
                <MyButton
                    buttonType="primary"
                    scale="small"
                    disable={m.generate.isPending}
                    onClick={() => setGenerate({ mode: 'NEW' })}
                >
                    <Sparkle className="me-1 size-4" />
                    {m.generate.isPending ? t('generate.generating') : t('actions.generateWithAi')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-neutral-600">
                    <span className="text-body">{t('email.subheading')}</span>
                </p>
                <p className="rounded-lg bg-info-50 p-2 text-info-700">
                    <span className="text-caption">
                        {t(`email.modes.${emailMode ?? 'FREE_WRITE'}`)}
                    </span>
                </p>

                {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}

                {!isLoading && isError && (
                    <Card className="flex flex-col items-center gap-2 p-6 text-center">
                        <span className="text-body text-danger-600">{t('errors.loadFailed')}</span>
                        <MyButton buttonType="secondary" scale="small" onClick={() => refetch()}>
                            {t('actions.retry')}
                        </MyButton>
                    </Card>
                )}

                {!isLoading && !isError && (templates?.length ?? 0) === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
                        <EnvelopeSimple size={28} className="text-neutral-300" />
                        <p className="max-w-md text-neutral-500">
                            <span className="text-body">{t('email.emptyState')}</span>
                        </p>
                    </div>
                )}

                {(templates?.length ?? 0) > 0 && (
                    <label className="flex w-fit items-center gap-2 text-neutral-500">
                        <Switch checked={showOld} onCheckedChange={setShowOld} aria-label={t('email.showOld')} />
                        <span className="text-caption">
                            {t('email.showOld')}
                            {!showOld && hiddenCount > 0 ? ` (${hiddenCount})` : ''}
                        </span>
                    </label>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                    {visible.map((tpl) => (
                        <EmailTemplateCard
                            key={tpl.id}
                            tpl={tpl}
                            busy={m.approve.isPending || m.archive.isPending || m.generate.isPending}
                            onPreview={() => setPreviewId(tpl.id)}
                            onEdit={() => setEditing(tpl)}
                            onApprove={() => m.approve.mutate({ id: tpl.id, engineId })}
                            onArchive={() => m.archive.mutate({ id: tpl.id, engineId })}
                            onRegenerate={() => setGenerate({ mode: 'REGENERATE', basedOn: tpl })}
                            onMoreLikeThis={() => setGenerate({ mode: 'MORE_LIKE_THIS', basedOn: tpl })}
                        />
                    ))}
                </div>
            </div>

            {generate && (
                <GenerateTemplatesDialog
                    engineId={engineId}
                    channel="EMAIL"
                    mode={generate.mode}
                    defaultLanguage={generate.basedOn?.language ?? language}
                    busy={m.generate.isPending}
                    onClose={() => setGenerate(null)}
                    onGenerate={(options) =>
                        m.generate.mutate(
                            {
                                engineId,
                                payload: { ...options, mode: generate.mode, basedOnId: generate.basedOn?.id },
                            },
                            { onSuccess: () => setGenerate(null) }
                        )
                    }
                />
            )}

            {editing && (
                <EditEmailTemplateDialog
                    tpl={editing}
                    saving={m.edit.isPending}
                    onClose={() => setEditing(null)}
                    onSave={(payload) =>
                        m.edit.mutate({ id: editing.id, engineId, payload }, { onSuccess: () => setEditing(null) })
                    }
                />
            )}

            {previewId && <PreviewDialog id={previewId} onClose={() => setPreviewId(null)} />}
        </SectionCard>
    );
}

function EmailTemplateCard({
    tpl,
    busy,
    onPreview,
    onEdit,
    onApprove,
    onArchive,
    onRegenerate,
    onMoreLikeThis,
}: {
    tpl: EmailTemplate;
    busy: boolean;
    onPreview: () => void;
    onEdit: () => void;
    onApprove: () => void;
    onArchive: () => void;
    onRegenerate: () => void;
    onMoreLikeThis: () => void;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const blocking = tpl.issues.filter((i) => i.level === 'BLOCK');
    const warnings = tpl.issues.filter((i) => i.level === 'WARN');
    const reviewable = REVIEWABLE.has(tpl.status);
    const active = tpl.status !== 'ARCHIVED' && tpl.status !== 'SUPERSEDED';

    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-xl border p-4',
                active ? 'border-neutral-200' : 'border-neutral-100 bg-neutral-50'
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-semibold text-neutral-800">
                    <span className="text-subtitle">{tpl.title || tpl.name}</span>
                </span>
                <ToneBadge label={t(`email.status.${tpl.status}`)} tone={STATUS_TONE[tpl.status]} />
                <Chip label={t('email.version', { value: tpl.version })} />
                <Chip label={t(`generate.languages.${tpl.language}`)} />
                {tpl.purpose && <Chip label={tpl.purpose} />}
            </div>
            <span className="font-mono text-caption text-neutral-400">{tpl.name}</span>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <p className="font-semibold text-neutral-800">
                    <span className="text-body">{tpl.subject}</span>
                </p>
                {tpl.preheader && <p className="text-caption text-neutral-500">{tpl.preheader}</p>}
            </div>
            {tpl.variableNames.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {tpl.variableNames.map((v) => (
                        <li key={v} className="text-caption text-neutral-500">
                            <span className="font-mono text-neutral-700">{`{{${v}}}`}</span>
                            {' ← '}
                            {tpl.variableSources[v] ?? t('sources.missing')}
                        </li>
                    ))}
                </ul>
            )}
            {blocking.map((i) => (
                <p key={i.code + i.message} className="flex items-start gap-2 rounded-lg bg-danger-50 p-2 text-danger-600">
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{i.message}</span>
                </p>
            ))}
            {warnings.map((i) => (
                <p key={i.code + i.message} className="flex items-start gap-2 rounded-lg bg-warning-50 p-2 text-warning-700">
                    <Warning size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{i.message}</span>
                </p>
            ))}
            {tpl.rationale && <p className="text-caption italic text-neutral-400">{tpl.rationale}</p>}

            <div className="mt-auto flex flex-wrap items-center gap-2">
                <MyButton buttonType="secondary" scale="small" onClick={onPreview}>
                    <Eye className="me-1 size-3.5" /> {t('actions.preview')}
                </MyButton>
                {(reviewable || tpl.status === 'APPROVED') && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onEdit}>
                        <PencilSimple className="me-1 size-3.5" />
                        {tpl.status === 'APPROVED' ? t('actions.editNewVersion') : t('actions.edit')}
                    </MyButton>
                )}
                {reviewable && (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={busy || blocking.length > 0}
                        onClick={onApprove}
                    >
                        <Check className="me-1 size-3.5" /> {t('actions.approve')}
                    </MyButton>
                )}
                {reviewable && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onRegenerate}>
                        <ArrowsCounterClockwise className="me-1 size-3.5" /> {t('actions.regenerate')}
                    </MyButton>
                )}
                {active && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onMoreLikeThis}>
                        <Copy className="me-1 size-3.5" /> {t('actions.moreLikeThis')}
                    </MyButton>
                )}
                {active && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onArchive}>
                        <Archive className="me-1 size-3.5" /> {t('actions.archive')}
                    </MyButton>
                )}
            </div>
        </div>
    );
}

function PreviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const { data, isLoading, isError } = useEmailTemplatePreview(id);
    return (
        <MyDialog heading={t('preview.heading')} open onOpenChange={(o) => !o && onClose()} dialogWidth="max-w-2xl">
            <div className="flex flex-col gap-3 p-1">
                {isLoading && <Skeleton className="h-72 w-full rounded-lg" />}
                {isError && <p className="text-body text-danger-600">{t('errors.previewFailed')}</p>}
                {data && (
                    <>
                        <p className="text-caption text-neutral-500">{t('preview.sampleNote')}</p>
                        <p className="font-semibold text-neutral-800">
                            <span className="text-body">{data.subject}</span>
                        </p>
                        <EmailFrame html={data.html} title={t('preview.heading')} />
                        {data.missingVariables.length > 0 && (
                            <p className="rounded-lg bg-danger-50 p-2 text-caption text-danger-600">
                                {t('preview.missing', { list: data.missingVariables.join(', ') })}
                            </p>
                        )}
                    </>
                )}
            </div>
        </MyDialog>
    );
}

interface VariableRow {
    name: string;
    sample: string;
    source: string;
}

function EditEmailTemplateDialog({
    tpl,
    saving,
    onClose,
    onSave,
}: {
    tpl: EmailTemplate;
    saving: boolean;
    onClose: () => void;
    onSave: (payload: EmailTemplateEditRequest) => void;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const [title, setTitle] = useState(tpl.title ?? '');
    const [subject, setSubject] = useState(tpl.subject);
    const [preheader, setPreheader] = useState(tpl.preheader ?? '');
    const [body, setBody] = useState(tpl.bodyHtml);
    const [rows, setRows] = useState<VariableRow[]>(() =>
        tpl.variableNames.map((n, i) => ({
            name: n,
            sample: tpl.sampleValues[i] ?? '',
            source: tpl.variableSources[n] ?? '',
        }))
    );

    // Mirror of the backend's blocking checks, so Save is only enabled for what the server accepts.
    const problem = ((): string | null => {
        if (!subject.trim()) return t('edit.errors.subjectEmpty');
        if (!body.trim()) return t('edit.errors.bodyEmpty');
        const names = rows.map((r) => r.name.trim());
        if (names.some((n) => !/^[a-z][a-z0-9_]{0,39}$/.test(n))) return t('edit.errors.badName');
        if (new Set(names).size !== names.length) return t('edit.errors.duplicateName');
        const used = new Set(Array.from(`${subject}\n${body}`.matchAll(PLACEHOLDER)).map((mm) => mm[1]!));
        const unknown = Array.from(used).find((u) => !names.includes(u));
        if (unknown) return t('edit.errors.unknownPlaceholder', { name: `{{${unknown}}}` });
        const noSource = rows.find((r) => !isCompleteSource(r.source));
        if (noSource) return t('edit.errors.noSource', { name: noSource.name || '?' });
        return null;
    })();

    const preview = renderSample(
        body,
        rows.map((r) => r.name.trim()),
        rows.map((r) => r.sample)
    );

    const save = () =>
        onSave({
            title: title.trim(),
            subject: subject.trim(),
            preheader: preheader.trim(),
            bodyHtml: body,
            variableNames: rows.map((r) => r.name.trim()),
            sampleValues: rows.map((r) => r.sample.trim()),
            variableSources: Object.fromEntries(rows.map((r) => [r.name.trim(), r.source.trim()])),
        });

    const update = (i: number, patch: Partial<VariableRow>) =>
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    return (
        <MyDialog
            heading={tpl.status === 'APPROVED' ? t('edit.headingNewVersion') : t('edit.heading')}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-4xl"
        >
            <div className="grid gap-4 overflow-y-auto p-1 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                    {tpl.status === 'APPROVED' && (
                        <p className="rounded-lg bg-info-50 p-2 text-caption text-info-700">{t('edit.newVersionNote')}</p>
                    )}
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">{t('edit.title')}</label>
                        <Input value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">{t('edit.subject')}</label>
                        <Input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">{t('edit.preheader')}</label>
                        <Input value={preheader} maxLength={255} onChange={(e) => setPreheader(e.target.value)} />
                    </div>
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">
                            {t('edit.body', { example: '{{first_name}}' })}
                        </label>
                        <Textarea
                            rows={10}
                            className="font-mono"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-caption text-neutral-500">{t('edit.variables')}</label>
                        {rows.map((row, i) => (
                            <div key={i} className="flex flex-col gap-2 rounded-lg border border-neutral-100 p-2">
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={row.name}
                                        placeholder={t('edit.namePlaceholder')}
                                        onChange={(e) => update(i, { name: e.target.value })}
                                    />
                                    <Input
                                        value={row.sample}
                                        placeholder={t('edit.samplePlaceholder')}
                                        onChange={(e) => update(i, { sample: e.target.value })}
                                    />
                                    <button
                                        type="button"
                                        aria-label={t('edit.removeVariable')}
                                        className="text-neutral-400 hover:text-danger-600"
                                        onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                                    >
                                        <Trash className="size-4" />
                                    </button>
                                </div>
                                <VariableSourceField
                                    variable={row.name}
                                    value={row.source}
                                    onChange={(source) => update(i, { source })}
                                />
                            </div>
                        ))}
                        <button
                            type="button"
                            className="w-fit text-caption text-primary-600"
                            onClick={() => setRows((prev) => [...prev, { name: '', sample: '', source: '' }])}
                        >
                            {t('edit.addVariable')}
                        </button>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-caption text-neutral-500">{t('edit.livePreview')}</span>
                    <p className="font-semibold text-neutral-800">
                        <span className="text-body">
                            {fillPlain(
                                subject,
                                rows.map((r) => r.name.trim()),
                                rows.map((r) => r.sample)
                            )}
                        </span>
                    </p>
                    <EmailFrame html={preview} title={t('edit.livePreview')} />
                    {problem && <p className="text-caption text-danger-600">{problem}</p>}
                </div>
                <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3 lg:col-span-2">
                    <MyButton buttonType="secondary" scale="small" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="small" disable={saving || !!problem} onClick={save}>
                        {saving ? t('edit.saving') : t('edit.save')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
