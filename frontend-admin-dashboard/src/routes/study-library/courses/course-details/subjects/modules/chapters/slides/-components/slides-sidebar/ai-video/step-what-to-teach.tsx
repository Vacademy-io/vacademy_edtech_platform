import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CircleNotch,
    FilePdf,
    FileText,
    FilmSlate,
    Sparkle,
    UploadSimple,
    VideoCamera,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { LANGUAGES } from '@/routes/video-api-studio/-services/video-generation';
import { toast } from 'sonner';
import {
    AUDIENCE_MAX,
    DEFAULT_LANGUAGE,
    MAX_REFERENCE_FILES,
    NOTES_MAX,
    OBJECTIVES_MAX,
    TOPIC_MAX,
    type AiVideoFormState,
    type FieldError,
    type SourceSlideKind,
    type SourceSlideOption,
    type WhatToTeachField,
} from './ai-video-form';
import { SectionHeading } from './ai-video-ui';

const NS = 'studyLibraryAddAiVideoDialog';

const KIND_ICON: Record<SourceSlideKind, typeof FilePdf> = {
    pdf: FilePdf,
    document: FileText,
    video: VideoCamera,
    ai_video: FilmSlate,
};

const LIMITS: Record<WhatToTeachField, number> = {
    topic: TOPIC_MAX,
    objectives: OBJECTIVES_MAX,
    audience: AUDIENCE_MAX,
    notes: NOTES_MAX,
};

