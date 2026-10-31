import { Fragment, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    ArrowsCounterClockwise,
    CaretRight,
    Copy,
    Check,
    Info,
    PaperPlaneTilt,
    PencilSimple,
    Sparkle,
    Trash,
    WhatsappLogo,
    XCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { cn } from '@/lib/utils';
import { ToneBadge } from './ToneBadge';
import { Chip } from './engine-ui';
import { ConfirmDialog } from './ConfirmDialog';
import { buildProposalStatusMeta, buildTemplateCategoryOptions } from '../-constants';
import { useTemplateMutation, useTemplates } from '../-hooks';
import { useWhatsAppGenerate } from '../-hooks/templates';
import { safeParse } from '../-utils';
import { GenerateTemplatesDialog } from './GenerateTemplatesDialog';
import { VariableSourceField } from './VariableSourceField';
import { isCompleteSource, type GenerateMode } from '../-types/templates';
import type {
    EngagementTemplateProposal,
    ProposalStatus,
    TemplateButton,
    TemplateCategory,
    TemplateEditRequest,
    TemplateHeaderType,
} from '../-types';

/** Approved (or later disabled) templates are edited as a new version that replaces them (W15). */
const NEW_VERSION_ON_EDIT = new Set(['META_APPROVED', 'META_RECATEGORISED', 'META_DISABLED']);
const HEADER_TYPES: TemplateHeaderType[] = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];
const BUTTON_TYPES: TemplateButton['type'][] = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'];
/** Mirror of WhatsAppTemplateRules.PROMO for instant feedback; the server warning is authoritative. */
const PROMO = /(^|[^\p{L}])(offer|offers|discount|discounts|sale|% off|off on|free|cashback|coupon|promo|deal|deals|limited (time|seats)|hurry|last chance|enrol(l)? now|join now|register now|admissions? open|new batch|special price|scholarship|book now|don'?t miss|chhoot|chhut|muft)($|[^\p{L}])/iu;

const EDITABLE = new Set(['AI_PROPOSED', 'USER_REVIEW', 'META_REJECTED']);

const FLOW_KEYS = ['propose', 'approve', 'submit', 'meta', 'send'] as const;

/** How far along the propose → approve → submit → Meta → send flow a proposal is. */
const FLOW_REACHED: Partial<Record<ProposalStatus, number>> = {
    AI_PROPOSED: 1,
    USER_REVIEW: 1,
    USER_APPROVED: 2,
    SUBMITTED: 3,
    META_PENDING: 3,
    META_REJECTED: 3,
    META_APPROVED: 5,
    META_RECATEGORISED: 5,
    META_DISABLED: 4,
    QUEUED: 3,
};

/** The five stages, ticked up to the furthest any current proposal has reached. */
function FlowStrip({ reached }: { reached: number }) {
    const { t } = useTranslation('engagementEnginesTemplateNegotiation');
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {FLOW_KEYS.map((key, i) => {
                const done = i < reached;
                return (
                    <Fragment key={key}>
                        {i > 0 && <CaretRight size={12} className="text-neutral-300" />}
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium',
                                done
                                    ? 'border-success-200 bg-success-50 text-success-700'
                                    : 'border-neutral-200 bg-white text-neutral-500'
                            )}
                        >
                            {done ? (
                                <Check size={12} weight="bold" />
                            ) : (
                                <span className="text-caption">{i + 1}</span>
                            )}
                            <span className="text-caption">{t(`flow.${key}`)}</span>
                        </span>
                    </Fragment>
                );
            })}
        </div>
    );
}

/** The template body with its {{n}} placeholders picked out. */
function TemplateBody({ body }: { body: string }) {
    const parts = body.split(/(\{\{\d+\}\})/g);
    return (
        <p className="whitespace-pre-wrap rounded-lg border border-success-100 bg-success-50 p-3 text-neutral-800">
            <span className="text-body">
                {parts.map((part, i) =>
                    /^\{\{\d+\}\}$/.test(part) ? (
                        <span key={i} className="font-semibold text-success-700">
                            {part}
                        </span>
                    ) : (
                        <Fragment key={i}>{part}</Fragment>
                    )
                )}
            </span>
        </p>
    );
}

