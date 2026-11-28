/**
 * Error boundaries for the panel.
 *
 * - PanelRootErrorBoundary (outermost, owner decision 1): renders the
 *   "Vacademy Classroom could not start" card with every captured error
 *   (window.__PANEL_ERRORS__ + the React error) and Reload / Android escape
 *   hatches, so a render-time crash is never a blank screen. It sets
 *   window.__PANEL_BOOT_FAILED__ so the panel.html watchdog stands down.
 * - PanelScreenErrorBoundary: per-screen; a crashing feature shows an error
 *   state with Back to Home instead of taking the whole app down.
 *
 * No i18n / theme context here on purpose: the root boundary must render even
 * when those providers are what failed.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { MyButton } from '@/components/design-system/button';
import { WarningCircle } from '@phosphor-icons/react';
import { isNativePanel, openDeviceSettings } from '../lib/native';

function recordError(error: unknown, info?: ErrorInfo): string {
    const text =
        error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
    const stack = info?.componentStack ? info.componentStack.split('\n').slice(0, 4).join(' ') : '';
    try {
        const list = window.__PANEL_ERRORS__ || (window.__PANEL_ERRORS__ = []);
        list.push(`React: ${text}${stack ? ` | ${stack}` : ''}`.slice(0, 600));
    } catch {
        /* ignore */
    }
    return text;
}

interface RootState {
    error: string | null;
}

export class PanelRootErrorBoundary extends Component<{ children: ReactNode }, RootState> {
    state: RootState = { error: null };

    static getDerivedStateFromError(error: unknown): RootState {
        return { error: error instanceof Error ? error.message : String(error) };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        recordError(error, info);
        window.__PANEL_BOOT_FAILED__ = true;
    }

    render() {
        if (this.state.error === null) return this.props.children;
        const errors = (window.__PANEL_ERRORS__ || []).slice(-12);
        const native = isNativePanel();
        return (
            <div className="panel-stage overflow-y-auto bg-background p-8">
                <div className="mx-auto max-w-5xl space-y-6 rounded-lg border border-border bg-card p-10">
                    <div className="flex items-center space-x-4">
                        <WarningCircle size={56} className="shrink-0 text-danger-500" aria-hidden />
                        <h1 className="text-h1 font-semibold text-neutral-800">
                            Vacademy Classroom could not start
                        </h1>
                    </div>
                    <p className="text-title text-neutral-600">{this.state.error}</p>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                        {errors.length ? errors.join('\n') : 'No other errors were captured.'}
                    </pre>
                    <p className="break-all text-body text-neutral-500">{navigator.userAgent}</p>
                    <div className="space-x-4">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={() => window.location.reload()}
                        >
                            Reload
                        </MyButton>
                        {native && (
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={() => void openDeviceSettings('settings')}
                            >
                                Android settings
                            </MyButton>
                        )}
                        {native && (
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={() => void openDeviceSettings('home')}
                            >
                                Switch home app
                            </MyButton>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

interface ScreenProps {
    children: ReactNode;
    /** Rendered instead of the crashed screen. */
    fallback: (error: string, reset: () => void) => ReactNode;
}

interface ScreenState {
    error: string | null;
}

export class PanelScreenErrorBoundary extends Component<ScreenProps, ScreenState> {
    state: ScreenState = { error: null };

    static getDerivedStateFromError(error: unknown): ScreenState {
        return { error: error instanceof Error ? error.message : String(error) };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        recordError(error, info);
    }

    reset = () => this.setState({ error: null });

    render() {
        if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
        return this.props.children;
    }
}
