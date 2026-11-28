import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { streakCountdown, streakPrompt, type StreakState } from "../play/useDashboardHeroData";
import { FlameIcon, UserIcon } from "./fun-icons";

/**
 * The Fun home's greeting row (boards Main, A-New, A-Laptop, A-BigText): time-of-day
 * greeting from the device clock, the first name when it reads as a name, the
 * streak pill while gamification is on, and the profile button. Inside the app's top
 * bar (`inBar`) the bar's own account button is the profile button, so this one is
 * left out.
 */
export function FunHomeHeader({
  inBar = false,
  plainGreeting,
  greetingWithName,
  firstName,
  welcome,
  initials,
  streak,
  showStreak,
  loading,
}: {
  /** Drawn inside the app's top bar, beside its account button. */
  inBar?: boolean;
  /** "Good morning" with no name. */
  plainGreeting: string;
  /** "Good morning, Tara": the laptop's one-line heading. */
  greetingWithName: string;
  /** "" when the stored name reads as a phone, an email or a code. */
  firstName: string;
  /** A new learner (or one with no course yet) is welcomed instead of greeted by name alone. */
  welcome: boolean;
  initials: string;
  streak: StreakState;
  showStreak: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation("funHome");
  const { t: tEngagement } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const name = welcome
    ? firstName
      ? t("header.welcome", { name: firstName })
      : t("header.welcomePlain")
    : firstName;
  const pill = showStreak && streak.status !== "zero" && !streak.isLoading;
  const prompt = pill && streak.status === "atRisk" ? streakPrompt(streak, tEngagement) : null;
  const countdown = pill ? streakCountdown(streak, tEngagement) : null;

  return (
    <header className={cn("fun-home-header", inBar && "fun-home-header--in-bar")}>
      <div className="fun-home-header__row">
        <div className="fun-home-header__words">
          {loading ? (
            <>
              <span className="fun-skeleton fun-home-header__sk-greet" aria-hidden="true" />
              <span className="fun-skeleton fun-home-header__sk-name" aria-hidden="true" />
            </>
          ) : name ? (
            <>
              <p className="fun-home-header__greet">{plainGreeting}</p>
              <h1 className="fun-home-header__name">
                <bdi className="fun-home-header__phone-line">{name}</bdi>
                {/* One line on a laptop: "Good morning, Tara". */}
                <bdi className="fun-home-header__laptop-line">{welcome ? name : greetingWithName}</bdi>
              </h1>
            </>
          ) : (
            <h1 className="fun-home-header__name">{plainGreeting}</h1>
          )}
        </div>
        {pill && (
          <p className={cn("fun-streak", streak.status === "atRisk" && "fun-streak--at-risk")}>
            <FlameIcon className="fun-streak__flame" />
            <span className="fun-streak__count">{streak.current}</span>
            <span className="fun-streak__unit">{t("header.streakUnit", { count: streak.current })}</span>
          </p>
        )}
        {!inBar && (
          <button
            type="button"
            className="fun-avatar"
            aria-label={t("header.profile")}
            onClick={() => navigate({ to: "/user-profile" as never })}
          >
            {initials ? <span aria-hidden="true">{initials}</span> : <UserIcon className="fun-avatar__icon" />}
          </button>
        )}
      </div>
      {(prompt || countdown) && (
        <p className="fun-home-header__prompt">
          {prompt}
          {prompt && countdown ? " · " : null}
          {countdown}
        </p>
      )}
    </header>
  );
}
