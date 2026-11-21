import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";

type Props = {
  children: ReactNode;
  /** What failed, for the console ("spreadsheet"). */
  label: string;
  /** Shown to the learner; defaults to "The {label} could not be loaded." */
  message?: string;
  retryLabel?: string;
  /** Called before re-rendering the children, e.g. to re-create a failed React.lazy. */
  onRetry?: () => void;
};
type State = { failed: boolean };

/**
 * Catches a failed lazy chunk (offline, stale deploy) or a grid crash so one
 * broken editor does not take the whole test screen down.
 */
export class CbeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[cbe] ${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-danger-200 bg-danger-50 p-4 text-center"
      >
        <WarningCircle size={24} className="text-danger-600" />
        <p className="text-body text-danger-700">
          {this.props.message ?? `The ${this.props.label} could not be loaded.`}
        </p>
        <MyButton type="button" buttonType="text" scale="small" onClick={() => {
            this.props.onRetry?.();
            this.setState({ failed: false });
          }}>
          {this.props.retryLabel ?? "Try again"}
        </MyButton>
      </div>
    );
  }
}
