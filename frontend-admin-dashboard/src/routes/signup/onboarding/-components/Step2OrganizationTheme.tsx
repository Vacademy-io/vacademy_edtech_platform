import { MyButton } from '@/components/design-system/button';
import { OrganizationOnboardingProps } from '..';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme/theme-provider';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import useOrganizationStore from '../-zustand-store/step1OrganizationZustand';
import { PRESET_THEMES, getThemeShades } from '@/constants/themes/preset-themes';
import { useTranslation } from 'react-i18next';

const organizationThemeSetup = z.object({
    instituteThemeCode: z.union([z.string(), z.undefined()]),
});

type FormValues = z.infer<typeof organizationThemeSetup>;

const Step2OrganizationTheme: React.FC<OrganizationOnboardingProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('signupOnboardingStep2OrganizationTheme');
    const [selectedTheme, setSelectedTheme] = useState(PRESET_THEMES[0]?.code || 'primary');
    // const [customColor, setCustomColor] = useState('#ED7424');
    // const [openCustomDialog, setOpenCustomDialog] = useState(false);
    const { formData, setFormData } = useOrganizationStore();
    const form = useForm<FormValues>({
        resolver: zodResolver(organizationThemeSetup),
        defaultValues: {
            instituteThemeCode: formData.instituteThemeCode ?? '',
        },
        mode: 'onChange',
    });
    const { setPrimaryColor } = useTheme();

    console.log('Current step:', currentStep);
    console.log('Completed steps:', completedSteps);

    const handleThemeSelect = (code: string) => {
        setSelectedTheme(code);
        setPrimaryColor(code);
        setFormData({ ...formData, instituteThemeCode: code });
        form.setValue('instituteThemeCode', code);
    };

    // const handleCustomColorSubmit = () => {
    //     setSelectedTheme(customColor);
    //     setPrimaryColor(customColor);
    //     setFormData({ ...formData, instituteThemeCode: customColor });
    //     form.setValue('instituteThemeCode', customColor);
    //     setOpenCustomDialog(false);
    // };

    return (
        <div className="my-6 flex w-full max-w-3xl flex-col items-center justify-center gap-4 p-4">
            <h1 className="mb-4 text-[1.6rem]">{t('heading')}</h1>

            <div className="mb-20 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:mb-2">
                {PRESET_THEMES.map((theme) => {
                    const shades = getThemeShades(theme.code);
                    return (
                        <div
                            key={theme.name}
                            role="button"
                            onClick={() => handleThemeSelect(theme.code)}
                            className={cn(
                                'overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md',
                                selectedTheme === theme.code
                                    ? 'ring-2 ring-primary-500 ring-offset-2'
                                    : 'ring-1 ring-gray-200'
                            )}
                            aria-label={t('selectThemeAriaLabel', { themeName: theme.name })}
                        >
                            <div className="flex flex-col">
                                {shades?.map((shade, index) => (
                                    <div
                                        key={index}
                                        className="h-7"
                                        style={{ backgroundColor: shade }} // design-lint-ignore: data-driven palette swatch
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Custom brand color lives in the full theme editor
                (dashboard → Edit Institute → Change Theme), which also covers
                sidebar, accent, and page-background roles. Onboarding stays a
                one-tap preset choice. */}

            {/* <Dialog open={openCustomDialog} onOpenChange={setOpenCustomDialog}>
                ...
            </Dialog> */}

            <div className="fixed bottom-0 right-0 z-10 flex w-full justify-center border-t bg-white p-4 lg:static lg:w-auto lg:border-none lg:bg-transparent lg:p-0">
                <MyButton
                    type="button"
                    scale="large"
                    buttonType="primary"
                    layoutVariant="default"
                    onClick={() => {
                        handleCompleteCurrentStep();
                    }}
                    className="w-full max-w-sm lg:w-auto"
                >
                    {t('continue')}
                </MyButton>
            </div>
        </div>
    );
};

// For custom colors, we still need a function to generate shades
// This is only used for the preview in the custom color dialog
// const getCustomColorShades = (hexColor: string) => {
//     // Convert hex to RGB
//     const r = Number.parseInt(hexColor.slice(1, 3), 16);
//     const g = Number.parseInt(hexColor.slice(3, 5), 16);
//     const b = Number.parseInt(hexColor.slice(5, 7), 16);

//     return [
//         hexColor, // Original
//         `rgb(${Math.floor(r * 0.8)}, ${Math.floor(g * 0.8)}, ${Math.floor(b * 0.8)})`, // Darker
//         `rgb(${Math.floor(r * 0.6)}, ${Math.floor(g * 0.6)}, ${Math.floor(b * 0.6)})`, // Even darker
//         `rgb(${Math.floor(r * 0.4)}, ${Math.floor(g * 0.4)}, ${Math.floor(b * 0.4)})`,
//         `rgb(${Math.floor(r * 0.2)}, ${Math.floor(g * 0.2)}, ${Math.floor(b * 0.2)})`,
//     ];
// };

export default Step2OrganizationTheme;
