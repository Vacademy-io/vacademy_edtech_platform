import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { parseSectionJson } from '../-utils/section-edits';

/**
 * "Edit this section as JSON": only this section's settings (its props), so a
 * value that has no form field yet can be changed without the whole-site JSON
 * tab. Apply replaces the props in one edit, which Undo reverts.
 */
export const SectionJsonDialog = ({
    open,
    onOpenChange,
    value,
    onApply,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: Record<string, unknown>;
    onApply: (next: Record<string, unknown>) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Fresh copy of the current settings every time the dialog opens.
    useEffect(() => {
        if (!open) return;
        setText(JSON.stringify(value ?? {}, null, 2));
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
    }, [open]);

    const apply = () => {
        const result = parseSectionJson(text);
        if (!result.ok) {
            setError(
                result.error === 'not-object'
                    ? t('sectionJson.notObject')
                    : result.line
                      ? t('sectionJson.errorAt', {
                            line: result.line,
                            column: result.column,
                            message: result.error,
                        })
                      : t('sectionJson.invalid', { message: result.error })
            );
            return;
        }
        if (JSON.stringify(result.value) !== JSON.stringify(value ?? {})) onApply(result.value);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-xl flex-col">
                <DialogHeader>
                    <DialogTitle>{t('sectionJson.title')}</DialogTitle>
                </DialogHeader>
                <p className="text-caption text-neutral-500">{t('sectionJson.hint')}</p>
                <Textarea
                    aria-label={t('sectionJson.title')}
                    className="min-h-0 flex-1 font-mono text-xs"
                    rows={24}
                    spellCheck={false}
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        setError(null);
                    }}
                />
                {error && (
                    <p role="alert" className="text-caption text-danger-600">
                        {error}
                    </p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('actions.cancel')}
                    </Button>
                    <Button onClick={apply}>{t('sectionJson.apply')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
