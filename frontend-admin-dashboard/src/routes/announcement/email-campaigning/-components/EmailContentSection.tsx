import { Suspense, lazy, useState } from 'react';
import {
    ArrowSquareOut,
    BracketsCurly,
    CaretDown,
    CircleNotch,
    Code,
    Eye,
    Plus,
    TextAa,
    X,
} from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { AsyncSearchableSelect } from '@/components/design-system/async-searchable-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { FieldError, LoadFailure, SectionCard } from '../../create/-components/primitives';
import { EMAIL_VARIABLES, Field, StepBadge } from './primitives';
import type { FieldErrors } from '../-types';

const TipTapEditor = lazy(() =>
    import('@/components/tiptap/TipTapEditor').then((module) => ({ default: module.TipTapEditor }))
);

export type ContentView = 'editor' | 'source';

interface EmailContentSectionProps {
    htmlContent: string;
    onHtmlContentChange: (value: string) => void;
    contentText: string;
    contentView: ContentView;
    onContentViewChange: (view: ContentView) => void;
    templateId: string;
    templateName: string;
    onApplyTemplate: (templateId: string, name?: string) => void;
    applyingTemplate: boolean;
    loadTemplateOptions: (
        search: string,
        page: number
    ) => Promise<{ options: Array<{ label: string; value: string }>; hasMore: boolean }>;
    templatesError: string | null;
    onRetryTemplates: () => void;
    onOpenPreview: () => void;
    errors: FieldErrors;
    showErrors: boolean;
    disabled?: boolean;
}

