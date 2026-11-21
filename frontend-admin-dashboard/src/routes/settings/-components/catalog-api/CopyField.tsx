import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Copy } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { copyTextToClipboard } from '@/lib/clipboard';

/** A labelled value (DNS name, key, URL) with a copy button. */
export function CopyField({
    label,
    value,
    onCopied,
}: {
    label: string;
    value: string;
    onCopied?: () => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        if (await copyTextToClipboard(value)) {
            setCopied(true);
            onCopied?.();
            toast.success(t('catalogApi.copied'));
        } else {
            toast.error(t('catalogApi.copyFailed'));
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <p className="text-caption font-medium text-neutral-600">{label}</p>
            <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-neutral-800">
                    {value}
                </code>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    aria-label={`${t('catalogApi.copy')} ${label}`}
                    onClick={() => void copy()}
                >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? t('catalogApi.copiedShort') : t('catalogApi.copy')}
                </MyButton>
            </div>
        </div>
    );
}
