import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    BatchPickerDialog,
    type BatchOption,
} from '@/routes/engagement/-components/BatchPickerDialog';
import { TopicPicker, toSelectedNodeIds } from '../paper/TopicPicker';
import { useKbTopics, useSaveCompanion } from '../../-hooks/companion';
import { companionErrorMessage } from '../../-services/companion-service';
import type { KbTopic } from '../../-types/paper';
import type {
    Companion,
    CompanionLanguage,
    CompanionMode,
    CompanionPayload,
    CompanionTargetInput,
} from '../../-types/companion';
import {
    COMPANION_COLORS,
    COMPANION_EMOJIS,
    DEFAULT_COLOR,
    DEFAULT_DAILY_CAP,
    DEFAULT_EMOJI,
    toDateInput,
} from './companion-constants';
import { LearnerSearchPicker, type LearnerOption } from './LearnerSearchPicker';

const MODES: CompanionMode[] = ['learn', 'practice', 'ask'];

/** Expand saved scope ids to the picker's leaf ids (a topic id means all its subtopics). */
const leafIdsFromScope = (topics: KbTopic[], scope: string[]): Set<string> => {
    const wanted = new Set(scope);
    const out = new Set<string>();
    topics.forEach((topic) => {
        const subs = topic.subtopics ?? [];
        if (wanted.has(topic.id)) {
            if (subs.length) subs.forEach((s) => out.add(s.id));
            else out.add(topic.id);
            return;
        }
        subs.forEach((s) => wanted.has(s.id) && out.add(s.id));
    });
    return out;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3 border-b border-neutral-100 pb-5 last:border-b-0 last:pb-0">
            <div>
                <p className="text-subtitle font-semibold text-neutral-700">{title}</p>
                {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function Chip({
    label,
    onRemove,
    removeLabel,
}: {
    label: string;
    onRemove: () => void;
    removeLabel: string;
}) {
    return (
        <span className="flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-caption text-primary-700">
            {label}
            <button
                type="button"
                onClick={onRemove}
                aria-label={removeLabel}
                className="rounded hover:bg-primary-100"
            >
                <X className="size-3" />
            </button>
        </span>
    );
}

interface CompanionFormDialogProps {
    kbId: string;
    kbName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present when editing. */
    companion?: Companion | null;
}

export function CompanionFormDialog({
    kbId,
    kbName,
    open,
    onOpenChange,
    companion,
}: CompanionFormDialogProps) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const save = useSaveCompanion(kbId);
    const { data: topics, isLoading: topicsLoading } = useKbTopics(kbId, open);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
    const [color, setColor] = useState(DEFAULT_COLOR);
    const [persona, setPersona] = useState('');
    const [language, setLanguage] = useState<CompanionLanguage>('en');
    const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
    const [modes, setModes] = useState<Set<CompanionMode>>(new Set(MODES));
    const [audience, setAudience] = useState<'institute' | 'specific'>('institute');
    const [batches, setBatches] = useState<BatchOption[]>([]);
    const [learners, setLearners] = useState<LearnerOption[]>([]);
    const [batchPickerOpen, setBatchPickerOpen] = useState(false);
    const [showOnDashboard, setShowOnDashboard] = useState(true);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [dailyCap, setDailyCap] = useState(String(DEFAULT_DAILY_CAP));
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [active, setActive] = useState(true);
    const [scopeSeeded, setScopeSeeded] = useState(false);

    // Re-seed each time the dialog opens so Cancel discards and Edit shows the saved row.
    useEffect(() => {
        if (!open) return;
        const c = companion;
        setName(c?.name ?? t('form.defaultName', { kb: kbName }));
        setDescription(c?.description ?? '');
        setEmoji(c?.avatar_emoji || DEFAULT_EMOJI);
        setColor(c?.accent_color || DEFAULT_COLOR);
        setPersona(c?.persona ?? '');
        setLanguage(c?.language ?? 'en');
        setModes(new Set(c?.modes?.length ? c.modes : MODES));
        const assignments = c?.assignments ?? [];
        const specific = Boolean(c) && !assignments.some((a) => a.target_type === 'INSTITUTE');
        setAudience(specific ? 'specific' : 'institute');
        setBatches(
            assignments
                .filter((a) => a.target_type === 'BATCH' && a.target_id)
                .map((a) => ({
                    id: a.target_id as string,
                    label: a.label || t('form.who.unnamedBatch'),
                }))
        );
        setLearners(
            assignments
                .filter((a) => a.target_type === 'LEARNER' && a.target_id)
                .map((a) => ({
                    id: a.target_id as string,
                    label: a.label || t('form.who.unnamedStudent'),
                }))
        );
        setShowOnDashboard(c?.show_on_dashboard ?? true);
        setVoiceEnabled(c?.voice_enabled ?? true);
        setDailyCap(String(c?.daily_question_cap ?? DEFAULT_DAILY_CAP));
        setStartsAt(toDateInput(c?.starts_at));
        setEndsAt(toDateInput(c?.ends_at));
        setActive((c?.status ?? 'ACTIVE') === 'ACTIVE');
        setSelectedLeafIds(new Set());
        setScopeSeeded(false);
        // Only on open: a background refetch of the list must not wipe edits in progress.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Scope needs the topic tree to expand topic ids into their subtopics.
    useEffect(() => {
        if (!open || scopeSeeded || !topics) return;
        setSelectedLeafIds(leafIdsFromScope(topics, companion?.scope_node_ids ?? []));
        setScopeSeeded(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, scopeSeeded, topics]);

    const scopeIds = useMemo(
        () => toSelectedNodeIds(topics ?? [], selectedLeafIds),
        [topics, selectedLeafIds]
    );
    const wholeKb = selectedLeafIds.size === 0;

    const toggleMode = (mode: CompanionMode, on: boolean) =>
        setModes((prev) => {
            const next = new Set(prev);
            if (on) next.add(mode);
            else next.delete(mode);
            return next;
        });

    const cap = Number(dailyCap);
    const errors = {
        name: name.trim() ? null : t('form.errors.name'),
        modes: modes.size ? null : t('form.errors.modes'),
        audience:
            audience === 'specific' && batches.length + learners.length === 0
                ? t('form.errors.audience')
                : null,
        cap:
            dailyCap.trim() === '' || !Number.isInteger(cap) || cap < 0 || cap > 500
                ? t('form.errors.cap')
                : null,
        dates: startsAt && endsAt && endsAt < startsAt ? t('form.errors.dates') : null,
    };
    const invalid = Object.values(errors).some(Boolean);
    const [showErrors, setShowErrors] = useState(false);
    useEffect(() => setShowErrors(false), [open]);

    const submit = async () => {
        if (invalid) {
            setShowErrors(true);
            return;
        }
        const assignments: CompanionTargetInput[] =
            audience === 'institute'
                ? [{ target_type: 'INSTITUTE' }]
                : [
                      ...batches.map((b) => ({ target_type: 'BATCH' as const, target_id: b.id })),
                      ...learners.map((l) => ({
                          target_type: 'LEARNER' as const,
                          target_id: l.id,
                      })),
                  ];
        const payload: CompanionPayload = {
            name: name.trim(),
            description: description.trim() || null,
            avatar_emoji: emoji,
            accent_color: color,
            persona: persona.trim() || null,
            language,
            modes: MODES.filter((m) => modes.has(m)),
            // If the topic tree never loaded, leave an edited scope untouched rather
            // than silently widening it to the whole book.
            scope_node_ids: scopeSeeded ? (wholeKb ? [] : scopeIds) : companion ? undefined : [],
            voice_enabled: voiceEnabled,
            show_on_dashboard: showOnDashboard,
            daily_question_cap: cap,
            status: active ? 'ACTIVE' : 'PAUSED',
            starts_at: startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : null,
            ends_at: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
            assignments,
        };
        try {
            const saved = await save.mutateAsync({ companionId: companion?.id, payload });
            toast.success(
                companion
                    ? t('toast.updated', { name: saved.name })
                    : t('toast.created', { name: saved.name })
            );
            onOpenChange(false);
        } catch (error) {
            toast.error(companionErrorMessage(error) ?? t('toast.saveFailed'));
        }
    };

    const fieldError = (msg: string | null) =>
        showErrors && msg ? <p className="text-caption text-danger-600">{msg}</p> : null;

    return (
        <>
            <MyDialog
                heading={companion ? t('form.editHeading') : t('form.createHeading')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-3xl"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => onOpenChange(false)}
                            disable={save.isPending}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={submit}
                            disable={save.isPending}
                        >
                            {save.isPending
                                ? t('actions.saving')
                                : companion
                                  ? t('actions.saveChanges')
                                  : t('actions.create')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-5">
                    <Section title={t('form.basics.title')}>
                        <div className="flex flex-col gap-1">
                            <MyInput
                                label={t('form.basics.name')}
                                required
                                inputType="text"
                                input={name}
                                onChangeFunction={(e) => setName(e.target.value)}
                                className="w-full sm:w-full"
                            />
                            {fieldError(errors.name)}
                        </div>
                        <MyInput
                            label={t('form.basics.description')}
                            inputType="text"
                            input={description}
                            onChangeFunction={(e) => setDescription(e.target.value)}
                            inputPlaceholder={t('form.basics.descriptionPlaceholder')}
                            className="w-full sm:w-full"
                        />

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-2">
                                <Label className="text-caption text-neutral-600">
                                    {t('form.basics.avatar')}
                                </Label>
                                <div className="grid grid-cols-8 gap-1">
                                    {COMPANION_EMOJIS.map((e) => (
                                        <button
                                            key={e}
                                            type="button"
                                            onClick={() => setEmoji(e)}
                                            aria-pressed={emoji === e}
                                            className={cn(
                                                'flex size-9 items-center justify-center rounded-md border text-h3',
                                                emoji === e
                                                    ? 'border-primary-500 bg-primary-50'
                                                    : 'border-neutral-200 hover:bg-neutral-50'
                                            )}
                                        >
                                            {e}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-caption text-neutral-600">
                                    {t('form.basics.color')}
                                </Label>
                                <div className="flex flex-wrap gap-2">
                                    {COMPANION_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setColor(c)}
                                            aria-label={c}
                                            aria-pressed={color === c}
                                            className={cn(
                                                'flex size-8 items-center justify-center rounded-full ring-offset-2',
                                                color === c && 'ring-2 ring-neutral-400'
                                            )}
                                            // Dynamic user-chosen colour; no token can express it.
                                            style={{ backgroundColor: c }}
                                        >
                                            {color === c && (
                                                <Check
                                                    weight="bold"
                                                    className="size-4 text-white"
                                                />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <Label className="text-caption text-neutral-600">
                                {t('form.basics.persona')}
                            </Label>
                            <Textarea
                                value={persona}
                                onChange={(e) => setPersona(e.target.value)}
                                placeholder={t('form.basics.personaPlaceholder')}
                                maxLength={1000}
                                rows={3}
                            />
                            <p className="text-caption text-neutral-500">
                                {t('form.basics.personaHint')}
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label className="text-caption text-neutral-600">
                                {t('form.basics.language')}
                            </Label>
                            <RadioGroup
                                value={language}
                                onValueChange={(v) => setLanguage(v as CompanionLanguage)}
                                className="flex gap-4"
                            >
                                {(['en', 'hi', 'kn'] as const).map((lang) => (
                                    <label key={lang} className="flex items-center gap-2 text-body">
                                        <RadioGroupItem value={lang} />
                                        {t(`form.basics.languages.${lang}`)}
                                    </label>
                                ))}
                            </RadioGroup>
                        </div>
                    </Section>

                    <Section title={t('form.scope.title')} hint={t('form.scope.hint')}>
                        {topicsLoading && <Skeleton className="h-32 w-full rounded-md" />}
                        {!topicsLoading && (topics?.length ?? 0) === 0 && (
                            <p className="text-caption text-neutral-500">
                                {t('form.scope.noTopics')}
                            </p>
                        )}
                        {!topicsLoading && (topics?.length ?? 0) > 0 && (
                            <>
                                <p
                                    className={cn(
                                        'text-caption',
                                        wholeKb ? 'text-primary-500' : 'text-neutral-500'
                                    )}
                                >
                                    {wholeKb ? t('form.scope.whole') : t('form.scope.some')}
                                </p>
                                <TopicPicker
                                    topics={topics ?? []}
                                    selectedLeafIds={selectedLeafIds}
                                    onChange={setSelectedLeafIds}
                                    toolbar
                                />
                            </>
                        )}
                    </Section>

                    <Section title={t('form.modes.title')}>
                        <div className="flex flex-col gap-2">
                            {MODES.map((mode) => (
                                <label key={mode} className="flex cursor-pointer items-start gap-2">
                                    <Checkbox
                                        checked={modes.has(mode)}
                                        onCheckedChange={(on) => toggleMode(mode, Boolean(on))}
                                        className="mt-0.5"
                                    />
                                    <span>
                                        <span className="block text-body text-neutral-700">
                                            {t(`form.modes.${mode}.label`)}
                                        </span>
                                        <span className="block text-caption text-neutral-500">
                                            {t(`form.modes.${mode}.hint`)}
                                        </span>
                                    </span>
                                </label>
                            ))}
                            {fieldError(errors.modes)}
                        </div>
                    </Section>

                    <Section title={t('form.who.title')}>
                        <RadioGroup
                            value={audience}
                            onValueChange={(v) => setAudience(v as 'institute' | 'specific')}
                            className="flex flex-col gap-2"
                        >
                            <label className="flex items-center gap-2 text-body">
                                <RadioGroupItem value="institute" />
                                {t('form.who.institute')}
                            </label>
                            <label className="flex items-center gap-2 text-body">
                                <RadioGroupItem value="specific" />
                                {t('form.who.specific')}
                            </label>
                        </RadioGroup>

                        {audience === 'specific' && (
                            <div className="flex flex-col gap-4 rounded-md border border-neutral-200 p-3">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-body font-medium text-neutral-700">
                                            {t('form.who.batches')}
                                        </p>
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() => setBatchPickerOpen(true)}
                                        >
                                            <Plus className="me-1 size-4" />
                                            {t('form.who.chooseBatches')}
                                        </MyButton>
                                    </div>
                                    {batches.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {batches.map((b) => (
                                                <Chip
                                                    key={b.id}
                                                    label={b.label}
                                                    removeLabel={t('form.who.remove', {
                                                        name: b.label,
                                                    })}
                                                    onRemove={() =>
                                                        setBatches((prev) =>
                                                            prev.filter((x) => x.id !== b.id)
                                                        )
                                                    }
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-caption text-neutral-500">
                                            {t('form.who.noBatches')}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2">
                                    <p className="text-body font-medium text-neutral-700">
                                        {t('form.who.students')}
                                    </p>
                                    {learners.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {learners.map((l) => (
                                                <Chip
                                                    key={l.id}
                                                    label={l.label}
                                                    removeLabel={t('form.who.remove', {
                                                        name: l.label,
                                                    })}
                                                    onRemove={() =>
                                                        setLearners((prev) =>
                                                            prev.filter((x) => x.id !== l.id)
                                                        )
                                                    }
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <LearnerSearchPicker
                                        selected={learners}
                                        onAdd={(l) => setLearners((prev) => [...prev, l])}
                                    />
                                </div>
                                {fieldError(errors.audience)}
                            </div>
                        )}
                    </Section>

                    <Section title={t('form.display.title')}>
                        <label className="flex items-center justify-between gap-3">
                            <span>
                                <span className="block text-body text-neutral-700">
                                    {t('form.display.dashboard')}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {t('form.display.dashboardHint')}
                                </span>
                            </span>
                            <Switch
                                checked={showOnDashboard}
                                onCheckedChange={setShowOnDashboard}
                            />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                            <span>
                                <span className="block text-body text-neutral-700">
                                    {t('form.display.voice')}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {t('form.display.voiceHint')}
                                </span>
                            </span>
                            <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                            <span>
                                <span className="block text-body text-neutral-700">
                                    {t('form.display.active')}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {t('form.display.activeHint')}
                                </span>
                            </span>
                            <Switch checked={active} onCheckedChange={setActive} />
                        </label>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="flex flex-col gap-1">
                                <Label className="text-caption text-neutral-600">
                                    {t('form.display.cap')}
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={500}
                                    value={dailyCap}
                                    onChange={(e) => setDailyCap(e.target.value)}
                                />
                                <p className="text-caption text-neutral-500">
                                    {t('form.display.capHint')}
                                </p>
                                {fieldError(errors.cap)}
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label className="text-caption text-neutral-600">
                                    {t('form.display.startsAt')}
                                </Label>
                                <Input
                                    type="date"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label className="text-caption text-neutral-600">
                                    {t('form.display.endsAt')}
                                </Label>
                                <Input
                                    type="date"
                                    value={endsAt}
                                    onChange={(e) => setEndsAt(e.target.value)}
                                />
                                {fieldError(errors.dates)}
                            </div>
                        </div>
                        <p className="text-caption text-neutral-500">
                            {t('form.display.windowHint')}
                        </p>
                    </Section>
                </div>
            </MyDialog>

            <BatchPickerDialog
                open={batchPickerOpen}
                onOpenChange={setBatchPickerOpen}
                selected={batches}
                onConfirm={setBatches}
            />
        </>
    );
}
