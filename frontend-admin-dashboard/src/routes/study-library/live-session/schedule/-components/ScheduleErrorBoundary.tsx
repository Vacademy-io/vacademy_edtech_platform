import * as Sentry from '@sentry/react';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

/**
 * Error boundary for the live-session schedule flows (single + bulk).
 *
 * A render crash inside the schedule forms (e.g. the notification section)
 * otherwise bubbles to the global route errorComponent and shows a full-page
 * "System Crashed" with an UNTAGGED Sentry event — hard to find amid the rest
 * of the issues. This boundary instead:
 *   - captures the crash to Sentry with a `feature` tag + component stack so the
 *     exact flow that broke is greppable, and
 *   - renders a localized, recoverable fallback (Try again) without tearing down
 *     the surrounding page chrome.
 *
 * Sentry.ErrorBoundary captures the exception itself, so the fallback must NOT
 * call captureException again (avoids double events).
 */
export function ScheduleErrorBoundary({
    feature,
    children,
}: {
    feature: string;
    children: ReactNode;
}) {
    const { t } = useTranslation('studyLibraryScheduleErrorBoundary');
    return (
        <Sentry.ErrorBoundary
            beforeCapture={(scope) => {
                scope.setTag('feature', feature);
                scope.setTag('area', 'live-session-schedule');
            }}
            fallback={({ resetError }) => (
                <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
                    <Warning size={40} className="text-danger-500" />
                    <div>
                        <h2 className="text-lg font-semibold text-neutral-800">
                            {t('title')}
                        </h2>
                        <p className="mt-1 text-sm text-neutral-500">{t('body')}</p>
                    </div>
                    <MyButton type="button" buttonType="primary" onClick={resetError}>
                        {t('tryAgain')}
                    </MyButton>
                </div>
            )}
        >
            {children}
        </Sentry.ErrorBoundary>
    );
}
