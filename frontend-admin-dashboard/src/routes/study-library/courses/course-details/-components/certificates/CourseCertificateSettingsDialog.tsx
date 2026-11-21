import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    saveCourseCertificateSettings,
    type CourseCertificateSettings,
} from '../../-services/course-certificates';
import { CourseCertificateTemplateUpload } from './CourseCertificateTemplateUpload';
import { CourseCertificatePicker } from './CourseCertificatePicker';

interface CourseCertificateSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    packageId: string;
    settings: CourseCertificateSettings | undefined;
}

/** Tri-state: inherit the institute default, or force on/off for this course. */
type EnabledChoice = 'INHERIT' | 'ON' | 'OFF';

export const CourseCertificateSettingsDialog = ({
    open,
    onOpenChange,
    instituteId,
    packageId,
    settings,
}: CourseCertificateSettingsDialogProps) => {
    const { t } = useTranslation('studyLibraryCertificateCourseCertificateSettingsDialog');
    const queryClient = useQueryClient();

    const [enabledChoice, setEnabledChoice] = useState<EnabledChoice>('INHERIT');
    const [overrideThreshold, setOverrideThreshold] = useState(false);
    const [threshold, setThreshold] = useState(80);
    // Two ways for a course to have its own certificate, and only one can be in
    // force: follow one of the institute's saved designs by id, or use HTML
    // uploaded for this course alone. Both null means inherit the default.
    const [templateId, setTemplateId] = useState<string | null>(null);
    const [templateHtml, setTemplateHtml] = useState<string | null>(null);

    // Re-seed whenever the dialog opens so a cancelled edit doesn't persist.
    useEffect(() => {
        if (!open || !settings) return;
        const override = settings.course_override;
        setEnabledChoice(
            override?.enabled === true ? 'ON' : override?.enabled === false ? 'OFF' : 'INHERIT'
        );
        setOverrideThreshold(
            override?.thresholdPercent !== null && override?.thresholdPercent !== undefined
        );
        setThreshold(override?.thresholdPercent ?? settings.institute_threshold_percent);
        // The resolved id, not the stored one: a course pointing at a design
        // that has since been deleted is really inheriting, and the dialog has
        // to show what is being issued rather than what was once chosen.
        setTemplateId(settings.course_template_id ?? null);
        setTemplateHtml(override?.templateHtml ?? null);
    }, [open, settings]);

    const saveMutation = useMutation({
        mutationFn: () =>
            saveCourseCertificateSettings(instituteId, packageId, {
                // null clears the override and falls back to the institute default.
                enabled: enabledChoice === 'INHERIT' ? null : enabledChoice === 'ON',
                thresholdPercent: overrideThreshold ? threshold : null,
                templateId,
                // Never both: a saved design and uploaded HTML would be two
                // answers to "which certificate does this course print".
                templateHtml: templateId ? null : templateHtml,
            }),
        onSuccess: () => {
            toast.success(t('toast.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: ['course-certificate-settings'] });
            queryClient.invalidateQueries({ queryKey: ['course-certificate-dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['course-certificate-learners'] });
            onOpenChange(false);
        },
        onError: () => toast.error(t('toast.saveFailed')),
    });

    const instituteState = settings?.institute_enabled
        ? t('instituteState.enabled')
        : t('instituteState.disabled');
    const effectiveEnabled =
        enabledChoice === 'INHERIT' ? !!settings?.institute_enabled : enabledChoice === 'ON';

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        disable={saveMutation.isPending}
                        onClick={() => saveMutation.mutate()}
                    >
                        {saveMutation.isPending ? t('saving') : t('save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-6 p-2">
                <div className="rounded-md bg-neutral-50 p-3">
                    <p className="text-caption text-neutral-500">
                        <Trans
                            i18nKey="studyLibraryCertificateCourseCertificateSettingsDialog:instituteDefaultSummary"
                            values={{
                                state: instituteState,
                                pct: settings?.institute_threshold_percent ?? 80,
                            }}
                            components={{ strong: <span className="font-semibold text-neutral-700" /> }}
                        />
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    <Label className="text-subtitle font-medium">{t('certificatesForCourse')}</Label>
                    <div className="flex flex-wrap gap-2">
                        {(
                            [
                                ['INHERIT', t('choice.inherit')],
                                ['ON', t('choice.enabled')],
                                ['OFF', t('choice.disabled')],
                            ] as const
                        ).map(([value, label]) => (
                            <MyButton
                                key={value}
                                type="button"
                                scale="small"
                                buttonType={enabledChoice === value ? 'primary' : 'secondary'}
                                onClick={() => setEnabledChoice(value)}
                            >
                                {label}
                            </MyButton>
                        ))}
                    </div>
                    <p className="text-caption text-neutral-500">
                        {effectiveEnabled ? t('willReceiveCertificates') : t('noCertificates')}
                        {enabledChoice === 'ON' &&
                            !settings?.institute_enabled &&
                            ` ${t('instituteDefaultOffException')}`}
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            id="override-threshold"
                            checked={overrideThreshold}
                            onCheckedChange={setOverrideThreshold}
                        />
                        <Label htmlFor="override-threshold" className="text-subtitle font-medium">
                            {t('overrideThresholdLabel')}
                        </Label>
                    </div>
                    {overrideThreshold && (
                        <div className="flex items-center gap-3">
                            <MyInput
                                inputType="number"
                                input={String(threshold)}
                                onChangeFunction={(e) =>
                                    setThreshold(
                                        Math.max(
                                            0,
                                            Math.min(100, Number(e.target.value) || 0)
                                        )
                                    )
                                }
                                inputPlaceholder="80"
                                className="w-28"
                            />
                            <span className="text-body text-neutral-500">{t('percentCompletion')}</span>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3">
                    <Label className="text-subtitle font-medium">{t('certificateDesign')}</Label>
                    <CourseCertificatePicker
                        value={{ templateId, templateHtml }}
                        onChange={(next) => {
                            setTemplateId(next.templateId);
                            setTemplateHtml(next.templateHtml);
                        }}
                        disabled={saveMutation.isPending}
                    />
                    {/* The escape hatch, below the picker rather than beside it:
                        a design that exists nowhere but this course. Hidden
                        while a saved template is chosen, so there is only ever
                        one answer on screen. */}
                    {!templateId && (
                        <CourseCertificateTemplateUpload
                            templateHtml={templateHtml}
                            onChange={setTemplateHtml}
                        />
                    )}
                </div>
            </div>
        </MyDialog>
    );
};
