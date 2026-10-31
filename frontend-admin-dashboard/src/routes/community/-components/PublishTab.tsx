import { MyButton } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';

export const PublishTab = () => {
    const { t } = useTranslation('communityPublishTab');
    return (
        <div className="border-b">
            <div className="mx-8 my-4 flex flex-row items-center justify-between">
                <div className="text-h3">{t('collaborativeCorner')}</div>
                <div>
                    <MyButton>{t('publish')}</MyButton>
                </div>
            </div>
        </div>
    );
};
