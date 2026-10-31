import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Plus, TrashSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
    StudentManagementActionSettings,
    StudentHeaderCustomButton,
    StudentHeaderButtonKind,
} from '@/types/display-settings';

interface StudentManagementActionsCardProps {
    settings: StudentManagementActionSettings | undefined;
    onChange: (next: StudentManagementActionSettings) => void;
}

const buildButtonKindOptions = (
    t: TFunction
): {
    value: StudentHeaderButtonKind;
    label: string;
    hint: string;
}[] => [
    {
        value: 'url',
        label: t('customButtons.kindOptions.url.label'),
        hint: t('customButtons.kindOptions.url.hint'),
    },
    {
        value: 'suborg_learner_invite',
        label: t('customButtons.kindOptions.suborgLearnerInvite.label'),
        hint: t('customButtons.kindOptions.suborgLearnerInvite.hint'),
    },
    {
        value: 'course_invite',
        label: t('customButtons.kindOptions.courseInvite.label'),
        hint: t('customButtons.kindOptions.courseInvite.hint'),
    },
];

// Stable id for a new custom button. crypto.randomUUID where available, with a
// timestamp fallback for older runtimes.
const genButtonId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `btn-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

export const StudentManagementActionsCard = ({
    settings,
    onChange,
}: StudentManagementActionsCardProps) => {
    const { t } = useTranslation('settingsStudentManagementActionsCard');
    const buttonKindOptions = buildButtonKindOptions(t);
    const showEnrollButton = settings?.showEnrollButton !== false;
    const showInviteButton = settings?.showInviteButton !== false;
    const customButtons = settings?.customButtons ?? [];

    // Always emit the full object so nothing this card owns is dropped on save.
    const patch = (partial: Partial<StudentManagementActionSettings>) =>
        onChange({
            showEnrollButton,
            showInviteButton,
            customButtons,
            ...partial,
        });

    const updateButton = (id: string, changes: Partial<StudentHeaderCustomButton>) =>
        patch({
            customButtons: customButtons.map((b) => (b.id === id ? { ...b, ...changes } : b)),
        });

    const addButton = () =>
        patch({
            customButtons: [
                ...customButtons,
                { id: genButtonId(), label: '', kind: 'url', url: '', openInNewTab: true },
            ],
        });

    const removeButton = (id: string) =>
        patch({ customButtons: customButtons.filter((b) => b.id !== id) });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-4 border-b border-border py-3.5">
                    <div className="text-sm font-medium text-neutral-800">
                        {t('showEnrollButton')}
                    </div>
                    <Switch
                        checked={showEnrollButton}
                        onCheckedChange={(checked) => patch({ showEnrollButton: checked })}
                    />
                </div>
                <div className="flex items-center justify-between gap-4 border-b border-border py-3.5">
                    <div className="text-sm font-medium text-neutral-800">
                        {t('showInviteButton')}
                    </div>
                    <Switch
                        checked={showInviteButton}
                        onCheckedChange={(checked) => patch({ showInviteButton: checked })}
                    />
                </div>

                <div className="space-y-3 pt-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('customButtons.title')}
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={addButton}
                            className="flex items-center gap-1"
                        >
                            <Plus className="size-4" />
                            {t('customButtons.addButton')}
                        </MyButton>
                    </div>

                    {customButtons.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-500">
                            {t('customButtons.empty')}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {customButtons.map((btn) => {
                                const kind: StudentHeaderButtonKind = btn.kind ?? 'url';
                                const kindMeta =
                                    buttonKindOptions.find((o) => o.value === kind) ??
                                    buttonKindOptions[0]!;
                                return (
                                    <div
                                        key={btn.id}
                                        className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3"
                                    >
                                        <div className="flex items-end gap-2">
                                            <div className="flex flex-1 flex-col gap-1">
                                                <Label className="text-subtitle font-regular">
                                                    {t('customButtons.buttonType.label')}
                                                </Label>
                                                <Select
                                                    value={kind}
                                                    onValueChange={(v) =>
                                                        updateButton(btn.id, {
                                                            kind: v as StudentHeaderButtonKind,
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger className="h-9">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {buttonKindOptions.map((o) => (
                                                            <SelectItem key={o.value} value={o.value}>
                                                                {o.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <MyButton
                                                type="button"
                                                layoutVariant="icon"
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => removeButton(btn.id)}
                                                className="shrink-0 text-danger-600 hover:border-danger-400"
                                            >
                                                <TrashSimple className="size-4" />
                                            </MyButton>
                                        </div>

                                        <MyInput
                                            label={t('customButtons.label.label')}
                                            inputType="text"
                                            inputPlaceholder={t('customButtons.label.placeholder')}
                                            input={btn.label}
                                            onChangeFunction={(e) =>
                                                updateButton(btn.id, { label: e.target.value })
                                            }
                                            className="sm:w-full"
                                        />

                                        {kind === 'url' ? (
                                            <MyInput
                                                label={t('customButtons.url.label')}
                                                inputType="text"
                                                inputPlaceholder={t(
                                                    'customButtons.url.placeholder'
                                                )}
                                                input={btn.url ?? ''}
                                                onChangeFunction={(e) =>
                                                    updateButton(btn.id, { url: e.target.value })
                                                }
                                                className="sm:w-full"
                                            />
                                        ) : (
                                            <p className="text-xs text-neutral-500">
                                                {kindMeta.hint}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
