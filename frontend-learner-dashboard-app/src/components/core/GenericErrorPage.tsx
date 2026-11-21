import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react';
import { House, SignOut, WarningCircle, CheckCircle, ShieldCheck } from '@phosphor-icons/react';
import { MyButton } from '../design-system/button';
import { removeTokensAndLogout } from '@/lib/auth/sessionUtility';
import { ErrorFeedbackDialog } from './error-feedback-dialog';

interface Props {
    error?: unknown;
}

export function GenericErrorPage({ error }: Props) {
    const { t } = useTranslation('courseComponentsExtra');
    const router = useRouter();
    const navigate = useNavigate();
    const [eventId, setEventId] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (error && import.meta.env.VITE_ENABLE_SENTRY === 'true') {
            const id = Sentry.captureException(error);
            setEventId(id);
        }
    }, [error]);

    return (
        <>
            <Helmet>
                <title>{t('genericErrorPage.title')}</title>
            </Helmet>

            <div className="h-screen w-full bg-gray-50 overflow-y-auto flex flex-col justify-center items-center px-4 py-12 sm:px-6 lg:px-8">
                <div className="max-w-md mx-auto text-center w-full">
                    <div className="mb-8 flex justify-center">
                        <div className="relative">
                            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-red-100 border-4 border-white shadow-sm">
                                <WarningCircle className="h-12 w-12 text-red-600" aria-hidden="true" />
                            </div>
                            <div className="absolute -bottom-2 -end-2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md border border-gray-100">
                                <ShieldCheck className="h-5 w-5 text-gray-500" aria-hidden="true" />
                            </div>
                        </div>
                    </div>

                    <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{t('genericErrorPage.title')}</h1>
                    <p className="mt-4 text-base text-gray-500 max-w-md mx-auto">
                        {t('genericErrorPage.description')}
                    </p>

                    <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 text-start max-w-md mx-auto shadow-sm">
                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            {t('common.recommendedSteps')}
                        </h3>
                        <ul className="mt-3 space-y-3 text-sm text-gray-600">
                            <li className="flex gap-3">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 font-medium text-xs">1</span>
                                <span>{t('genericErrorPage.step1')}</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 font-medium text-xs">2</span>
                                <span>
                                    {t('genericErrorPage.step2Prefix')}{' '}
                                    <strong className="font-semibold text-gray-900">{t('genericErrorPage.step2Emphasis')}</strong>
                                    {' '}{t('genericErrorPage.step2Suffix')}
                                </span>
                            </li>
                        </ul>
                    </div>

                    {!!error && process.env.NODE_ENV === 'development' && (
                        <div className="mt-6 mx-auto max-w-xl text-start bg-white rounded-lg border border-gray-200 p-4 shadow-sm overflow-auto max-h-48 space-y-2">
                            <p className="text-xs font-semibold text-gray-500">{t('common.errorDetailsDevOnly')}</p>
                            <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all">
                                {String(error)}
                            </pre>
                        </div>
                    )}

                    <div className="mt-8 flex flex-col sm:flex-row gap-stack justify-center">
                        <MyButton
                            asChild
                            className="w-full sm:w-auto"
                        >
                            <Link to="/dashboard">
                                <House className="me-2 h-4 w-4" />
                                {t('common.returnHome')}
                            </Link>
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            className="w-full sm:w-auto"
                            onClick={() => router.history.back()}
                        >
                            {t('common.goBack')}
                        </MyButton>
                        <ErrorFeedbackDialog
                            error={error as Error}
                            eventId={eventId}
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

                    <div className="mt-6 border-t border-gray-200 pt-6 flex justify-center">
                        <button
                            onClick={() => {
                                removeTokensAndLogout();
                                navigate({ to: '/login' });
                            }}
                            className="text-sm font-medium text-gray-500 hover:text-gray-900 inline-flex items-center gap-2 transition-colors"
                        >
                            <SignOut className="h-4 w-4" />
                            {t('common.signOut')}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
