import { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import i18n from '@/i18n';

// Class component: useTranslation() (a hook) isn't available here. Use the
// shared i18next singleton directly with a fixed namespace — same pattern as
// YooptaEditorWrapperSafe.
const NAMESPACE = 'studyLibrarySlideContentErrorBoundary';

interface SlideContentErrorBoundaryProps {
    children: ReactNode;
    /**
     * When this value changes the boundary clears any caught error so the newly
     * selected slide gets a clean render. Pass the active slide id.
     */
    resetKey?: string | null;
}

interface SlideContentErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    renderedKey: string | null | undefined;
}

/**
 * Isolates a single slide's render. Slide content (esp. the Yoopta/Slate
 * document editor) can throw a synchronous render error on malformed stored
 * content; without a local boundary that error bubbles to the route-level
 * boundary and replaces the whole page with "Something went wrong", stranding
 * the user with no way to reach the sidebar and pick another slide.
 *
 * Here we catch it, keep the rest of the page (sidebar, toolbar) alive, and show
 * an inline error state. Selecting another slide changes `resetKey`, which
 * clears the error and renders the new slide.
 */
export class SlideContentErrorBoundary extends Component<
    SlideContentErrorBoundaryProps,
    SlideContentErrorBoundaryState
> {
    constructor(props: SlideContentErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null, renderedKey: props.resetKey };
    }

    static getDerivedStateFromError(error: Error): Partial<SlideContentErrorBoundaryState> {
        return { hasError: true, error };
    }

    static getDerivedStateFromProps(
        props: SlideContentErrorBoundaryProps,
        state: SlideContentErrorBoundaryState
    ): Partial<SlideContentErrorBoundaryState> | null {
        // Navigated to a different slide — drop the previous error so the new
        // slide renders instead of the stale fallback.
        if (props.resetKey !== state.renderedKey) {
            return { hasError: false, error: null, renderedKey: props.resetKey };
        }
        return null;
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[SlideContentErrorBoundary] slide render crashed:', error, errorInfo);
        Sentry.captureException(error, {
            tags: { boundary: 'SlideContentErrorBoundary' },
            extra: {
                componentStack: errorInfo.componentStack,
                slideId: this.props.resetKey,
            },
        });
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="flex h-96 flex-col items-center justify-center rounded-lg py-10">
                    <div className="max-w-md text-center">
                        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-danger-100">
                            <WarningCircle size={28} className="text-danger-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-neutral-600">
                            {i18n.t('title', { ns: NAMESPACE })}
                        </h3>
                        <p className="mb-4 text-sm text-neutral-400">
                            {i18n.t('description', { ns: NAMESPACE })}
                        </p>
                        <MyButton buttonType="secondary" scale="medium" onClick={this.handleReset}>
                            {i18n.t('tryAgain', { ns: NAMESPACE })}
                        </MyButton>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="mt-4 text-start">
                                <summary className="cursor-pointer text-xs text-neutral-400">
                                    {i18n.t('errorDetails', { ns: NAMESPACE })}
                                </summary>
                                <pre className="mt-2 overflow-auto text-xs text-danger-600">
                                    {this.state.error.message}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
