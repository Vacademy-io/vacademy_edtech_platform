import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';

interface EditLiveLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentLink: string;
    onUpdate: (newLink: string) => void;
}

const EditLiveLinkDialog: React.FC<EditLiveLinkDialogProps> = ({
    open,
    onOpenChange,
    currentLink,
    onUpdate,
}) => {
    const { t } = useTranslation('dashboardEditLiveLinkDialog');
    const [newLink, setNewLink] = useState('');

    useEffect(() => {
        if (!open) {
            setNewLink('');
        }
    }, [open]);

    return (
        <MyDialog open={open} onOpenChange={onOpenChange} heading={t('heading')}>
            <div className="flex flex-col gap-4 p-4">
                <div>
                    <label className="text-sm font-medium mb-1">{t('currentLinkLabel')}</label>
                    <input
                        type="text"
                        className="rounded border bg-gray-50 px-2 py-1 text-sm w-full"
                        value={currentLink}
                        readOnly
                    />
                </div>
                <div>
                    <label className="text-sm font-medium mb-1">{t('newLinkLabel')}</label>
                    <input
                        type="text"
                        className="rounded border bg-gray-50 px-2 py-1 text-sm w-full"
                        value={newLink}
                        onChange={(e) => setNewLink(e.target.value)}
                        placeholder={t('newLinkPlaceholder')}
                    />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                    <MyButton onClick={() => onOpenChange(false)}>{t('actions.cancel')}</MyButton>
                    <MyButton onClick={() => onUpdate(newLink)} disable={!newLink} buttonType="primary">
                        {t('actions.update')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

export default EditLiveLinkDialog;