export function EmailContentSection({
    htmlContent,
    onHtmlContentChange,
    contentText,
    contentView,
    onContentViewChange,
    templateId,
    templateName,
    onApplyTemplate,
    applyingTemplate,
    loadTemplateOptions,
    templatesError,
    onRetryTemplates,
    onOpenPreview,
    errors,
    showErrors,
    disabled,
}: EmailContentSectionProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const navigate = useNavigate();
    const err = (key: string) => (showErrors ? errors[key] : undefined);
    const invalid = Boolean(err('content'));
    const done = !invalid && contentText.length > 0;
    const [insertRequest, setInsertRequest] = useState<{ text: string; nonce: number }>();
    const [templatePickerKey, setTemplatePickerKey] = useState(0);

    const wordCount = contentText ? contentText.split(/\s+/).filter(Boolean).length : 0;
    // TipTap reads its placeholder once at mount. The namespace can land after that first
    // render, so key the editor on the resolved string to remount it with the real copy.
    const editorPlaceholder = t('content.editorPlaceholder');

    const insertVariable = (token: string) => {
        if (contentView === 'source') {
            onHtmlContentChange(`${htmlContent}${token}`);
            return;
        }
        setInsertRequest({ text: token, nonce: Date.now() });
    };

    const variableItems = EMAIL_VARIABLES.map((variable) => ({
        label: `${t(`content.variables.${variable.key}`)}  ${variable.token}`,
        value: variable.token,
    }));

    return (
        <SectionCard
            title={t('content.title')}
            description={t('content.description')}
            badge={<StepBadge step={2} invalid={invalid} done={done} />}
            invalid={invalid}
            action={
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={onOpenPreview}
                    disable={!htmlContent}
                >
                    <Eye className="me-1 size-4" />
                    {t('content.previewEmail')}
                </MyButton>
            }
        >
            <Field
                label={t('content.template.label')}
                hint={
                    templateName
                        ? t('content.template.appliedHint', { name: templateName })
                        : t('content.template.hint')
                }
                trailing={
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() =>
                            navigate({ to: '/settings', search: { selectedTab: 'templates' } })
                        }
                    >
                        {t('content.template.manage')}
                        <ArrowSquareOut className="ms-1 size-4" />
                    </MyButton>
                }
            >
                {templatesError ? (
                    <LoadFailure
                        message={templatesError}
                        onRetry={() => {
                            onRetryTemplates();
                            setTemplatePickerKey((k) => k + 1);
                        }}
                    />
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <AsyncSearchableSelect
                                key={templatePickerKey}
                                value={templateId}
                                selectedLabel={templateName}
                                onChange={(value, option) => onApplyTemplate(value, option?.label)}
                                loadOptions={loadTemplateOptions}
                                placeholder={
                                    applyingTemplate
                                        ? t('content.template.applying')
                                        : t('content.template.placeholder')
                                }
                                searchPlaceholder={t('content.template.searchPlaceholder')}
                                emptyText={t('content.template.empty')}
                                disabled={disabled || applyingTemplate}
                                footer={
                                    <div className="border-t p-1">
                                        <button
                                            type="button"
                                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-body font-semibold text-primary-500 hover:bg-primary-50"
                                            onClick={() =>
                                                navigate({
                                                    to: '/settings',
                                                    search: { selectedTab: 'templates' },
                                                })
                                            }
                                        >
                                            <Plus className="size-4" />
                                            <span>{t('content.template.addNew')}</span>
                                        </button>
                                    </div>
                                }
                            />
                        </div>
                        {templateName && (
                            <Badge variant="secondary" className="gap-1 font-regular">
                                {templateName}
                                <button
                                    type="button"
                                    aria-label={t('content.template.clear')}
                                    className="rounded-full hover:text-danger-600"
                                    onClick={() => onApplyTemplate('')}
                                    disabled={disabled}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        )}
                    </div>
                )}
            </Field>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Tabs
                        value={contentView}
                        onValueChange={(value) => onContentViewChange(value as ContentView)}
                    >
                        <TabsList>
                            <TabsTrigger value="editor" className="text-caption">
                                <TextAa className="me-1 size-4" />
                                {t('content.tabs.editor')}
                            </TabsTrigger>
                            <TabsTrigger value="source" className="text-caption">
                                <Code className="me-1 size-4" />
                                {t('content.tabs.source')}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="flex items-center gap-2">
                        <MyDropdown
                            dropdownList={variableItems}
                            onSelect={insertVariable}
                            disable={disabled}
                            contentClassName="max-h-72 overflow-y-auto"
                        >
                            <span className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 px-3 text-caption font-semibold text-neutral-600 hover:border-primary-200 hover:bg-primary-50">
                                <BracketsCurly className="size-4" />
                                {t('content.variables.insert')}
                                <CaretDown className="size-3" />
                            </span>
                        </MyDropdown>
                    </div>
                </div>

                {contentView === 'editor' ? (
                    <div
                        className={cn(
                            'overflow-hidden rounded-md border bg-card',
                            invalid ? 'border-danger-400' : 'border-border'
                        )}
                    >
                        <Suspense
                            fallback={
                                <div className="flex h-52 items-center justify-center bg-card">
                                    <CircleNotch className="size-5 animate-spin text-primary-500" />
                                </div>
                            }
                        >
                            <TipTapEditor
                                key={editorPlaceholder}
                                value={htmlContent}
                                onChange={onHtmlContentChange}
                                onBlur={() => {}}
                                placeholder={editorPlaceholder}
                                minHeight={220}
                                borderless
                                editable={!disabled}
                                insertTextRequest={insertRequest}
                            />
                        </Suspense>
                    </div>
                ) : (
                    <Textarea
                        value={htmlContent}
                        onChange={(e) => onHtmlContentChange(e.target.value)}
                        placeholder={t('content.sourcePlaceholder')}
                        disabled={disabled}
                        aria-invalid={invalid}
                        className={cn(
                            'min-h-56 font-mono text-caption',
                            invalid && 'border-danger-400'
                        )}
                    />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldError message={err('content')} />
                    <span className="ms-auto text-caption tabular-nums text-muted-foreground">
                        {t('content.wordCount', { count: wordCount })}
                    </span>
                </div>
            </div>
        </SectionCard>
    );
}