const isPdf = (file: File) =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export function StepWhatToTeach({
    state,
    onChange,
    errors,
    sources,
    draftCount,
    uploading,
    onUploadingChange,
}: {
    state: AiVideoFormState;
    onChange: (patch: Partial<AiVideoFormState>) => void;
    errors: Partial<Record<WhatToTeachField, FieldError>>;
    sources: SourceSlideOption[];
    draftCount: number;
    uploading: boolean;
    onUploadingChange: (uploading: boolean) => void;
}) {
    const { t } = useTranslation(NS);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [, setUploadFlag] = useState(false);

    const languageOptions = useMemo(() => {
        const seen = new Set<string>([DEFAULT_LANGUAGE]);
        const list = [{ value: DEFAULT_LANGUAGE, label: DEFAULT_LANGUAGE }];
        for (const lang of LANGUAGES) {
            if (seen.has(lang.value)) continue;
            seen.add(lang.value);
            list.push({ value: lang.value, label: lang.label });
        }
        return list;
    }, []);

    const errorText = (field: WhatToTeachField): string | undefined => {
        const code = errors[field];
        if (!code) return undefined;
        return code === 'required'
            ? t('teach.errors.required')
            : t('teach.errors.tooLong', { max: LIMITS[field] });
    };

    const toggleSource = (id: string, checked: boolean) => {
        const next = checked
            ? Array.from(new Set([...state.sourceSlideIds, id]))
            : state.sourceSlideIds.filter((s) => s !== id);
        onChange({ sourceSlideIds: next });
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        let room = MAX_REFERENCE_FILES - state.referenceFiles.length;
        const added = [...state.referenceFiles];
        onUploadingChange(true);
        try {
            for (const file of Array.from(files)) {
                if (room <= 0) {
                    toast.error(t('teach.upload.limit', { max: MAX_REFERENCE_FILES }));
                    break;
                }
                if (!isPdf(file)) {
                    toast.error(t('teach.upload.notPdf', { name: file.name }));
                    continue;
                }
                try {
                    const fileId = await UploadFileInS3(
                        file,
                        setUploadFlag,
                        getUserId(),
                        'AI_VIDEO_REFERENCE',
                        'ADMIN',
                        true
                    );
                    const url = fileId ? await getPublicUrl(fileId) : '';
                    if (!url) throw new Error('No public URL');
                    added.push({ url, name: file.name, type: 'pdf' });
                    room -= 1;
                    onChange({ referenceFiles: [...added] });
                } catch {
                    toast.error(t('teach.upload.failed', { name: file.name }));
                }
            }
        } finally {
            onUploadingChange(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeFile = (url: string) =>
        onChange({ referenceFiles: state.referenceFiles.filter((f) => f.url !== url) });

    return (
        <div className="flex flex-col gap-5">
            <MyInput
                label={t('teach.topic.label')}
                required
                input={state.topic}
                onChangeFunction={(e) => onChange({ topic: e.target.value })}
                inputPlaceholder={t('teach.topic.placeholder')}
                error={errorText('topic')}
                maxLength={TOPIC_MAX}
                className="sm:w-full"
                aria-invalid={!!errors.topic}
            />

            <div className="flex flex-col gap-1">
                <Label htmlFor="ai-video-objectives" className="text-subtitle font-regular">
                    {t('teach.objectives.label')}
                </Label>
                <Textarea
                    id="ai-video-objectives"
                    rows={2}
                    value={state.objectives}
                    maxLength={OBJECTIVES_MAX}
                    placeholder={t('teach.objectives.placeholder')}
                    onChange={(e) => onChange({ objectives: e.target.value })}
                    aria-invalid={!!errors.objectives}
                />
                {errorText('objectives') && (
                    <p className="text-xs text-danger-600">{errorText('objectives')}</p>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MyInput
                    label={t('teach.audience.label')}
                    input={state.audience}
                    onChangeFunction={(e) => onChange({ audience: e.target.value })}
                    inputPlaceholder={t('teach.audience.placeholder')}
                    error={errorText('audience')}
                    maxLength={AUDIENCE_MAX}
                    className="sm:w-full"
                />
                <div className="flex flex-col gap-1">
                    <Label className="text-subtitle font-regular">
                        {t('teach.language.label')}
                    </Label>
                    <SearchableSelect
                        options={languageOptions}
                        value={state.language}
                        onChange={(language) => onChange({ language })}
                        placeholder={t('teach.language.label')}
                        searchPlaceholder={t('teach.language.search')}
                        emptyText={t('teach.language.empty')}
                        portal={false}
                    />
                </div>
            </div>

            <section className="flex flex-col gap-2">
                <SectionHeading
                    title={t('teach.sources.title')}
                    helper={t('teach.sources.helper')}
                    action={
                        state.sourceSlideIds.length > 0 ? (
                            <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
                                {t('teach.sources.selected', {
                                    count: state.sourceSlideIds.length,
                                })}
                            </span>
                        ) : undefined
                    }
                />
                {sources.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                        {t('teach.sources.empty')}
                    </p>
                ) : (
                    <ul className="max-h-list-md divide-y divide-border overflow-y-auto rounded-md border border-border">
                        {sources.map((source) => {
                            const Icon = KIND_ICON[source.kind];
                            const checked = state.sourceSlideIds.includes(source.id);
                            const inputId = `ai-video-source-${source.id}`;
                            return (
                                <li key={source.id}>
                                    <label
                                        htmlFor={inputId}
                                        className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted"
                                    >
                                        <Checkbox
                                            id={inputId}
                                            checked={checked}
                                            onCheckedChange={(v) =>
                                                toggleSource(source.id, v === true)
                                            }
                                        />
                                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                            {source.title || t('teach.sources.untitled')}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {t(`teach.sources.kind.${source.kind}`)}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {draftCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {t('teach.sources.draftsHidden', { count: draftCount })}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    {state.referenceFiles.map((file) => (
                        <span
                            key={file.url}
                            className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground"
                        >
                            <FilePdf className="size-3.5 shrink-0 text-danger-600" />
                            <span className="truncate">{file.name}</span>
                            <button
                                type="button"
                                onClick={() => removeFile(file.url)}
                                className="rounded-full p-0.5 text-muted-foreground hover:bg-card hover:text-foreground"
                                aria-label={t('teach.upload.remove', { name: file.name })}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={uploading || state.referenceFiles.length >= MAX_REFERENCE_FILES}
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-1.5"
                    >
                        {uploading ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                        ) : (
                            <UploadSimple className="size-3.5" />
                        )}
                        {uploading ? t('teach.upload.uploading') : t('teach.upload.button')}
                    </MyButton>
                    <span className="text-xs text-muted-foreground">
                        {t('teach.upload.helper', { max: MAX_REFERENCE_FILES })}
                    </span>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf,.pdf"
                        multiple
                        className="hidden"
                        onChange={(e) => void handleFiles(e.target.files)}
                    />
                </div>
            </section>

            <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="ai-video-notes" className="text-subtitle font-regular">
                        {t('teach.notes.label')}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                        {t('teach.notes.counter', {
                            count: state.notes.length,
                            max: NOTES_MAX,
                        })}
                    </span>
                </div>
                <Textarea
                    id="ai-video-notes"
                    rows={4}
                    value={state.notes}
                    maxLength={NOTES_MAX}
                    placeholder={t('teach.notes.placeholder')}
                    onChange={(e) => onChange({ notes: e.target.value })}
                    aria-invalid={!!errors.notes}
                />
                {errorText('notes') && (
                    <p className="text-xs text-danger-600">{errorText('notes')}</p>
                )}
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkle className="size-3.5 shrink-0 text-primary-500" />
                    {t('teach.notes.helper')}
                </p>
            </div>
        </div>
    );
}
