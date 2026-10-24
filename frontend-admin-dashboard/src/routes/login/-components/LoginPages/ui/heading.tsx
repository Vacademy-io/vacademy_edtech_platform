import { HeadingProps } from '../../../-types/loginTypes';
import { useTranslation } from 'react-i18next';

export const Heading = ({ heading, subHeading }: HeadingProps) => {
    const { t } = useTranslation('loginHeading');
    return (
        <div className="flex w-full flex-col gap-2 text-neutral-600">
            <div className="w-full text-center text-h3 font-semibold">{heading}</div>
            <div className="w-full text-center">
                {/* NOTE: 'Set New Password' is compared exactly against the heading prop
                    passed in from callers — left untranslated per i18n rollout safety rules. */}
                {heading == 'Set New Password' ? (
                    <div>
                        {t('secureAccountPrefix')} <span className="text-primary-500">{t('emailWord')}</span> {t('secureAccountSuffix')}
                    </div>
                ) : (
                    <div className="text-subtitle font-regular">{subHeading}</div>
                )}
            </div>
        </div>
    );
};
