import { useState } from 'react';
import { Route } from '../..';
import { MyButton } from '@/components/design-system/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ReleaseResultDialog } from '../submission-review/ReleaseResultDialog';

/**
 * Toolbar "Release result". Opens the W9 dialog, which says how many learners are ready,
 * how many still have unmarked answers or are being checked by AI, and releases the ready
 * ones (and the rest once marked) instead of publishing everyone's current marks.
 */
export const AssessmentGlobalLevelReleaseResultAssessment = ({
    triggerClassName,
    onReleased,
}: {
    /** Lets the Submissions action row size this button like its neighbours. */
    triggerClassName?: string;
    /** Refresh the list after a release. */
    onReleased?: () => void;
} = {}) => {
    const { t } = useTranslation('assessmentGlobalLevelReleaseResult');
    const { assessmentId } = Route.useParams();
    const [open, setOpen] = useState(false);
    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    {/* The one action on this row that publishes something to learners, so it
                        is the only solid button — the rest stay outline. */}
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="primary"
                        className={cn('gap-1.5 font-medium', triggerClassName)}
                        onClick={() => setOpen(true)}
                    >
                        <PaperPlaneTilt size={16} weight="fill" />
                        {t('trigger.releaseResult')}
                    </MyButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('trigger.tooltip')}</TooltipContent>
            </Tooltip>
            {open && (
                <ReleaseResultDialog
                    assessmentId={assessmentId}
                    attemptIds="ALL"
                    open={open}
                    onOpenChange={setOpen}
                    onReleased={onReleased}
                />
            )}
        </>
    );
};