export function TemplateNegotiation({ engineId, language }: { engineId: string; language?: string }) {
    const { t } = useTranslation('engagementEnginesTemplateNegotiation');
    const { t: tTpl } = useTranslation('engagementEnginesTemplates');
    const { data: proposals, isLoading, isError } = useTemplates(engineId);
    const m = useTemplateMutation();
    const gen = useWhatsAppGenerate();
    const [editing, setEditing] = useState<EngagementTemplateProposal | null>(null);
    const [generate, setGenerate] = useState<{
        mode: GenerateMode;
        basedOn?: EngagementTemplateProposal;
    } | null>(null);
    const generating = gen.generate.isPending || gen.alternatives.isPending;

    const anyProposals = (proposals?.length ?? 0) > 0;
    const reached = Math.max(0, ...(proposals ?? []).map((p) => FLOW_REACHED[p.status] ?? 0));

    return (
        <SectionCard
            title={t('heading')}
            subtitle={
                anyProposals ? t('proposalCount', { count: proposals?.length ?? 0 }) : undefined
            }
            icon={WhatsappLogo}
            right={
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={m.sync.isPending}
                        onClick={() => m.sync.mutate({ engineId })}
                    >
                        <ArrowsClockwise className="me-1 size-4" /> {t('actions.checkMeta')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={generating}
                        onClick={() => setGenerate({ mode: 'NEW' })}
                    >
                        <Sparkle className="me-1 size-4" />
                        {generating ? t('actions.thinking') : tTpl('actions.generateWithAi')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-neutral-600">
                    <span className="text-body">{t('subheading')}</span>
                </p>
                <FlowStrip reached={reached} />

                {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}

                {!isLoading && isError && (
                    <Card className="p-6 text-center text-body text-danger-600">
                        {t('errors.loadFailed')}
                    </Card>
                )}

                {!isLoading && !isError && !anyProposals && (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
                        <WhatsappLogo size={28} className="text-neutral-300" />
                        <p className="max-w-md text-neutral-500">
                            <span className="text-body">{t('emptyState')}</span>
                        </p>
                    </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                    {proposals?.map((p) => (
                        <ProposalCard
                            key={p.id}
                            p={p}
                            engineId={engineId}
                            onEdit={() => setEditing(p)}
                            onRegenerate={() => setGenerate({ mode: 'REGENERATE', basedOn: p })}
                            onMoreLikeThis={() => setGenerate({ mode: 'MORE_LIKE_THIS', basedOn: p })}
                            generating={generating}
                            mutations={m}
                        />
                    ))}
                </div>
            </div>

            {generate && (
                <GenerateTemplatesDialog
                    engineId={engineId}
                    channel="WHATSAPP"
                    mode={generate.mode}
                    defaultLanguage={generate.basedOn?.language ?? language}
                    busy={generating}
                    onClose={() => setGenerate(null)}
                    onGenerate={(options) => {
                        const done = { onSuccess: () => setGenerate(null) };
                        if (generate.mode === 'NEW') {
                            gen.generate.mutate({ engineId, options }, done);
                        } else {
                            gen.alternatives.mutate(
                                {
                                    engineId,
                                    mode: generate.mode,
                                    options: { ...options, basedOnId: generate.basedOn?.id },
                                },
                                done
                            );
                        }
                    }}
                />
            )}

            {editing && (
                <EditTemplateDialog
                    proposal={editing}
                    engineId={engineId}
                    onClose={() => setEditing(null)}
                    onSave={(payload) =>
                        m.edit.mutate(
                            { id: editing.id, engineId, payload },
                            { onSuccess: () => setEditing(null) }
                        )
                    }
                    saving={m.edit.isPending}
                />
            )}
        </SectionCard>
    );
}

function ProposalCard({
    p,
    engineId,
    onEdit,
    onRegenerate,
    onMoreLikeThis,
    generating,
    mutations,
}: {
    p: EngagementTemplateProposal;
    engineId: string;
    onEdit: () => void;
    onRegenerate: () => void;
    onMoreLikeThis: () => void;
    generating: boolean;
    mutations: ReturnType<typeof useTemplateMutation>;
}) {
    const { t } = useTranslation('engagementEnginesTemplateNegotiation');
    const { t: tTpl } = useTranslation('engagementEnginesTemplates');
    const sources = safeParse<Record<string, string>>(p.variableSources, {});
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const meta = buildProposalStatusMeta(tConstants)[p.status] ?? {
        label: p.status,
        tone: 'neutral' as const,
    };
    const vars = safeParse<string[]>(p.variableNames, []);
    const busy =
        mutations.approve.isPending || mutations.submit.isPending || mutations.withdraw.isPending;
    const [confirmWithdraw, setConfirmWithdraw] = useState(false);
    const categoryLabel =
        buildTemplateCategoryOptions(tConstants).find((o) => o.value === p.proposedCategory)
            ?.label ?? p.proposedCategory;

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-semibold text-neutral-800">
                    <span className="text-caption">{p.name}</span>
                </span>
                {p.language && <Chip label={languageName(p.language)} />}
                {p.purpose && <Chip label={p.purpose} />}
                <ToneBadge label={meta.label} tone={meta.tone} />
                {p.reusedFromId && (
                    <Chip label={tTpl('reuse.chip')} className="bg-success-50 text-success-600" />
                )}
                <span className="ms-auto text-neutral-400">
                    <span className="text-caption">
                        {t('proposalCard.round', { value: p.round })} · {categoryLabel}
                    </span>
                </span>
            </div>
            <TemplateBody body={p.proposedBody} />
            {vars.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                    {vars.map((v, i) => (
                        <li key={v} className="text-caption text-neutral-500">
                            <span className="font-mono text-neutral-700">{`{{${i + 1}}} ${v}`}</span>
                            {' ← '}
                            {sources[v] ?? tTpl('sources.missing')}
                        </li>
                    ))}
                </ul>
            )}
            {p.headerType && p.headerType !== 'NONE' && (
                <p className="text-caption text-neutral-500">
                    {tTpl('whatsapp.header', { type: tTpl(`whatsapp.headerTypes.${p.headerType}`) })}
                    {p.headerType === 'TEXT' ? `: ${p.headerText ?? ''}` : ''}
                    {p.headerType !== 'TEXT' && p.headerMediaUrl && (
                        <>
                            {': '}
                            <a href={p.headerMediaUrl} target="_blank" rel="noreferrer" className="text-primary-600 underline">
                                {tTpl('whatsapp.openFile')}
                            </a>
                        </>
                    )}
                </p>
            )}
            {safeParse<TemplateButton[]>(p.buttons, []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {safeParse<TemplateButton[]>(p.buttons, []).map((b, i) => (
                        <Chip key={i} label={`${b.text} · ${tTpl(`whatsapp.buttonTypes.${b.type}`)}`} />
                    ))}
                </div>
            )}
            {p.categoryWarning && (
                <p className="flex items-start gap-2 rounded-lg bg-warning-50 p-2 text-warning-700">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">{p.categoryWarning}</span>
                </p>
            )}
            {p.replacesId && (
                <p className="text-caption text-info-700">{tTpl('whatsapp.replacesNote')}</p>
            )}
            {p.status === 'QUEUED' && (
                <p className="rounded-lg bg-warning-50 p-2 text-caption text-warning-700">{tTpl('whatsapp.queuedNote')}</p>
            )}
            {p.rationale && <p className="text-caption italic text-neutral-400">{p.rationale}</p>}
            {p.status === 'META_REJECTED' && p.rejectionReason && (
                <p className="flex items-start gap-2 rounded-lg bg-danger-50 p-2 text-danger-600">
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">
                        {t('proposalCard.metaRejected', { reason: p.rejectionReason })}
                    </span>
                </p>
            )}
            {p.status === 'META_RECATEGORISED' && (
                <p className="flex items-start gap-2 rounded-lg bg-warning-50 p-2 text-warning-700">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">
                        <Trans
                            i18nKey="engagementEnginesTemplateNegotiation:proposalCard.metaRecategorised"
                            values={{
                                metaCategory: p.metaCategory,
                                proposedCategory: p.proposedCategory,
                            }}
                            components={{ b: <b /> }}
                        />
                    </span>
                </p>
            )}

            {p.status === 'META_DISABLED' && (
                <p className="flex items-start gap-2 rounded-lg bg-danger-50 p-2 text-danger-600">
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                    <span className="text-caption">
                        {p.rejectionReason || tTpl('whatsapp.disabledByMeta')}
                    </span>
                </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2">
                {EDITABLE.has(p.status) && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy || generating}
                        onClick={onRegenerate}
                    >
                        <ArrowsCounterClockwise className="me-1 size-3.5" /> {tTpl('actions.regenerate')}
                    </MyButton>
                )}
                {p.status !== 'WITHDRAWN' && p.status !== 'SUPERSEDED' && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy || generating}
                        onClick={onMoreLikeThis}
                    >
                        <Copy className="me-1 size-3.5" /> {tTpl('actions.moreLikeThis')}
                    </MyButton>
                )}
                {(EDITABLE.has(p.status) || NEW_VERSION_ON_EDIT.has(p.status)) && (
                    <MyButton buttonType="secondary" scale="small" disable={busy} onClick={onEdit}>
                        <PencilSimple className="me-1 size-3.5" />
                        {NEW_VERSION_ON_EDIT.has(p.status) ? tTpl('actions.editNewVersion') : t('actions.edit')}
                    </MyButton>
                )}
                {(p.status === 'AI_PROPOSED' || p.status === 'USER_REVIEW') && (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={busy}
                        onClick={() => mutations.approve.mutate({ id: p.id, engineId })}
                    >
                        <Check className="me-1 size-3.5" /> {t('actions.approve')}
                    </MyButton>
                )}
                {p.status === 'USER_APPROVED' && (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={busy}
                        onClick={() => mutations.submit.mutate({ id: p.id, engineId })}
                    >
                        <PaperPlaneTilt className="me-1 size-3.5" /> {t('actions.submitToMeta')}
                    </MyButton>
                )}
                {['AI_PROPOSED', 'USER_REVIEW', 'USER_APPROVED', 'QUEUED', 'META_REJECTED', 'META_RECATEGORISED'].includes(
                    p.status
                ) && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy}
                        onClick={() => setConfirmWithdraw(true)}
                    >
                        <Trash className="me-1 size-3.5" /> {t('actions.withdraw')}
                    </MyButton>
                )}
            </div>
            <ConfirmDialog
                open={confirmWithdraw}
                onOpenChange={setConfirmWithdraw}
                title={tTpl('confirm.withdrawTitle')}
                description={tTpl('confirm.withdrawText')}
                confirmLabel={t('actions.withdraw')}
                cancelLabel={tTpl('confirm.keep')}
                onConfirm={() => mutations.withdraw.mutate({ id: p.id, engineId })}
            />
        </div>
    );
}

