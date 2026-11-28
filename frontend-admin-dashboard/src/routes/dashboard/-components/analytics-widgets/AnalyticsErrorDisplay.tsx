import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    Warning,
    WarningCircle,
    Info,
    ArrowCounterClockwise,
    ArrowSquareOut,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    getAnalyticsErrorDetails,
    shouldShowRetryButton,
    getErrorIconColor,
} from '../../-utils/analytics-error-handler';

interface AnalyticsErrorDisplayProps {
    error: any;
    widgetName: string;
    onRetry?: () => void;
    fallbackIcon?: React.ComponentType<React.ComponentProps<'svg'>>;
    compact?: boolean;
}

export const AnalyticsErrorDisplay: React.FC<AnalyticsErrorDisplayProps> = ({
    error,
    widgetName,
    onRetry,
    fallbackIcon: FallbackIcon,
    compact = false,
}) => {
    const { t } = useTranslation(['dashboardAnalyticsErrorDisplay', 'dashboardAnalyticsErrorHandler']);
    const errorDetails = getAnalyticsErrorDetails(error, t);
    const showRetryButton = shouldShowRetryButton(error, t) && onRetry;

    const getErrorIcon = () => {
        switch (errorDetails.iconType) {
            case 'warning':
                return Warning;
            case 'error':
                return WarningCircle;
            case 'info':
                return Info;
            default:
                return FallbackIcon || WarningCircle;
        }
    };

    const ErrorIcon = getErrorIcon();
    const iconColor = getErrorIconColor(errorDetails.iconType);

    const handleRefreshPage = () => {
        window.location.reload();
    };

    const handleLoginRedirect = () => {
        // Redirect to login page
        window.location.href = '/login';
    };

    const getActionButton = () => {
        if (errorDetails.actionRequired) {
            // For 511 and auth errors, show refresh/login options
            if (
                error?.response?.status === 511 ||
                error?.message?.includes('authentication required') ||
                error?.message?.includes('log in again')
            ) {
                return (
                    <div className="mt-3 flex gap-2">
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            layoutVariant="default"
                            className="flex items-center gap-1 text-xs"
                            onClick={handleRefreshPage}
                        >
                            <ArrowCounterClockwise size={12} />
                            {t('actions.refreshPage')}
                        </MyButton>
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="primary"
                            layoutVariant="default"
                            className="flex items-center gap-1 text-xs"
                            onClick={handleLoginRedirect}
                        >
                            <ArrowSquareOut size={12} />
                            {t('actions.login')}
                        </MyButton>
                    </div>
                );
            }
        }

        if (showRetryButton) {
            return (
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    layoutVariant="default"
                    className="mt-3 flex items-center gap-1 text-xs"
                    onClick={onRetry}
                >
                    <ArrowCounterClockwise size={12} />
                    {t('actions.tryAgain')}
                </MyButton>
            );
        }

        return null;
    };

    if (compact) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-center py-4"
            >
                <div className="text-center">
                    <ErrorIcon size={24} className={`mx-auto mb-2 ${iconColor}`} />
                    <p className="text-xs text-gray-600">{errorDetails.message}</p>
                    {getActionButton()}
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="py-8 text-center"
        >
            <ErrorIcon size={32} className={`mx-auto mb-3 ${iconColor}`} />
            <h4 className="mb-1 font-medium text-gray-800">
                {t('errorMessage', { widgetName })}
            </h4>
            <p className="mb-2 text-sm text-gray-600">{errorDetails.message}</p>

            {/* Additional context for 511 errors */}
            {error?.response?.status === 511 && (
                <p className="mb-2 text-xs text-amber-600">{t('sessionExpiredNotice')}</p>
            )}

            {getActionButton()}

            {/* Debug info in development */}
            {process.env.NODE_ENV === 'development' && (
                <details className="mt-4 text-left">
                    <summary className="cursor-pointer text-xs text-gray-500">
                        {t('debugInfoLabel')}
                    </summary>
                    <pre className="mt-2 max-h-20 overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-400">
                        {JSON.stringify(
                            {
                                status: error?.response?.status,
                                message: error?.message,
                                code: error?.code,
                            },
                            null,
                            2
                        )}
                    </pre>
                </details>
            )}
        </motion.div>
    );
};
