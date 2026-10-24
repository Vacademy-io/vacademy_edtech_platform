import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { WhatsAppTemplatePreview } from '@/components/templates/WhatsAppTemplatePreview';
import { splitTemplateText } from '@/components/templates/template-text';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import { templateHeaderKind } from '../-utils/template-header';

/** One `{{N}}` in the body, with the human name the template gives it and its approved sample. */
export interface TemplateVariable {
    /** The positional token, `"1"` — also the key the send API wants. */
    token: string;
    /** `bodyVariableNames[N-1]` when the template has one, else the token. */
    name: string;
    sample: string;
}

/**
 * The distinct body placeholders, in first-appearance order. A body can repeat `{{1}}`; it is
 * still one value to fill in.
 */
export function templateVariables(template: WhatsAppTemplateDTO): TemplateVariable[] {
    const seen = new Set<string>();
    const out: TemplateVariable[] = [];
    for (const part of splitTemplateText(template.bodyText, {
        variableNames: template.bodyVariableNames,
    })) {
        if (part.kind !== 'variable' || seen.has(part.token)) continue;
        seen.add(part.token);
        const position = Number(part.token);
        const sample =
            Number.isInteger(position) && position > 0
                ? template.bodySampleValues?.[position - 1] ?? ''
                : '';
        out.push({ token: part.token, name: part.name, sample });
    }
    return out;
}

interface Props {
    /** The template being sent; null keeps the dialog closed. */
    template: WhatsAppTemplateDTO | null;
    phone: string;
    onClose: () => void;
    /** Resolves when the send attempt has finished; the caller closes the dialog on success. */
    onSend: (template: WhatsAppTemplateDTO, variables: Record<string, string>) => Promise<void>;
}

/**
 * What the contact will see, before it goes.
 *
 * A template cannot be edited at send time and, outside the 24-hour window, it is the only thing
 * that reaches the contact — so the one protection against sending the wrong message is looking
 * at it first. The bubble renders the whole approved template (header media, body, footer,
 * buttons) and the variable fields update it live; Send stays disabled until every value is in.
 */
export function TemplateSendDialog({ template, phone, onClose, onSend }: Props) {
    const { t } = useTranslation('communicationReplyBox');
    const [values, setValues] = useState<Record<string, string>>({});

    const variables = useMemo(() => (template ? templateVariables(template) : []), [template]);

    // Start every field from its approved sample, so a template with sensible samples is one
    // click to send and a template without them makes its gaps obvious.
    useEffect(() => {
        const next: Record<string, string> = {};
        for (const v of variables) next[v.token] = v.sample;
        setValues(next);
    }, [variables]);

    const headerKind = template ? templateHeaderKind(template) : null;
    const headerUrl = template?.headerSampleUrl?.trim() || '';
    const headerMissing = !!headerKind && !headerUrl;

    const missingCount = variables.filter((v) => !values[v.token]?.trim()).length;
    const canSend = !!template && !headerMissing && missingCount === 0;

    const previewLabels = useMemo(
        () => ({
            image: t('templateDialog.media.image'),
            video: t('templateDialog.media.video'),
            document: t('templateDialog.media.document'),
            emptyBody: t('templateDialog.emptyBody'),
        }),
        [t]
    );

    const handleSend = async () => {
        if (!template || !canSend) return;
        const trimmed: Record<string, string> = {};
        for (const v of variables) trimmed[v.token] = values[v.token]?.trim() ?? '';
        await onSend(template, trimmed);
    };

    return (
        <MyDialog
            heading={t('templateDialog.heading')}
            open={!!template}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-xl"
            footer={
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('templateDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!canSend}
                        onAsyncClick={handleSend}
                        loadingText={t('templateDialog.sending')}
                    >
                        {t('templateDialog.send')}
                    </MyButton>
                </>
            }
        >
            {template && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5">
                        <p className="text-body font-medium text-neutral-800">{template.name}</p>
                        <p className="text-caption text-neutral-600">
                            {t('templateDialog.to', { phone })}
                        </p>
                    </div>

                    <WhatsAppTemplatePreview
                        template={template}
                        values={values}
                        mediaUrl={headerUrl}
                        labels={previewLabels}
                    />

                    {headerMissing && (
                        <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
                            <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <p className="text-caption text-danger-700">
                                {t('templateDialog.headerMissing', {
                                    kind: t(`mediaKindLabel.${headerKind}`),
                                })}
                            </p>
                        </div>
                    )}

                    {variables.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <p className="text-caption font-medium text-neutral-600">
                                {t('templateDialog.valuesLabel')}
                            </p>
                            {variables.map((v, index) => (
                                <MyInput
                                    key={v.token}
                                    inputType="text"
                                    size="medium"
                                    className="w-full text-body text-neutral-800 sm:w-full"
                                    label={
                                        v.name !== v.token
                                            ? v.name
                                            : t('templateDialog.valueFallback', { n: index + 1 })
                                    }
                                    required
                                    inputPlaceholder={
                                        v.sample
                                            ? t('templateDialog.valuePlaceholder', {
                                                  value: v.sample,
                                              })
                                            : undefined
                                    }
                                    input={values[v.token] ?? ''}
                                    onChangeFunction={(e) =>
                                        setValues((prev) => ({
                                            ...prev,
                                            [v.token]: e.target.value,
                                        }))
                                    }
                                />
                            ))}
                            {missingCount > 0 && (
                                <p className="text-caption text-warning-700">
                                    {t('templateDialog.missingValues', { count: missingCount })}
                                </p>
                            )}
                        </div>
                    )}

                    <p className="text-caption text-neutral-500">{t('templateDialog.note')}</p>
                </div>
            )}
        </MyDialog>
    );
}
