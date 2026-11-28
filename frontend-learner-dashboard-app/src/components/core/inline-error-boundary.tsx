import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import i18n from "@/i18n";
import { MyButton } from "@/components/design-system/button";

interface InlineErrorBoundaryProps {
  children: ReactNode;
  /** Shown instead of the generic copy — say which panel failed. */
  title?: string;
  description?: string;
}

interface InlineErrorBoundaryState {
  hasError: boolean;
}

/**
 * A boundary sized for a dialog or panel, rather than the full-page fallback in
 * `dashboard-loader`.
 *
 * Exists because a render throw inside an auxiliary panel used to take the whole
 * React tree down with it. That is merely annoying on a dashboard, but the live
 * assessment mounts its screen, timers and answer state in that same tree — so a
 * crash in something as peripheral as the help dialog would blank a paper the
 * learner is part-way through. Contain the failure to the panel and let them
 * carry on with the exam.
 */
export class InlineErrorBoundary extends Component<
  InlineErrorBoundaryProps,
  InlineErrorBoundaryState
> {
  public state: InlineErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): InlineErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("InlineErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => this.setState({ hasError: false });

  public render() {
    if (!this.state.hasError) return this.props.children;

    const {
      title = i18n.t("courseComponentsExtra:inlineErrorBoundary.defaultTitle"),
      description = i18n.t("courseComponentsExtra:inlineErrorBoundary.defaultDescription"),
    } = this.props;

    return (
      <div className="mt-4 flex flex-col items-center gap-stack rounded-lg border border-danger-200 bg-danger-50 p-6 text-center">
        <WarningCircle size={32} weight="duotone" className="text-danger-500" />
        <p className="text-body font-semibold text-neutral-800">{title}</p>
        <p className="text-caption text-neutral-600">{description}</p>
        <MyButton
          buttonType="secondary"
          scale="medium"
          onClick={this.handleReset}
        >
          {i18n.t("courseComponentsExtra:common.tryAgain")}
        </MyButton>
      </div>
    );
  }
}
