import { useTranslation } from 'react-i18next';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploadField } from '@/routes/manage-pages/-components/ImageUploadField';

export interface FolderDraft {
    name: string;
    description: string;
    image_url: string;
    visible: boolean;
}

export const EMPTY_FOLDER_DRAFT: FolderDraft = {
    name: '',
    description: '',
    image_url: '',
    visible: true,
};

/** Name, description, image and visibility of an assessment folder. */
export const FolderFormFields = ({
    value,
    onChange,
    showVisibility = true,
    autoFocus = true,
}: {
    value: FolderDraft;
    onChange: (patch: Partial<FolderDraft>) => void;
    showVisibility?: boolean;
    autoFocus?: boolean;
}) => {
    const { t } = useTranslation('assessmentFolders');
    return (
        <div className="flex flex-col gap-4">
            <MyInput
                label={t('form.name')}
                required
                inputType="text"
                input={value.name}
                maxLength={255}
                autoFocus={autoFocus}
                inputPlaceholder={t('form.namePlaceholder')}
                onChangeFunction={(e) => onChange({ name: e.target.value })}
                className="w-full sm:w-full"
            />
            <div className="flex flex-col gap-1">
                <Label className="text-subtitle font-regular">{t('form.description')}</Label>
                <Textarea
                    rows={2}
                    maxLength={2000}
                    value={value.description}
                    placeholder={t('form.descriptionPlaceholder')}
                    onChange={(e) => onChange({ description: e.target.value })}
                />
            </div>
            <ImageUploadField
                slot="card"
                label={t('form.image')}
                value={value.image_url}
                onChange={(url) => onChange({ image_url: url })}
                placeholder={t('form.imagePlaceholder')}
            />
            {showVisibility ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2">
                    <div>
                        <p className="text-sm font-medium text-neutral-700">{t('form.visible')}</p>
                        <p className="text-caption text-neutral-500">{t('form.visibleHint')}</p>
                    </div>
                    <Switch
                        checked={value.visible}
                        onCheckedChange={(visible) => onChange({ visible })}
                    />
                </div>
            ) : null}
        </div>
    );
};
