import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import {
    ArrowCounterClockwise,
    Check,
    UploadSimple,
    User as UserIcon,
    UsersThree,
} from '@phosphor-icons/react';
import type {
    CastGateCharacter,
    CastVoiceOption,
    DecisionAnswer,
    DecisionRequest,
} from '../../../-services/video-generation';

interface CastDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

interface CharState {
    /** Uploaded replacement portrait. */
    url?: string;
    /** Redo-with-note toggle + text. */
    redo?: boolean;
    note?: string;
    /** Voice the user picked ('' = auto); undefined = untouched. */
    voiceId?: string;
}

const voiceSelectCls =
    'h-7 w-full rounded-md border bg-background px-1.5 text-xs text-foreground outline-none focus:border-violet-500';

/**
 * Narrow the voice list to the character's likely gender when the voice_hint
 * makes it inferable ("warm female voice" → female list). Checks female terms
 * first — 'female' contains 'male'. Falls back to the full list.
 */
function voicesForHint(options: CastVoiceOption[], hint?: string): CastVoiceOption[] {
    const h = (hint ?? '').toLowerCase();
    let gender: 'male' | 'female' | null = null;
    if (/female|woman/.test(h)) gender = 'female';
    else if (/\b(male|man)\b/.test(h)) gender = 'male';
    if (!gender) return options;
    const filtered = options.filter((o) => o.gender === gender);
    return filtered.length > 0 ? filtered : options;
}

/**
 * Cast gate — approve the characters' portraits BEFORE any dialogue clip is
 * filmed. A wrong face here multiplies across every scene (and every clip
 * costs real money), so this is the cheapest moment to fix it: keep, upload
 * your own image (your mascot, a real person), or regenerate with a note.
 */
