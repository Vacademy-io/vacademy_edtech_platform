import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { BookOpen, GraduationCap, Users } from '@phosphor-icons/react';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { useTranslation } from 'react-i18next';

interface LearnerTabProps {
    onClose: () => void;
}

export function LearnerTab({ onClose }: LearnerTabProps) {
    const { t } = useTranslation('dashboardLearnerTab');

    const handleSwitchToLearner = () => {
        // Navigate to learner platform
        window.location.href = BASE_URL_LEARNER_DASHBOARD;
    };

    const handleContinueAsAdmin = () => {
        // Remove the learner tab parameter and continue as admin
        const url = new URL(window.location.href);
        url.searchParams.delete('showLearnerTab');
        window.history.replaceState({}, document.title, url.toString());
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-blue-100">
                        <GraduationCap className="size-8 text-blue-600" />
                    </div>
                    <CardTitle className="text-xl">{t('header.title')}</CardTitle>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-3">
                        <div className="flex items-center space-x-3 rounded-lg border p-3">
                            <div className="flex size-10 items-center justify-center rounded-full bg-green-100">
                                <BookOpen className="size-5 text-green-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-medium">{t('options.learner.title')}</h3>
                                <p className="text-sm text-gray-500">
                                    {t('options.learner.description')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center space-x-3 rounded-lg border p-3">
                            <div className="flex size-10 items-center justify-center rounded-full bg-purple-100">
                                <Users className="size-5 text-purple-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-medium">{t('options.admin.title')}</h3>
                                <p className="text-sm text-gray-500">
                                    {t('options.admin.description')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex space-x-3">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            layoutVariant="default"
                            onClick={handleSwitchToLearner}
                            className="flex-1"
                        >
                            <BookOpen className="mr-2 size-4" />
                            {t('actions.goToLearnerPortal')}
                        </MyButton>

                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="secondary"
                            layoutVariant="default"
                            onClick={handleContinueAsAdmin}
                            className="flex-1"
                        >
                            <Users className="mr-2 size-4" />
                            {t('actions.stayAsAdmin')}
                        </MyButton>
                    </div>

                    <div className="text-center">
                        <button
                            type="button"
                            onClick={handleContinueAsAdmin}
                            className="text-sm text-gray-500 hover:text-gray-700"
                        >
                            {t('actions.dontShowAgain')}
                        </button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
