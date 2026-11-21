import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useLiveTestUi } from "../live-test-ui-context";

/**
 * A console-styled dialog. It is portalled outside the exam shell, so it
 * carries the theme and layout attributes itself for the exam-theme CSS.
 */
export function ConsoleDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide = false,
  sheet = false,
  dismissible = true,
  centredTitle = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** A bottom sheet (phones) instead of a centred dialog. */
  sheet?: boolean;
  /** false: no close button, Escape and outside clicks do nothing. */
  dismissible?: boolean;
  /** Title centred in the header bar (Exam Summary). */
  centredTitle?: boolean;
}) {
  const { t } = useTranslation("questionTest");
  const { examTheme } = useLiveTestUi();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="tcs-dialog-overlay"
          data-exam-theme={examTheme.id}
          data-exam-theme-family={examTheme.family}
          data-exam-layout={examTheme.layout.variant}
        />
        <DialogPrimitive.Content
          className={cn(
            "tcs-dialog",
            wide && "tcs-dialog--wide",
            sheet && "tcs-dialog--sheet",
            centredTitle && "tcs-dialog--centred-title",
          )}
          data-exam-theme={examTheme.id}
          data-exam-theme-family={examTheme.family}
          data-exam-layout={examTheme.layout.variant}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
        >
          <div className="tcs-dialog__head">
            <DialogPrimitive.Title className="tcs-dialog__title">{title}</DialogPrimitive.Title>
            {dismissible && (
              <DialogPrimitive.Close
                className="tcs-dialog__close"
                aria-label={t("examThemes.tcs.close")}
              >
                ×
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="tcs-dialog__body">{children}</div>
          {footer && <div className="tcs-dialog__foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
