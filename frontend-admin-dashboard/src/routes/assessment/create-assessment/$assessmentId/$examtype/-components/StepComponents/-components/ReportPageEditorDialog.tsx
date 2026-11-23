import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmailRichTextEditor } from '@/components/templates/shared/EmailRichTextEditor';
import {
    STARTER_LETTER_HTML,
    appendToken,
    type ReportPage,
    type ReportPageValue,
} from '@/types/assessments/report-pages';

/**
 * Writes one report page: the simple editor (pages made here) or its HTML (pages with their
 * own design, e.g. a styled scholarship letter, which the simple editor would flatten). Value buttons
 * drop {{placeholders}} that the server fills per student.
 */
export const ReportPageEditorDialog = ({
    open,
    onOpenChange,
    page,
    values,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** null = a new page. */
    page: ReportPage | null;
    values: ReportPageValue[];
    onSave: (page: ReportPage) => void;
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const simpleAllowed = !page || page.editor === 'simple';
    const [name, setName] = useState('');
    const [html, setHtml] = useState('');
    const [tab, setTab] = useState<'simple' | 'html'>('simple');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!open) return;
        setName(page?.name ?? '');
        setHtml(page?.html ?? '');
        setTab(simpleAllowed ? 'simple' : 'html');
    }, [open, page, simpleAllowed]);

    const insert = (token: string) => {
        const el = textareaRef.current;
        if (tab === 'html' && el) {
            const start = el.selectionStart ?? html.length;
            const end = el.selectionEnd ?? html.length;
            setHtml(html.slice(0, start) + token + html.slice(end));
            return;
        }
        setHtml(appendToken(html, token));
    };

    const empty = html.replace(/<[^>]*>/g, '').trim() === '' && !/\{\{/.test(html);

    const save = () => {
        onSave({
            ...(page ?? {}),
            type: 'TEMPLATE',
            name: name.trim() || t('reportOptions.pages.untitledPage'),
            html,
            ...(simpleAllowed ? { editor: 'simple' as const } : {}),
        });
        onOpenChange(false);
    };

    return (
        <MyDialog
            heading={page ? t('reportOptions.pages.editPage') : t('reportOptions.pages.writePage')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-4xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        {t('reportOptions.pages.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" disable={empty} onClick={save}>
                        {t('reportOptions.pages.savePage')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <MyInput
                    label={t('reportOptions.pages.pageName')}
                    inputPlaceholder={t('reportOptions.pages.pageNamePlaceholder')}
                    input={name}
                    onChangeFunction={(e) => setName(e.target.value)}
                    size="medium"
                    className="sm:w-full"
                />

                {simpleAllowed ? (
                    <Tabs value={tab} onValueChange={(v) => setTab(v as 'simple' | 'html')}>
                        <TabsList>
                            <TabsTrigger value="simple">{t('reportOptions.pages.simpleEditor')}</TabsTrigger>
                            <TabsTrigger value="html">{t('reportOptions.pages.htmlEditor')}</TabsTrigger>
                        </TabsList>
                    </Tabs>
                ) : (
                    <p className="flex items-start gap-2 text-caption text-neutral-500">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t('reportOptions.pages.ownDesignNote')}</span>
                    </p>
                )}

                <div className="flex flex-col gap-2">
                    <span className="text-caption text-neutral-500">{t('reportOptions.pages.valuesHint')}</span>
                    <div className="flex flex-wrap gap-2">
                        {values.map((value) => (
                            <MyButton
                                key={value.token}
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => insert(value.token)}
                            >
                                {value.labelKey ? t(`reportOptions.pages.values.${value.labelKey}`) : value.label}
                            </MyButton>
                        ))}
                    </div>
                </div>

                {tab === 'simple' && simpleAllowed ? (
                    <div className="flex flex-col gap-2">
                        {empty && (
                            <div>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => setHtml(STARTER_LETTER_HTML)}
                                >
                                    {t('reportOptions.pages.startFromSample')}
                                </MyButton>
                            </div>
                        )}
                        <EmailRichTextEditor
                            value={html}
                            onChange={setHtml}
                            minHeight={320}
                            showPreviewButton={false}
                            placeholder={t('reportOptions.pages.editorPlaceholder')}
                        />
                    </div>
                ) : (
                    <Textarea
                        ref={textareaRef}
                        value={html}
                        onChange={(e) => setHtml(e.target.value)}
                        rows={18}
                        className="font-mono text-caption"
                        spellCheck={false}
                    />
                )}
            </div>
        </MyDialog>
    );
};
