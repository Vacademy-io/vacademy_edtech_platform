/**
 * "Present live" confirmation with the two session options a teacher changes in
 * class: the per-question timer and the end-of-session leaderboard. Everything
 * else uses the admin defaults (SessionOptionModel.tsx:38-48).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Broadcast } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { DEFAULT_SESSION_OPTIONS } from './voltApi';
import type { VoltSessionOptions } from './types';

const TIMER_CHOICES = [0, 30, 60, 90, 120];

function Choice({
    selected,
    label,
    onSelect,
}: {
    selected: boolean;
    label: string;
    onSelect: () => void;
}) {
    return (
        <MyButton
            buttonType={selected ? 'primary' : 'secondary'}
            scale="large"
            className="h-16 px-6 sm:min-w-0"
            aria-pressed={selected}
            onClick={onSelect}
        >
            {label}
        </MyButton>
    );
}

export interface LiveSessionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (options: Partial<VoltSessionOptions>) => Promise<void>;
}

export function LiveSessionDialog({ open, onOpenChange, onConfirm }: LiveSessionDialogProps) {
    const { t } = useTranslation('volt');
    const [seconds, setSeconds] = useState(DEFAULT_SESSION_OPTIONS.default_seconds_for_question);
    const [leaderboard, setLeaderboard] = useState(
        DEFAULT_SESSION_OPTIONS.show_results_at_last_slide
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-11/12 max-w-3xl p-8">
                <DialogHeader className="space-y-3">
                    <DialogTitle className="flex items-center space-x-3 text-h2 font-semibold text-neutral-800">
                        <Broadcast size={36} className="text-primary-500" aria-hidden />
                        <span>{t('liveDialog.title')}</span>
                    </DialogTitle>
                    <DialogDescription className="text-title text-neutral-600">
                        {t('liveDialog.body')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-8 pt-6">
                    <fieldset className="space-y-3">
                        <legend className="text-h3 font-semibold text-neutral-800">
                            {t('liveDialog.timer')}
                        </legend>
                        <div className="grid grid-cols-5 gap-3">
                            {TIMER_CHOICES.map((value) => (
                                <Choice
                                    key={value}
                                    selected={seconds === value}
                                    label={
                                        value === 0
                                            ? t('liveDialog.timerOff')
                                            : t('liveDialog.seconds', { count: value })
                                    }
                                    onSelect={() => setSeconds(value)}
                                />
                            ))}
                        </div>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-h3 font-semibold text-neutral-800">
                            {t('liveDialog.leaderboard')}
                        </legend>
                        <div className="grid grid-cols-2 gap-3">
                            <Choice
                                selected={leaderboard}
                                label={t('liveDialog.leaderboardOn')}
                                onSelect={() => setLeaderboard(true)}
                            />
                            <Choice
                                selected={!leaderboard}
                                label={t('liveDialog.leaderboardOff')}
                                onSelect={() => setLeaderboard(false)}
                            />
                        </div>
                    </fieldset>
                </div>

                <DialogFooter className="pt-8 sm:space-x-4">
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel', { ns: 'panel' })}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="h-16 px-8"
                        onAsyncClick={() =>
                            onConfirm({
                                default_seconds_for_question: seconds,
                                show_results_at_last_slide: leaderboard,
                            })
                        }
                    >
                        {t('liveDialog.confirm')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default LiveSessionDialog;
