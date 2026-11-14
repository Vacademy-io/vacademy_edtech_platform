import type { TFunction } from 'i18next';

export interface AnalyticsErrorDetails {
    message: string;
    actionRequired: boolean;
    retryable: boolean;
    iconType: 'warning' | 'error' | 'info';
}

export const getAnalyticsErrorDetails = (error: any, t: TFunction): AnalyticsErrorDetails => {
    // Handle axios error responses
    if (error?.response?.status) {
        const status = error.response.status;

        switch (status) {
            case 511:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.authRequired'),
                    actionRequired: true,
                    retryable: false,
                    iconType: 'warning',
                };

            case 401:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.sessionExpired'),
                    actionRequired: true,
                    retryable: false,
                    iconType: 'warning',
                };

            case 403:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.accessDenied'),
                    actionRequired: true,
                    retryable: false,
                    iconType: 'error',
                };

            case 404:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.notFound'),
                    actionRequired: false,
                    retryable: true,
                    iconType: 'info',
                };

            case 429:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.tooManyRequests'),
                    actionRequired: false,
                    retryable: true,
                    iconType: 'warning',
                };

            case 500:
            case 502:
            case 503:
            case 504:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.serverUnavailable'),
                    actionRequired: false,
                    retryable: true,
                    iconType: 'error',
                };

            default:
                return {
                    message: t('dashboardAnalyticsErrorHandler:errors.serviceError', { status }),
                    actionRequired: false,
                    retryable: true,
                    iconType: 'error',
                };
        }
    }

    // Handle network errors
    if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network Error')) {
        return {
            message: t('dashboardAnalyticsErrorHandler:errors.connectionLost'),
            actionRequired: false,
            retryable: true,
            iconType: 'warning',
        };
    }

    // Handle timeout errors
    if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
        return {
            message: t('dashboardAnalyticsErrorHandler:errors.requestTimedOut'),
            actionRequired: false,
            retryable: true,
            iconType: 'warning',
        };
    }

    // Handle authentication-specific errors from our interceptor
    if (
        error?.message?.includes('authentication required') ||
        error?.message?.includes('log in again')
    ) {
        return {
            message: t('dashboardAnalyticsErrorHandler:errors.authRequired'),
            actionRequired: true,
            retryable: false,
            iconType: 'warning',
        };
    }

    // Generic fallback
    return {
        message: t('dashboardAnalyticsErrorHandler:errors.genericFallback'),
        actionRequired: false,
        retryable: true,
        iconType: 'error',
    };
};

export const shouldShowRetryButton = (error: any, t: TFunction): boolean => {
    const details = getAnalyticsErrorDetails(error, t);
    return details.retryable && !details.actionRequired;
};

export const getErrorIconColor = (iconType: 'warning' | 'error' | 'info'): string => {
    switch (iconType) {
        case 'warning':
            return 'text-amber-500';
        case 'error':
            return 'text-red-500';
        case 'info':
            return 'text-blue-500';
        default:
            return 'text-gray-500';
    }
};
