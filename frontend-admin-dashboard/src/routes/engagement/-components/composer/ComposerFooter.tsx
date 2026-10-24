import { useFormState, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ArrowRight, PaperPlaneTilt, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { PlanStatus } from '../../-types/types';
import { countFormErrors, type ComposerForm } from '../forms/composer-schema';

/**
 * The composer's sticky footer, split for MyDialog's `footerLeft` / `footer` slots.
 *
 * Left: after a submit, "3 problems — Go to first" (or the server's error). Right: the
 * actions, which depend on the plan's status. A draft (every new plan starts as one)
 * gets Save draft and Publish…; a published plan gets Save changes.
 */

export interface ComposerFooterLeftProps {
    control: Control<ComposerForm>;
    /** A failed save, already in the admin's language. */
    serverError?: string | null;
    onGoToFirstError: () => void;
    /** Shown when there is nothing to report. */
    hint?: string | null;
}

export function ComposerFooterLeft({
    control,
    serverError,
    onGoToFirstError,
    hint,
}: ComposerFooterLeftProps) {
    const { t } = useTranslation('engagement');
    const { errors, isSubmitted } = useFormState({ control });
    const problems = isSubmitted ? countFormErrors(errors) : 0;

    // A server error means the save ran, so it is the news; problems left in days the
    // save didn't send stay flagged on those days.
    if (serverError) {
        return (
            <p role="alert" className="flex items-start gap-1.5 text-body text-danger-600">
                <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span className="line-clamp-2 min-w-0">{serverError}</span>
            </p>
        );
    }
    if (problems > 0) {
        return (
            <div
                role="alert"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-danger-600"
            >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                    <WarningCircle size={18} aria-hidden />
                    {t('composer.footer.problems', { count: problems })}
                </span>
                <MyButton type="button" buttonType="text" scale="small" onClick={onGoToFirstError}>
                    {t('composer.footer.goToFirst')} <ArrowRight size={14} aria-hidden />
                </MyButton>
            </div>
        );
    }
    if (hint) return <p className="truncate text-caption text-neutral-500">{hint}</p>;
    return null;
}

export interface ComposerFooterActionsProps {
    /** The status the plan will keep when saved without publishing. */
    status: PlanStatus;
    /** False until the form holds the plan (edit) or its defaults (create). */
    ready: boolean;
    saving: boolean;
    onCancel: () => void;
    /** Save without changing status (a draft stays a draft). */
    onSave: () => void;
    /** Opens the publish summary. */
    onPublish: () => void;
    isEdit: boolean;
}

export function ComposerFooterActions({
    status,
    ready,
    saving,
    onCancel,
    onSave,
    onPublish,
    isEdit,
}: ComposerFooterActionsProps) {
    const { t } = useTranslation('engagement');
    const busy = saving || !ready;
    const isDraft = status === 'DRAFT';

    return (
        <>
            <MyButton
                type="button"
                buttonType="text"
                scale="medium"
                onClick={onCancel}
                disable={saving}
            >
                {t('composer.footer.cancel')}
            </MyButton>
            {isDraft ? (
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={onSave}
                        disable={busy}
                    >
                        {saving ? t('composer.saving') : t('composer.footer.saveDraft')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={onPublish}
                        disable={busy}
                    >
                        <PaperPlaneTilt size={16} aria-hidden /> {t('composer.footer.publish')}
                    </MyButton>
                </>
            ) : (
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onClick={onSave}
                    disable={busy}
                >
                    {saving
                        ? t('composer.saving')
                        : isEdit
                          ? t('composer.saveChanges')
                          : t('composer.savePlan')}
                </MyButton>
            )}
        </>
    );
}
