import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { WarningCircle } from '@phosphor-icons/react';
import { GuardianLinkPanel } from './GuardianLinkPanel';
import { ParentLinkChoice, SelectedLearner } from '../../../-types/bulk-assign-types';

interface Props {
    learner: SelectedLearner;
    index: number;
    instituteId: string;
    onChange: (next: ParentLinkChoice) => void;
    /** Inline error surfaced after a failed resolution attempt (see resolveStep1GuardianLinks in BulkAssignDialog). */
    error?: string;
}

/**
 * Per-chip guardian-link controls: an "Is this a guardian?" switch (which
 * reveals a mandatory student create/link sub-form), plus an optional
 * "+ Add Guardian" action (which reveals an optional guardian create/link
 * sub-form).
 *
 * "Is this a guardian?" is available for `new` (not-yet-created) chips too:
 * /parent-link/v1/link-new-guardian creates the guardian fresh from the
 * chip's own manually-entered name/email/mobile, so there's no need for a
 * real anchor user id up front (see resolveStep1GuardianLinks in
 * BulkAssignDialog). "+ Add Guardian" (the other mode) still needs the chip
 * itself to become a real enrolled user first, so that one stays gated on
 * `canAddGuardian` below.
 */
export const LearnerGuardianControls = ({ learner, index, instituteId, onChange, error }: Props) => {
    const { t } = useTranslation('manageStudentsLearnerGuardianControls');
    const parentLink: ParentLinkChoice = learner.parentLink ?? { mode: 'none' };
    const isGuardianOn = parentLink.mode === 'is_guardian';
    const isAddGuardianOn = parentLink.mode === 'add_guardian';
    const [addGuardianOpen, setAddGuardianOpen] = useState(isAddGuardianOn);

    const isNewChip = learner.type === 'new';
    const chipEmail = learner.type === 'existing' ? learner.email : learner.newUser.email;
    const canAddGuardian = !isNewChip || !!chipEmail?.trim();

    const idBase = `learner-${index}`;

    const handleToggleIsGuardian = (checked: boolean) => {
        setAddGuardianOpen(false);
        onChange(
            checked
                ? {
                      mode: 'is_guardian',
                      student: { kind: 'create_new', fullName: '', email: '', mobileNumber: '' },
                  }
                : { mode: 'none' }
        );
    };

    const openAddGuardian = () => {
        setAddGuardianOpen(true);
        onChange({
            mode: 'add_guardian',
            guardian: { kind: 'create_new', fullName: '', email: '', mobileNumber: '' },
        });
    };

    const closeAddGuardian = () => {
        setAddGuardianOpen(false);
        onChange({ mode: 'none' });
    };

    return (
        <div className="mt-2 border-t border-neutral-100 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Switch
                        id={`${idBase}-is-guardian`}
                        checked={isGuardianOn}
                        onCheckedChange={handleToggleIsGuardian}
                    />
                    <Label
                        htmlFor={`${idBase}-is-guardian`}
                        className="cursor-pointer text-caption text-neutral-600"
                    >
                        {t('toggle.isGuardianLabel')}
                    </Label>
                </div>

                {!isGuardianOn && !addGuardianOpen && (
                    <button
                        type="button"
                        onClick={openAddGuardian}
                        disabled={!canAddGuardian}
                        className="text-caption font-medium text-primary-600 hover:text-primary-800 disabled:cursor-not-allowed disabled:text-neutral-300"
                    >
                        {t('toggle.addGuardianButton')}
                    </button>
                )}
                {addGuardianOpen && !isGuardianOn && (
                    <button
                        type="button"
                        onClick={closeAddGuardian}
                        className="text-caption text-neutral-400 hover:text-danger-500"
                    >
                        {t('toggle.removeGuardianButton')}
                    </button>
                )}
            </div>

            {!isNewChip && !canAddGuardian && (
                <p className="mt-1 text-caption text-neutral-400">
                    {t('hints.emailRequired')}
                </p>
            )}

            {isGuardianOn && (
                <div className="mt-2">
                    <p className="mb-1 text-caption font-medium text-neutral-500">
                        {t('hints.linkStudentPrompt')}
                    </p>
                    <GuardianLinkPanel
                        instituteId={instituteId}
                        personLabel={t('personLabels.student')}
                        searchRoles={['STUDENT']}
                        value={parentLink.mode === 'is_guardian' ? parentLink.student : undefined}
                        onChange={(student) => onChange({ mode: 'is_guardian', student })}
                    />
                </div>
            )}

            {addGuardianOpen && !isGuardianOn && (
                <div className="mt-2">
                    <p className="mb-1 text-caption font-medium text-neutral-500">
                        {t('hints.linkGuardianPrompt')}
                    </p>
                    <GuardianLinkPanel
                        instituteId={instituteId}
                        personLabel={t('personLabels.guardian')}
                        searchRoles={['PARENT']}
                        value={parentLink.mode === 'add_guardian' ? parentLink.guardian : undefined}
                        onChange={(guardian) => onChange({ mode: 'add_guardian', guardian })}
                    />
                </div>
            )}

            {error && (
                <p className="mt-1 flex items-center gap-1 text-caption text-danger-600">
                    <WarningCircle size={12} />
                    {error}
                </p>
            )}
        </div>
    );
};
