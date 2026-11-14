import { Separator } from '@/components/ui/separator';
import { VacademyAssessLogo, VacademyLMSLogo } from '@/svgs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateOnboardingSidebar } from './CreateOnboardingSidebar';
import { OnboardingSteps } from './OnboardingSteps';
import { Route } from '..';
import VacademyVoltLogo from '@/components/core/volt-logo';
import VacademyVSmartLogo from '@/components/core/vsmart-logo';
// import { handleOAuthCallback } from '@/hooks/signup/oauth-signup'; // ✅ Make sure this path is correct
// import { toast } from 'sonner';

export function OnboardingComponent() {
    const { t } = useTranslation('signupOnboardingComponent');
    const searchParams = Route.useSearch();
    const steps = [
        t('steps.organizationSetup'),
        t('steps.organizationTheme'),
        t('steps.addYourDetails'),
    ];
    const [currentStep, setCurrentStep] = useState(0);
    const [completedSteps, setCompletedSteps] = useState([false, false]);

    const completeCurrentStep = () => {
        setCompletedSteps((prev) => {
            const updated = [...prev];
            updated[currentStep] = true;
            return updated;
        });
        if (currentStep < steps.length - 1) {
            setCurrentStep((prev) => prev + 1);
        }
    };

    const goToStep = (index: number) => {
        if (index <= currentStep || completedSteps[index - 1]) {
            setCurrentStep(index);
        }
    };

    // // ✅ OAuth Callback & OTP Verification Handling
    // useEffect(() => {
    //     const checkOAuth = async () => {
    //         const result = await handleOAuthCallback();

    //         if (result?.success) {
    //             console.log('✅ OAuth Verified:', result.signupData);
    //             // Optional: store result.signupData in global state
    //         } else if (result?.reason === 'unverified_email') {
    //             console.warn('⚠️ OTP modal was closed without verification.');
    //             toast.warning('Email verification required to continue.');
    //             // Optional: redirect or halt progress
    //         } else {
    //             console.error('❌ OAuth Callback Failed or Skipped.');

    //         }
    //     };

    //     checkOAuth();
    // }, []);

    return (
        <div className="flex min-h-screen w-full flex-col lg:flex-row">
            <div className="flex w-full flex-col items-center justify-center bg-primary-50 p-4 lg:w-1/2 lg:p-0">
                <div>
                    <div className="grid grid-cols-2 gap-2 lg:gap-4">
                        {searchParams.assess && <VacademyAssessLogo className="w-24 lg:w-auto" />}
                        {searchParams.lms && <VacademyLMSLogo className="w-24 lg:w-auto" />}
                        {searchParams.volt && <VacademyVoltLogo className="w-24 lg:w-auto" />}
                        {searchParams.vsmart && <VacademyVSmartLogo className="w-24 lg:w-auto" />}
                    </div>
                    <p className="mt-2 text-sm lg:text-base">{t('fastTrackTagline')}</p>
                    <Separator className="my-2 lg:my-6" />
                    <CreateOnboardingSidebar
                        steps={steps}
                        currentStep={currentStep}
                        completedSteps={completedSteps}
                        onStepClick={goToStep}
                    />
                </div>
            </div>
            <div className="flex w-full items-center justify-center p-8 lg:w-1/2 lg:p-0">
                <OnboardingSteps
                    currentStep={currentStep}
                    handleCompleteCurrentStep={completeCurrentStep}
                    completedSteps={completedSteps}
                />
            </div>
        </div>
    );
}
