import { Link } from '@tanstack/react-router';
import { ArrowsClockwise, Gear, Wrench } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '../design-system/button';
import { ErrorFeedbackDialog } from './error-feedback-dialog';

export function NetworkErrorPage() {
    const { t } = useTranslation('courseComponentsExtra');
    return (
        <div className="h-screen w-full bg-gray-50 overflow-y-auto flex flex-col justify-center items-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="max-w-md mx-auto text-center w-full">
                <div className="mb-8 flex justify-center">
                    <div className="relative">
                        {/* Main Settings/Gear Icon Container */}
                        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-amber-100 border-4 border-white shadow-sm">
                            <Gear className="h-12 w-12 text-amber-600 animate-[spin_8s_linear_infinite]" aria-hidden="true" />
                        </div>
                        {/* Overlapping Badge */}
                        <div className="absolute -bottom-2 -end-2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md border border-gray-100">
                            <Wrench className="h-5 w-5 text-gray-600" aria-hidden="true" />
                        </div>
                    </div>
                </div>
                
                <p className="text-sm font-semibold text-amber-600 uppercase tracking-wide">{t('networkErrorPage.underMaintenance')}</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{t('networkErrorPage.title')}</h1>
                <p className="mt-4 text-base text-gray-500 max-w-md mx-auto">
                    {t('networkErrorPage.description')}
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-stack justify-center">
                    <MyButton
                        className="w-full sm:w-auto"
                        onClick={() => window.location.reload()}
                    >
                        <ArrowsClockwise className="me-2 h-4 w-4" />
                        {t('common.tryAgain')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        asChild
                        className="w-full sm:w-auto"
                    >
                        <Link to="/dashboard">{t('common.returnHome')}</Link>
                    </MyButton>
                    <ErrorFeedbackDialog
                        trigger={
                            <MyButton
                                buttonType="secondary"
                                className="w-full sm:w-auto"
                            >
                                {t('common.reportIssue')}
                            </MyButton>
                        }
                    />
                </div>
            </div>
        </div>
    );
}
