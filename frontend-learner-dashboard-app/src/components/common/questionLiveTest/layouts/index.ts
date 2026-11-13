import type { ComponentType } from "react";
import type { ExamLayoutVariant } from "@/types/exam-theme";
import { NtaMockScreen } from "./NtaMockScreen";
import { TcsConsoleScreen } from "./TcsConsoleScreen";
import { TcsPhoneScreen } from "./TcsPhoneScreen";

export type ConsoleVariant = Exclude<ExamLayoutVariant, "default">;

export interface ConsoleScreens {
  desktop: ComponentType;
  /** Phones (<768px). */
  phone: ComponentType;
}

/**
 * Screens of each console layout variant. The widgets, actions and palette
 * rules are shared. The NTA mock's phone screen is the TCS phone screen in
 * the NTA colours and labels (nta-mock.css, console-chrome.ts), with its
 * own buttons (CONSOLE_BUTTONS["nta-mock"]).
 */
export const CONSOLE_SCREENS: Record<ConsoleVariant, ConsoleScreens> = {
  "tcs-console": { desktop: TcsConsoleScreen, phone: TcsPhoneScreen },
  "nta-mock": { desktop: NtaMockScreen, phone: TcsPhoneScreen },
};

export const consoleScreenFor = (
  variant: ExamLayoutVariant,
  isCompact: boolean,
): ComponentType => {
  const screens = CONSOLE_SCREENS[variant === "default" ? "tcs-console" : variant];
  return isCompact ? screens.phone : screens.desktop;
};
