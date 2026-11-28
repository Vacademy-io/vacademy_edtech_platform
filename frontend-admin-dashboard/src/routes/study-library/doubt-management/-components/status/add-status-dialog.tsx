import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { ColorPicker } from '@/components/ui/color-picker';
import { DoubtStatusKind } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/add-doubt-type';
import {
    DuplicateStatusError,
    statusKeyFromLabel,
    useAddDoubtStatus,
    WorkflowStatusConfig,
} from '../../-services/use-doubt-statuses';

const KINDS: DoubtStatusKind[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/**
 * "Add status" from the board / status picker: name, what it counts as for the learner, optional
 * colour and learner-facing label. Saves straight into the institute's Doubt Management setting
 * (the same list the Settings page edits) and hands the new status back so the caller can use it
 * immediately.
 */
export const AddStatusDialog = ({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: (status: WorkflowStatusConfig) => void;
}) => {
    const { t } = useTranslation('studyLibraryDoubtStatus');
    const add = useAddDoubtStatus();
    const [label, setLabel] = useState('');
    const [kind, setKind] = useState<DoubtStatusKind>('IN_PROGRESS');
    const [color, setColor] = useState('');
    const [learnerLabel, setLearnerLabel] = useState('');
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setLabel('');
        setKind('IN_PROGRESS');
        setColor('');
        setLearnerLabel('');
        setError(null);
    };

    const close = () => {
        reset();
        onOpenChange(false);
    };

    const submit = async () => {
        const name = label.trim();
        if (!name) {
            setError(t('addStatus.nameRequired'));
            return;
        }
        try {
            const created = await add.mutateAsync({
                label: name,
                kind,
                color: color || null,
                learner_label: learnerLabel || null,
            });
            toast.success(t('addStatus.created', { label: created.label }));
            onCreated?.(created);
            close();
        } catch (e) {
            if (e instanceof DuplicateStatusError) {
                setError(t('addStatus.duplicate', { key: e.key }));
            } else {
                toast.error(t('addStatus.failed'));
            }
        }
    };

    return (
        <MyDialog
            heading={t('addStatus.title')}
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={close}>
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!label.trim() || add.isPending}
                        onAsyncClick={submit}
                        loadingText={t('saving')}
                    >
                        {t('addStatus.submit')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-4">
                <div className="flex items-end gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-caption font-medium text-neutral-600">
                            {t('addStatus.color')}
                        </span>
                        <ColorPicker
                            value={color}
                            onChange={setColor}
                            aria-label={t('addStatus.color')}
                            className="size-9"
                        />
                    </div>
                    <MyInput
                        label={t('addStatus.name')}
                        inputPlaceholder={t('addStatus.namePlaceholder')}
                        input={label}
                        onChangeFunction={(e) => {
                            setLabel(e.target.value);
                            setError(null);
                        }}
                        error={error}
                        required
                        size="medium"
                        className="w-full"
                    />
                </div>
                {label.trim() && (
                    <p className="text-caption text-neutral-400">
                        {t('addStatus.keyHint', { key: statusKeyFromLabel(label) })}
                    </p>
                )}
                <label className="flex flex-col gap-1 text-caption font-medium text-neutral-600">
                    {t('addStatus.kind')}
                    <select
                        value={kind}
                        aria-label={t('addStatus.kind')}
                        onChange={(e) => setKind(e.target.value as DoubtStatusKind)}
                        className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-body text-neutral-800 focus:border-primary-400 focus:outline-none"
                    >
                        {KINDS.map((k) => (
                            <option key={k} value={k}>
                                {t(`addStatus.kinds.${k}`)}
                            </option>
                        ))}
                    </select>
                    <span className="font-normal text-neutral-500">
                        {t(`addStatus.kindHint.${kind}`)}
                    </span>
                </label>
                <MyInput
                    label={t('addStatus.learnerLabel')}
                    inputPlaceholder={label.trim() || t('addStatus.learnerLabelPlaceholder')}
                    input={learnerLabel}
                    onChangeFunction={(e) => setLearnerLabel(e.target.value)}
                    size="medium"
                    className="w-full"
                />
            </div>
        </MyDialog>
    );
};
