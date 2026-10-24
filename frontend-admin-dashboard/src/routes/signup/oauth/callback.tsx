import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { handleOAuthCallback } from '@/hooks/signup/oauth-signup';
import { useTranslation } from 'react-i18next';

function OAuthCallbackPage() {
    const { t } = useTranslation('signupOauthCallback');
    const navigate = useNavigate();

    useEffect(() => {
        const processOAuth = async () => {
            const result = await handleOAuthCallback();

            if (result.success) {
                toast.success(t('authSuccess'));

                if (result.signupData) {
                    navigate({
                        to: '/signup/onboarding',
                        search: {
                            assess: result.state?.includes('assess') ?? false,
                            lms: result.state?.includes('lms') ?? false,
                            signupData: btoa(JSON.stringify(result.signupData)),
                        },
                    });
                } else {
                    navigate({ to: '/dashboard' });
                }
            } else {
                toast.error(t('authFailed'));
                navigate({ to: '/signup' });
            }
        };

        processOAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
            {/* <div className="space-y-4 text-center">
                <div className="relative flex justify-center">
                    <div className="size-12 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
                    <span className="sr-only">Loading...</span>
                </div>
                <h2 className="text-base font-semibold text-gray-800 dark:text-white">
                    We're getting things ready...
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-300">
                    Finalizing your login, hang tight!
                </p>
            </div> */}
        </div>
    );
}

export const Route = createFileRoute('/signup/oauth/callback')({
    component: OAuthCallbackPage,
});
