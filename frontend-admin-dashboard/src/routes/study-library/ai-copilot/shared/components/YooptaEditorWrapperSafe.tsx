import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import i18n from '@/i18n';
import { YooptaEditorWrapper } from './YooptaEditorWrapper';

const NAMESPACE = 'studyLibraryYooptaEditorWrapperSafe';

interface YooptaEditorWrapperSafeProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    minHeight?: number | string;
    className?: string;
    editable?: boolean;
    onBlur?: () => void;
}

interface YooptaEditorWrapperSafeState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error boundary wrapper for YooptaEditorWrapper to prevent crashes
 */
export class YooptaEditorWrapperSafe extends Component<YooptaEditorWrapperSafeProps, YooptaEditorWrapperSafeState> {
    constructor(props: YooptaEditorWrapperSafeProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
        };
    }

    static getDerivedStateFromError(error: Error): YooptaEditorWrapperSafeState {
        return {
            hasError: true,
            error,
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('YooptaEditorWrapper error:', error, errorInfo);
        Sentry.captureException(error, {
            tags: { boundary: 'YooptaEditorWrapperSafe' },
            extra: { componentStack: errorInfo.componentStack },
        });
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div 
                    className={`rounded-md border border-red-200 bg-red-50 p-4 ${this.props.className || ''}`.trim()}
                    style={{ 
                        width: '100%', 
                        minHeight: typeof this.props.minHeight === 'number' ? `${this.props.minHeight}px` : this.props.minHeight || '400px',
                    }}
                >
                    <div className="text-sm text-red-600">
                        <p className="font-semibold mb-1">
                            {i18n.t('errorLoadingEditor', { ns: NAMESPACE })}
                        </p>
                        <p className="text-xs">
                            {i18n.t('refreshAndRetry', { ns: NAMESPACE })}
                        </p>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-xs">
                                    {i18n.t('errorDetails', { ns: NAMESPACE })}
                                </summary>
                                <pre className="mt-2 text-xs overflow-auto">{this.state.error.message}</pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return <YooptaEditorWrapper {...this.props} />;
    }
}
