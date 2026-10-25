import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Copy } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DUPLICATE_PARTS, type DuplicatePart } from '../-utils/campaign';

/**
 * Pick what to carry over, then open the Email Campaigning form prefilled with it. Nothing is
 * created until the admin sends or schedules from that form, so the copy can be edited first —
 * e.g. keep the audience but pick a different template.
 */
export function DuplicateCampaignDialog({
    campaign,
    onClose,
}: {
    campaign: { id: string; title: string } | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('announcementCampaignTools');
    const navigate = useNavigate();
    const [keep, setKeep] = useState<DuplicatePart[]>([...DUPLICATE_PARTS]);

    useEffect(() => {
        if (campaign) setKeep([...DUPLICATE_PARTS]);
    }, [campaign]);

    const toggle = (part: DuplicatePart, checked: boolean) =>
        setKeep((prev) =>
            checked
                ? DUPLICATE_PARTS.filter((p) => p === part || prev.includes(p))
                : prev.filter((p) => p !== part)
        );

    const handleContinue = () => {
        if (!campaign) return;
        onClose();
        navigate({
            to: '/announcement/email-campaigning',
            search: { duplicateFrom: campaign.id, keep: keep.join(',') },
        });
    };

    return (
        <MyDialog
            heading={t('duplicate.heading')}
            open={!!campaign}
            onOpenChange={(open) => !open && onClose()}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('duplicate.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onClick={handleContinue}>
                        <Copy className="me-1 size-4" />
                        {t('duplicate.continue')}
                    </MyButton>
                </>
            }
        >
            {campaign && (
                <div className="flex flex-col gap-4">
                    <p className="text-body text-neutral-700">
                        {t('duplicate.description', { title: campaign.title })}
                    </p>
                    <fieldset className="flex flex-col gap-3">
                        <legend className="mb-2 text-caption font-semibold text-neutral-600">
                            {t('duplicate.keepLegend')}
                        </legend>
                        {DUPLICATE_PARTS.map((part) => (
                            <label
                                key={part}
                                htmlFor={`duplicate-keep-${part}`}
                                className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 hover:border-primary-300"
                            >
                                <Checkbox
                                    id={`duplicate-keep-${part}`}
                                    checked={keep.includes(part)}
                                    onCheckedChange={(checked) => toggle(part, checked === true)}
                                    className="mt-0.5"
                                />
                                <span className="min-w-0">
                                    <span className="block text-body font-semibold text-neutral-800">
                                        {t(`duplicate.parts.${part}.label`)}
                                    </span>
                                    <span className="block text-caption text-neutral-500">
                                        {t(`duplicate.parts.${part}.hint`)}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                    <p className="text-caption text-muted-foreground">{t('duplicate.note')}</p>
                </div>
            )}
        </MyDialog>
    );
}