/** "en_US" → "English (United States)" in the admin's language; the code itself if unknown. */
function languageName(code: string): string {
    try {
        const names = new Intl.DisplayNames([document.documentElement.lang || 'en'], {
            type: 'language',
        });
        return names.of(code.replace('_', '-')) ?? code;
    } catch {
        return code;
    }
}

function EditTemplateDialog({
    proposal,
    onClose,
    onSave,
    saving,
}: {
    proposal: EngagementTemplateProposal;
    engineId: string;
    onClose: () => void;
    onSave: (payload: TemplateEditRequest) => void;
    saving: boolean;
}) {
    const { t } = useTranslation('engagementEnginesTemplateNegotiation');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const [body, setBody] = useState(proposal.proposedBody);
    const [category, setCategory] = useState<TemplateCategory>(proposal.proposedCategory);
    const { t: tTpl } = useTranslation('engagementEnginesTemplates');
    const [pairs, setPairs] = useState<{ name: string; sample: string; source: string }[]>(() => {
        const names = safeParse<string[]>(proposal.variableNames, []);
        const samples = safeParse<string[]>(proposal.sampleValues, []);
        const sources = safeParse<Record<string, string>>(proposal.variableSources, {});
        return names.map((n, i) => ({ name: n, sample: samples[i] ?? '', source: sources[n] ?? '' }));
    });
    const [purpose, setPurpose] = useState(proposal.purpose ?? '');
    const [headerType, setHeaderType] = useState<TemplateHeaderType>(proposal.headerType ?? 'NONE');
    const [headerText, setHeaderText] = useState(proposal.headerText ?? '');
    const [headerMediaUrl, setHeaderMediaUrl] = useState(proposal.headerMediaUrl ?? '');
    const [buttons, setButtons] = useState<TemplateButton[]>(() => safeParse<TemplateButton[]>(proposal.buttons, []));
    const promoWarning = category === 'UTILITY' && PROMO.test(body);
    const updateButton = (i: number, patch: Partial<TemplateButton>) =>
        setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
    const [footer, setFooter] = useState(proposal.footerText ?? '');

    // Mirror the backend's alignmentProblem() EXACTLY so the FE never enables Save for a body the
    // server will reject, nor blocks a valid one: distinct indices, no {{0}}, contiguous 1..k, and
    // exactly k variable rows (k = max index; a repeated {{1}} counts once). Plus the 1024 body cap.
    const problem = ((): string | null => {
        if (!body.trim()) return t('editDialog.errors.bodyEmpty');
        if (body.length > 1024) return t('editDialog.errors.bodyTooLong');
        const nums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((mm) => Number(mm[1]));
        const distinct = Array.from(new Set(nums)).sort((a, b) => a - b);
        if (distinct.length && distinct[0]! < 1) {
            return t('editDialog.errors.placeholderZero', { p1: '{{1}}', p0: '{{0}}' });
        }
        const k = distinct.length ? distinct[distinct.length - 1]! : 0;
        for (let i = 1; i <= k; i++) {
            if (!distinct.includes(i)) {
                return t('editDialog.errors.placeholderMissing', { placeholder: `{{${i}}}` });
            }
        }
        if (pairs.length !== k) {
            return t('editDialog.errors.variableRowMismatch', {
                variables: t('editDialog.errors.variableCount', { count: k }),
                rows: t('editDialog.errors.rowCount', { count: pairs.length }),
            });
        }
        // Sources are all-or-nothing: either every variable says where its value comes from, or none yet.
        const withSource = pairs.filter((p) => p.source.trim());
        if (withSource.length > 0) {
            const incomplete = pairs.find((p) => !isCompleteSource(p.source));
            if (incomplete) return tTpl('edit.errors.noSource', { name: incomplete.name || '?' });
        }
        return null;
    })();
    const misaligned = problem !== null;

    const save = () =>
        onSave({
            body,
            category,
            variableNames: pairs.map((p) => p.name.trim()),
            sampleValues: pairs.map((p) => p.sample.trim()),
            // "" clears the footer; undefined would mean "keep the current one" to the backend.
            footerText: footer.trim(),
            purpose: purpose.trim() || undefined,
            headerType,
            headerText: headerType === 'TEXT' ? headerText.trim() : '',
            headerMediaUrl: headerType !== 'NONE' && headerType !== 'TEXT' ? headerMediaUrl.trim() : '',
            buttons: buttons.map((b) => ({
                type: b.type,
                text: b.text.trim(),
                url: b.type === 'URL' ? b.url?.trim() : undefined,
                phoneNumber: b.type === 'PHONE_NUMBER' ? b.phoneNumber?.trim() : undefined,
            })),
            variableSources: pairs.some((p) => p.source.trim())
                ? Object.fromEntries(pairs.map((p) => [p.name.trim(), p.source.trim()]))
                : undefined,
        });

    return (
        <MyDialog
            heading={t('editDialog.heading')}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-xl"
        >
            <div className="flex flex-col gap-4 overflow-y-auto p-1">
                {NEW_VERSION_ON_EDIT.has(proposal.status) && (
                    <p className="rounded-lg bg-info-50 p-2 text-caption text-info-700">{tTpl('whatsapp.newVersionNote')}</p>
                )}
                <div>
                    <label className="mb-1 block text-caption text-neutral-500">
                        {t('editDialog.bodyLabel', { p1: '{{1}}', p2: '{{2}}' })}
                    </label>
                    <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                    <p
                        className={cn(
                            'mt-1 text-end tabular-nums',
                            body.length > 1024 ? 'text-danger-600' : 'text-neutral-400'
                        )}
                    >
                        <span className="text-caption">
                            {t('editDialog.charCount', { count: body.length })}
                        </span>
                    </p>
                </div>
                <div className="w-48">
                    <label className="mb-1 block text-caption text-neutral-500">
                        {t('editDialog.categoryLabel')}
                    </label>
                    <Select value={category} onValueChange={(v) => setCategory(v as TemplateCategory)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildTemplateCategoryOptions(tConstants).map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {promoWarning && (
                    <p className="rounded-lg bg-warning-50 p-2 text-caption text-warning-700">{tTpl('whatsapp.promoWarning')}</p>
                )}
                <div className="flex flex-col gap-2">
                    <label className="text-caption text-neutral-500">
                        {t('editDialog.variablesLabel', { n: '{{n}}' })}
                    </label>
                    {pairs.map((pair, i) => (
                        <div key={i} className="flex flex-col gap-2 rounded-lg border border-neutral-100 p-2">
                        <div className="flex items-center gap-2">
                            <span className="w-8 font-mono text-caption text-neutral-400">
                                {`{{${i + 1}}}`}
                            </span>
                            <Input
                                value={pair.name}
                                placeholder={t('editDialog.namePlaceholder')}
                                onChange={(e) =>
                                    setPairs((prev) =>
                                        prev.map((p, idx) => (idx === i ? { ...p, name: e.target.value } : p))
                                    )
                                }
                            />
                            <Input
                                value={pair.sample}
                                placeholder={t('editDialog.samplePlaceholder')}
                                onChange={(e) =>
                                    setPairs((prev) =>
                                        prev.map((p, idx) =>
                                            idx === i ? { ...p, sample: e.target.value } : p
                                        )
                                    )
                                }
                            />
                            <button
                                type="button"
                                aria-label={t('editDialog.removeVariable')}
                                className="text-neutral-400 hover:text-danger-600"
                                onClick={() => setPairs((prev) => prev.filter((_, idx) => idx !== i))}
                            >
                                <Trash className="size-4" />
                            </button>
                        </div>
                        <VariableSourceField
                            variable={pair.name}
                            value={pair.source}
                            onChange={(source) =>
                                setPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, source } : p)))
                            }
                        />
                        </div>
                    ))}
                    <button
                        type="button"
                        className="w-fit text-caption text-primary-600"
                        onClick={() => setPairs((prev) => [...prev, { name: '', sample: '', source: '' }])}
                    >
                        {t('editDialog.addVariable')}
                    </button>
                    {problem && <p className="text-caption text-danger-600">{problem}</p>}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">{tTpl('whatsapp.headerLabel')}</label>
                        <Select value={headerType} onValueChange={(v) => setHeaderType(v as TemplateHeaderType)}>
                            <SelectTrigger aria-label={tTpl('whatsapp.headerLabel')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {HEADER_TYPES.map((h) => (
                                    <SelectItem key={h} value={h}>
                                        {tTpl(`whatsapp.headerTypes.${h}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {headerType === 'TEXT' && (
                        <div className="sm:col-span-2">
                            <label className="mb-1 block text-caption text-neutral-500">{tTpl('whatsapp.headerText')}</label>
                            <Input value={headerText} maxLength={60} onChange={(e) => setHeaderText(e.target.value)} />
                        </div>
                    )}
                    {headerType !== 'NONE' && headerType !== 'TEXT' && (
                        <div className="sm:col-span-2">
                            <label className="mb-1 block text-caption text-neutral-500">
                                {tTpl(`whatsapp.headerFile.${headerType}`)}
                            </label>
                            <Input
                                value={headerMediaUrl}
                                placeholder="https://"
                                onChange={(e) => setHeaderMediaUrl(e.target.value)}
                            />
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-caption text-neutral-500">{tTpl('whatsapp.buttonsLabel')}</label>
                    {buttons.map((b, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                            <Select
                                value={b.type}
                                onValueChange={(v) => updateButton(i, { type: v as TemplateButton['type'] })}
                            >
                                <SelectTrigger className="w-40" aria-label={tTpl('whatsapp.buttonsLabel')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {BUTTON_TYPES.map((bt) => (
                                        <SelectItem key={bt} value={bt}>
                                            {tTpl(`whatsapp.buttonTypes.${bt}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Input
                                className="w-40"
                                value={b.text}
                                maxLength={25}
                                placeholder={tTpl('whatsapp.buttonText')}
                                onChange={(e) => updateButton(i, { text: e.target.value })}
                            />
                            {b.type === 'URL' && (
                                <Input
                                    className="min-w-0 flex-1"
                                    value={b.url ?? ''}
                                    placeholder={tTpl('whatsapp.buttonUrl')}
                                    onChange={(e) => updateButton(i, { url: e.target.value })}
                                />
                            )}
                            {b.type === 'PHONE_NUMBER' && (
                                <Input
                                    className="min-w-0 flex-1"
                                    value={b.phoneNumber ?? ''}
                                    placeholder="+91…"
                                    onChange={(e) => updateButton(i, { phoneNumber: e.target.value })}
                                />
                            )}
                            <button
                                type="button"
                                aria-label={tTpl('whatsapp.removeButton')}
                                className="text-neutral-400 hover:text-danger-600"
                                onClick={() => setButtons((prev) => prev.filter((_, idx) => idx !== i))}
                            >
                                <Trash className="size-4" />
                            </button>
                        </div>
                    ))}
                    {buttons.length < 10 && (
                        <button
                            type="button"
                            className="w-fit text-caption text-primary-600"
                            onClick={() => setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: '' }])}
                        >
                            {tTpl('whatsapp.addButton')}
                        </button>
                    )}
                </div>
                <div>
                    <label className="mb-1 block text-caption text-neutral-500">
                        {tTpl('edit.purpose')}
                    </label>
                    <Input value={purpose} maxLength={120} onChange={(e) => setPurpose(e.target.value)} />
                </div>
                <div>
                    <label className="mb-1 block text-caption text-neutral-500">
                        {t('editDialog.footerLabel')}
                    </label>
                    <Input
                        value={footer}
                        maxLength={60}
                        onChange={(e) => setFooter(e.target.value)}
                    />
                </div>
                <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
                    <MyButton buttonType="secondary" scale="small" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={saving || misaligned || !body.trim()}
                        onClick={save}
                    >
                        {saving ? t('editDialog.saving') : t('editDialog.saveChanges')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