export function CastDecision({ decision, isSubmitting, onSubmit }: CastDecisionProps) {
    const { t } = useTranslation('videoApiStudioCastDecision');
    const characters = useMemo<CastGateCharacter[]>(() => {
        const raw = (decision.payload?.characters as CastGateCharacter[]) ?? [];
        return Array.isArray(raw) ? raw.filter((c) => c && c.name) : [];
    }, [decision.payload]);

    // Selectable dialogue voices — absent on non-dialogue runs (render nothing).
    const voiceOptions = useMemo<CastVoiceOption[]>(() => {
        const raw = (decision.payload?.voice_options as CastVoiceOption[]) ?? [];
        return Array.isArray(raw) ? raw.filter((o) => o && o.voice_id) : [];
    }, [decision.payload]);

    const [state, setState] = useState<Record<string, CharState>>({});
    const [uploadingFor, setUploadingFor] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const pendingUploadFor = useRef<string | null>(null);
    const { uploadFile, getPublicUrl } = useFileUpload();

    const patch = (name: string, p: CharState) =>
        setState((prev) => ({ ...prev, [name]: { ...prev[name], ...p } }));

    const startUpload = (name: string) => {
        pendingUploadFor.current = name;
        fileInputRef.current?.click();
    };

    const onFilePicked = async (file: File | null) => {
        const name = pendingUploadFor.current;
        pendingUploadFor.current = null;
        if (!file || !name) return;
        setUploadingFor(name);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'AI_INPUT_IMAGE',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            const url = fileId ? await getPublicUrl(fileId) : null;
            if (!url) throw new Error('Upload failed');
            patch(name, { url, redo: false, note: undefined });
        } catch {
            toast.error(t('toast.uploadFailed'));
        } finally {
            setUploadingFor(null);
        }
    };

    /** True when the user picked a voice different from the character's current one. */
    const voiceChanged = (c: CastGateCharacter, st: CharState): boolean =>
        !!st.voiceId && st.voiceId !== (c.voice_id ?? '');

    const changes = characters.filter((c) => {
        const st = state[c.name] ?? {};
        return st.url || (st.redo && st.note?.trim()) || voiceChanged(c, st);
    }).length;
    const hasEmptyRedoNote = characters.some((c) => {
        const st = state[c.name] ?? {};
        return st.redo && !st.note?.trim() && !st.url;
    });

    const submit = () => {
        if (changes === 0) {
            onSubmit({ kind: 'accept_recommended' });
            return;
        }
        const edits: Array<{ name: string; url?: string; regen_note?: string; voice_id?: string }> =
            [];
        for (const c of characters) {
            const st = state[c.name] ?? {};
            const entry: { name: string; url?: string; regen_note?: string; voice_id?: string } = {
                name: c.name,
            };
            if (st.url) entry.url = st.url;
            else if (st.redo && st.note?.trim()) entry.regen_note = st.note.trim();
            if (st.voiceId && voiceChanged(c, st)) entry.voice_id = st.voiceId;
            if (entry.url || entry.regen_note || entry.voice_id) edits.push(entry);
        }
        onSubmit({ kind: 'edit', gate_type: 'cast', characters: edits });
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <UsersThree className="size-4 text-violet-600" />
                </span>
                {t('header.title', { count: characters.length })}
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2">
                {characters.map((c) => {
                    const st = state[c.name] ?? {};
                    const shownUrl = st.url ?? c.sheet_url ?? null;
                    const edited = !!(
                        st.url ||
                        (st.redo && st.note?.trim()) ||
                        voiceChanged(c, st)
                    );
                    const charVoices = voicesForHint(voiceOptions, c.voice_hint);
                    // The assigned voice must stay selectable even when the
                    // gender filter (or a stale option list) excludes it.
                    const missingCurrent =
                        !!c.voice_id && !charVoices.some((o) => o.voice_id === c.voice_id);
                    return (
                        <div
                            key={c.name}
                            className={cn(
                                'overflow-hidden rounded-lg border',
                                edited && 'border-violet-500 ring-1 ring-violet-500'
                            )}
                        >
                            {shownUrl ? (
                                <img
                                    src={shownUrl}
                                    alt={c.name}
                                    className="aspect-square w-full bg-muted object-cover object-top"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="flex aspect-square w-full items-center justify-center bg-muted">
                                    <UserIcon className="size-8 text-muted-foreground/40" />
                                </div>
                            )}
                            <div className="space-y-1.5 p-2.5">
                                <p className="text-sm font-medium text-foreground">
                                    {c.name}
                                    {c.voice_hint ? (
                                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                                            · {c.voice_hint}
                                        </span>
                                    ) : null}
                                </p>
                                {voiceOptions.length > 0 && (
                                    <select
                                        value={st.voiceId ?? c.voice_id ?? ''}
                                        disabled={isSubmitting}
                                        onChange={(e) =>
                                            patch(c.name, { voiceId: e.target.value })
                                        }
                                        className={voiceSelectCls}
                                        aria-label={t('voice.ariaLabel', { name: c.name })}
                                    >
                                        {!c.voice_id && (
                                            <option value="">{t('voice.autoOption')}</option>
                                        )}
                                        {missingCurrent && (
                                            <option value={c.voice_id ?? ''}>
                                                {voiceOptions.find(
                                                    (o) => o.voice_id === c.voice_id
                                                )?.label ?? c.voice_id}
                                            </option>
                                        )}
                                        {charVoices.map((o) => (
                                            <option key={o.voice_id} value={o.voice_id}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {c.visual_description ? (
                                    <p className="line-clamp-2 text-xs text-muted-foreground">
                                        {c.visual_description}
                                    </p>
                                ) : null}
                                <div className="flex gap-1.5 pt-0.5">
                                    <Button
                                        variant={st.redo ? 'secondary' : 'ghost'}
                                        size="sm"
                                        disabled={isSubmitting}
                                        onClick={() =>
                                            patch(c.name, { redo: !st.redo, url: undefined })
                                        }
                                        className="h-6 gap-1 px-1.5 text-xs"
                                    >
                                        <ArrowCounterClockwise className="size-3" />
                                        {t('redo.button')}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={isSubmitting || uploadingFor === c.name}
                                        onClick={() => startUpload(c.name)}
                                        className="h-6 gap-1 px-1.5 text-xs"
                                    >
                                        <UploadSimple className="size-3" />
                                        {uploadingFor === c.name
                                            ? t('upload.uploading')
                                            : st.url
                                              ? t('upload.replace')
                                              : t('upload.useMyImage')}
                                    </Button>
                                </div>
                                {st.redo && !st.url && (
                                    <Textarea
                                        value={st.note ?? ''}
                                        disabled={isSubmitting}
                                        onChange={(e) => patch(c.name, { note: e.target.value })}
                                        placeholder={t('redo.placeholder')}
                                        className="min-h-14 text-xs"
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                    {changes > 0
                        ? t('footer.changesSummary', { count: changes })
                        : t('footer.noChanges')}
                </span>
                <Button
                    size="sm"
                    disabled={isSubmitting || uploadingFor !== null || hasEmptyRedoNote}
                    onClick={submit}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {changes > 0
                        ? t('footer.submitWithChanges', { count: changes })
                        : t('footer.submitDefault')}
                </Button>
            </div>
        </div>
    );
}
