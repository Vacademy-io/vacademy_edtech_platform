import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { ArrowLeft, Code, Palette } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    THEME_COLOR_DEFAULT,
    THEME_COLOR_TOKEN,
    type TemplateColor,
    describeSelector,
    extractTemplateColors,
    extractVariables,
    replaceTemplateColor,
    toPreviewHtml,
} from './html-template-utils';

interface HtmlTemplateEditorProps {
    template: MessageTemplate;
    isSaving: boolean;
    onSave: (template: MessageTemplate) => Promise<void>;
    onBack: () => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Editor for invoice templates written as HTML (the built-in invoice layout and any copy of it).
 * The drag-and-drop builder cannot open these, so this edits the colours with pickers and the
 * markup as code, with the result previewed as it will be laid out.
 */
export const HtmlTemplateEditor: React.FC<HtmlTemplateEditorProps> = ({
    template,
    isSaving,
    onSave,
    onBack,
}) => {
    const { t } = useTranslation('settingsInvoiceTemplates');
    const [name, setName] = useState(template.name);
    const [html, setHtml] = useState(template.content);
    // What is stored on the server, so Save turns off again once the edits are saved.
    const [saved, setSaved] = useState({ name: template.name, html: template.content });

    const colors = useMemo(() => extractTemplateColors(html), [html]);
    const previewHtml = useMemo(() => toPreviewHtml(html), [html]);
    const isDirty = html !== saved.html || name !== saved.name;

    const handleSave = async () => {
        const savedName = name.trim() || saved.name;
        try {
            await onSave({
                ...template,
                name: savedName,
                content: html,
                variables: extractVariables(html),
                templateType: template.type === 'INVOICE_EMAIL' ? 'INVOICE_EMAIL' : 'INVOICE',
                mjml: undefined,
            });
            setSaved({ name: savedName, html });
        } catch {
            // The caller already told the admin the save failed; the edits stay so they can retry.
        }
    };

    return (
        <div className="flex h-screen w-screen flex-col bg-neutral-50">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
                <MyButton buttonType="text" scale="medium" onClick={onBack}>
                    <ArrowLeft className="mr-1 size-4" />
                    {t('htmlEditor.back')}
                </MyButton>
                <div className="min-w-48 flex-1">
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('htmlEditor.namePlaceholder')}
                        input={name}
                        onChangeFunction={(e) => setName(e.target.value)}
                        size="medium"
                        className="w-full"
                    />
                </div>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disable={isSaving || !isDirty || !html.trim()}
                >
                    {isSaving ? t('htmlEditor.saving') : t('htmlEditor.save')}
                </MyButton>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
                <div className="flex w-full flex-col border-b border-neutral-200 bg-white md:w-96 md:border-b-0 md:border-r">
                    <Tabs
                        defaultValue="colours"
                        className="flex flex-1 flex-col overflow-hidden p-4"
                    >
                        <TabsList className="w-full">
                            <TabsTrigger value="colours" className="flex-1">
                                <Palette className="mr-1 size-4" />
                                {t('htmlEditor.tabs.colours')}
                            </TabsTrigger>
                            <TabsTrigger value="code" className="flex-1">
                                <Code className="mr-1 size-4" />
                                {t('htmlEditor.tabs.code')}
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="colours" className="flex-1 overflow-y-auto">
                            <p className="mb-3 text-caption text-neutral-500">
                                {t('htmlEditor.coloursHint')}
                            </p>
                            {colors.length === 0 ? (
                                <p className="text-body text-neutral-500">
                                    {t('htmlEditor.noColours')}
                                </p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {colors.map((color) => (
                                        <ColorRow
                                            key={color.value}
                                            color={color}
                                            onApply={(to) =>
                                                setHtml((prev) =>
                                                    replaceTemplateColor(prev, color.value, to)
                                                )
                                            }
                                        />
                                    ))}
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="code" className="flex flex-1 flex-col overflow-hidden">
                            <p className="mb-2 text-caption text-neutral-500">
                                {t('htmlEditor.codeHint', {
                                    example: '{{invoice_number}}',
                                    interpolation: { escapeValue: false },
                                })}
                            </p>
                            <Textarea
                                value={html}
                                onChange={(e) => setHtml(e.target.value)}
                                spellCheck={false}
                                className="min-h-96 flex-1 resize-none font-mono text-caption"
                            />
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="flex flex-1 flex-col overflow-hidden p-4">
                    <p className="mb-2 text-caption text-neutral-500">
                        {t('htmlEditor.previewHint')}
                    </p>
                    <iframe
                        title={t('htmlEditor.previewTitle')}
                        srcDoc={previewHtml}
                        sandbox=""
                        className="w-full flex-1 rounded-md border border-neutral-200 bg-white"
                    />
                </div>
            </div>
        </div>
    );
};

interface ColorRowProps {
    color: TemplateColor;
    onApply: (to: string) => void;
}

/** One colour of the template: a swatch that opens a picker, applied to the template on close. */
const ColorRow: React.FC<ColorRowProps> = ({ color, onApply }) => {
    const { t } = useTranslation('settingsInvoiceTemplates');
    const isTheme = color.value === THEME_COLOR_TOKEN;
    const current = isTheme ? THEME_COLOR_DEFAULT.toUpperCase() : color.value;
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(current);

    const handleOpenChange = (next: boolean) => {
        if (next) {
            setDraft(current);
        } else if (HEX.test(draft) && draft.toUpperCase() !== current) {
            onApply(draft.toUpperCase());
        }
        setOpen(next);
    };

    const places = color.usedIn.map(describeSelector).filter(Boolean);

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md border border-neutral-200 p-2 text-left hover:border-primary-500"
                >
                    {/* The swatch shows the template's own colour, which no design token can express. */}
                    <span
                        className="size-8 shrink-0 rounded-sm border border-neutral-200"
                        style={{ backgroundColor: current }}
                    />
                    <span className="flex min-w-0 flex-col">
                        <span className="text-body font-semibold text-neutral-700">
                            {isTheme ? t('htmlEditor.themeColour') : current}
                        </span>
                        <span className="truncate text-caption text-neutral-500">
                            {t('htmlEditor.usedIn', {
                                places: places.slice(0, 3).join(', ') || '-',
                            })}
                        </span>
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="flex w-60 flex-col gap-2">
                <HexColorPicker
                    color={HEX.test(draft) ? draft : current}
                    onChange={(v) => setDraft(v.toUpperCase())}
                />
                <Input
                    maxLength={7}
                    value={draft}
                    onChange={(e) => setDraft(e.currentTarget.value.trim())}
                />
                <p className="text-caption text-neutral-500">{t('htmlEditor.applyHint')}</p>
            </PopoverContent>
        </Popover>
    );
};

export default HtmlTemplateEditor;
