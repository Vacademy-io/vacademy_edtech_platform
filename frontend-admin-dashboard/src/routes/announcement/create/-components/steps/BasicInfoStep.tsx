import { Suspense, lazy } from 'react';
import { CircleNotch, Code, TextAa, TextT } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MediumType, ModeType } from '@/services/announcement';
import { buildAnnouncementPresets } from '../../-utils/constants';
import { FieldError, FieldHint, SectionCard } from '../primitives';
import type { FieldErrors } from '../../-types';

const TipTapEditor = lazy(() =>
    import('@/components/tiptap/TipTapEditor').then((module) => ({ default: module.TipTapEditor }))
);

const TITLE_LIMIT = 100;
const PREVIEW_LIMIT = 150;

interface BasicInfoStepProps {
    title: string;
    onTitleChange: (value: string) => void;
    previewText: string;
    onPreviewTextChange: (value: string) => void;
    htmlContent: string;
    onHtmlContentChange: (value: string) => void;
    contentView: 'editor' | 'source';
    onContentViewChange: (view: 'editor' | 'source') => void;
    modes: ModeType[];
    mediums: MediumType[];
    onApplyPreset: (presetId: 'GENERAL' | 'PINNED') => void;
    errors: FieldErrors;
    showErrors: boolean;
}

export function BasicInfoStep({
    title,
    onTitleChange,
    previewText,
    onPreviewTextChange,
    htmlContent,
    onHtmlContentChange,
    contentView,
    onContentViewChange,
    modes,
    mediums,
    onApplyPreset,
    errors,
    showErrors,
}: BasicInfoStepProps) {
    const { t } = useTranslation('announcementCreateBasicInfoStep');
    const announcementPresets = buildAnnouncementPresets(t);
    const err = (key: string) => (showErrors ? errors[key] : undefined);

    return (
        <div className="space-y-6">
            <SectionCard
                title={t('typeSection.title')}
                description={t('typeSection.description')}
                Icon={TextAa}
            >
                <div className="grid gap-3 sm:grid-cols-2">
                    {announcementPresets.map((preset) => {
                        const active =
                            preset.modes.every((mode) => modes.includes(mode)) &&
                            preset.mediums.every((medium) => mediums.includes(medium));
                        return (
                            <button
                                key={preset.id}
                                type="button"
                                onClick={() => onApplyPreset(preset.id)}
                                aria-pressed={active}
                                className={cn(
                                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                                    'hover:border-primary-300 hover:bg-primary-50/40',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    active
                                        ? 'border-primary-500 bg-primary-50/60'
                                        : 'border-border bg-card'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                                        active
                                            ? 'bg-primary-100 text-primary-600'
                                            : 'bg-muted text-muted-foreground'
                                    )}
                                >
                                    <preset.Icon className="size-5" weight="duotone" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-body font-semibold text-foreground">
                                        {preset.label}
                                    </span>
                                    <span className="block text-caption text-muted-foreground">
                                        {preset.description}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </SectionCard>

            <SectionCard
                title={t('messageSection.title')}
                description={t('messageSection.description')}
                Icon={TextT}
                invalid={Boolean(err('title') || err('content'))}
            >
                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <Label className="text-caption font-semibold">
                            {t('titleLabel')} <span className="text-danger-600">*</span>
                        </Label>
                        <span
                            className={cn(
                                'text-caption tabular-nums',
                                title.length > TITLE_LIMIT
                                    ? 'text-warning-600'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {title.length}/{TITLE_LIMIT}
                        </span>
                    </div>
                    <Input
                        value={title}
                        onChange={(e) => onTitleChange(e.target.value)}
                        placeholder={t('titlePlaceholder')}
                        className={cn(err('title') && 'border-danger-400')}
                    />
                    <FieldError message={err('title')} />
                </div>

                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <Label className="text-caption font-semibold">
                            {t('previewTextLabel')}
                        </Label>
                        <span
                            className={cn(
                                'text-caption tabular-nums',
                                previewText.length > PREVIEW_LIMIT
                                    ? 'text-warning-600'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {previewText.length}/{PREVIEW_LIMIT}
                        </span>
                    </div>
                    <Input
                        value={previewText}
                        onChange={(e) => onPreviewTextChange(e.target.value)}
                        placeholder={t('previewTextPlaceholder')}
                    />
                    <FieldHint>{t('previewTextHint')}</FieldHint>
                </div>

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-caption font-semibold">
                            {t('contentLabel')} <span className="text-danger-600">*</span>
                        </Label>
                        <div className="flex items-center gap-1 rounded-md border p-0.5">
                            <MyButton
                                buttonType={contentView === 'editor' ? 'primary' : 'text'}
                                scale="small"
                                onClick={() => onContentViewChange('editor')}
                            >
                                <TextAa className="mr-1 size-4" />
                                {t('richTextTab')}
                            </MyButton>
                            <MyButton
                                buttonType={contentView === 'source' ? 'primary' : 'text'}
                                scale="small"
                                onClick={() => onContentViewChange('source')}
                            >
                                <Code className="mr-1 size-4" />
                                {t('htmlTab')}
                            </MyButton>
                        </div>
                    </div>

                    {contentView === 'editor' ? (
                        <div
                            className={cn(
                                'overflow-hidden rounded-md border bg-card',
                                err('content') ? 'border-danger-400' : 'border-border'
                            )}
                        >
                            <Suspense
                                fallback={
                                    <div className="flex h-40 items-center justify-center bg-card">
                                        <CircleNotch className="size-5 animate-spin text-primary-500" />
                                    </div>
                                }
                            >
                                <TipTapEditor
                                    value={htmlContent}
                                    onChange={onHtmlContentChange}
                                    onBlur={() => {}}
                                    placeholder={t('editorPlaceholder')}
                                    minHeight={200}
                                    borderless
                                />
                            </Suspense>
                        </div>
                    ) : (
                        <Textarea
                            value={htmlContent}
                            onChange={(e) => onHtmlContentChange(e.target.value)}
                            placeholder={t('sourcePlaceholder')}
                            className={cn(
                                'min-h-52 font-mono text-caption',
                                err('content') && 'border-danger-400'
                            )}
                        />
                    )}
                    <FieldError message={err('content')} />
                </div>
            </SectionCard>
        </div>
    );
}
