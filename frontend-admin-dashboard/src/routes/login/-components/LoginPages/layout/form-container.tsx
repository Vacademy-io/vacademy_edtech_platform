import { FormContainerProps } from '@/routes/login/-types/loginTypes';
import LoginImage from '@/assets/svgs/login-image.svg';
import useInstituteLogoStore from '../../../../../components/common/layout-container/sidebar/institutelogo-global-zustand';
import { useTranslation } from 'react-i18next';

export function FormContainer({ children }: FormContainerProps) {
    const { t } = useTranslation('loginFormContainer');
    const { instituteLogo, brandingDisplay } = useInstituteLogoStore();

    const hasCustomDims =
        brandingDisplay.logoWidthPx != null || brandingDisplay.logoHeightPx != null;
    const logoStyle = hasCustomDims
        ? {
              width: brandingDisplay.logoWidthPx ?? undefined,
              height: brandingDisplay.logoHeightPx ?? undefined,
          }
        : undefined;
    // Keep the circular default only when the operator hasn't opted into custom
    // dimensions. With custom dims we use object-contain so wide logos aren't
    // cropped into a circle.
    const logoClass = hasCustomDims
        ? 'object-contain'
        : 'size-12 rounded-full';

    return (
        <div className="flex min-h-screen w-screen bg-white">
            <div className="relative flex w-full items-center justify-center bg-primary-100">
                <div className="absolute left-8 top-8">
                    <img src={instituteLogo} alt={t('logoAlt')} className={logoClass} style={logoStyle} />
                </div>
                <LoginImage />
            </div>
            <div className="relative flex w-full items-center justify-center text-neutral-600">
                {/* <LanguageDropdown /> */}
                <div className="w-[500px] items-center justify-center">{children}</div>
            </div>
        </div>
    );
}
