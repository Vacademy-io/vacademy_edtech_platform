import { MyButton } from "@/components/design-system/button";
import { getTokenDecodedData } from "@/lib/auth/sessionUtility";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import {
  InstituteBrandingComponent,
  type InstituteBranding,
} from "@/components/common/institute-branding";
import { useInstituteDetails } from "../live-class/-hooks/useInstituteDetails";
import { Preferences } from "@capacitor/preferences";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  resolveAssessmentById,
  storeAssessmentInfo,
} from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import { CheckCircle, Timer, ArrowRight, Sparkle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
}

const AssessmentRegistrationCompleted = ({
  assessmentId,
  assessmentName,
  timeLeft,
}: {
  assessmentId: string;
  assessmentName: string;
  timeLeft: TimeLeft;
}) => {
  const { t } = useTranslation("registrationA");
  const navigate = useNavigate();
  const { data: instituteDetails } = useInstituteDetails();

  const branding: InstituteBranding = {
    instituteId: instituteDetails?.id || null,
    instituteName: instituteDetails?.institute_name || null,
    instituteLogoFileId: instituteDetails?.institute_logo_file_id || null,
    instituteThemeCode: null,
    homeIconClickRoute: instituteDetails?.homeIconClickRoute ?? null,
  };
  const handleNavigateAssessment = async () => {
    try {
      const { value } = await Preferences.get({ key: "accessToken" });
      console.log("access token after registration before login ", value);
      // Decode token to get user data
      const decodedData = await getTokenDecodedData(value);
      const authorities = decodedData?.authorities;
      const userId = decodedData?.user;
      const authorityKeys = authorities ? Object.keys(authorities) : [];
      const assessmentRoute = `/assessment/examination/${assessmentId}`;

      if (authorityKeys.length > 1) {
        navigate({
          to: "/institute-selection",
          search: {
            redirect: assessmentRoute,
            isPublicAssessment: true,
          },
        });
      } else {
        const instituteId = authorityKeys[0];

        if (instituteId && userId) {
          try {
            await fetchAndStoreInstituteDetails(instituteId, userId);
            await fetchAndStoreStudentDetails(instituteId, userId);
            const fullAssessment = await resolveAssessmentById(assessmentId);
            if (fullAssessment) {
              await storeAssessmentInfo(fullAssessment);
            }

            navigate({
              to: assessmentRoute,
              search: { isPublicAssessment: true },
            });
          } catch (error) {
            console.error("Error fetching details:", error);
            toast.error(t("completed.toast.fetchDetailsError"));
            navigate({
              to: assessmentRoute,
              search: { isPublicAssessment: true },
            });
          }
        } else {
          console.error("Institute ID or User ID is undefined");
          navigate({
            to: assessmentRoute,
            search: { isPublicAssessment: true },
          });
        }
      }
    } catch (error) {
      console.error("Error processing decoded data:", error);
      navigate({
        to: `/assessment/examination/${assessmentId}`,
      });
    }
  };
  const isLive =
    timeLeft.hours === 0 && timeLeft.minutes === 0 && timeLeft.seconds === 0;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-primary-50/40 via-background to-background px-4 py-8">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary-100 bg-white/90 backdrop-blur-sm p-6 sm:p-8 shadow-xl">
        {/* Decorative gradient blob */}
        <div className="pointer-events-none absolute -end-20 -top-20 size-48 rounded-full bg-primary-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -start-16 -bottom-16 size-40 rounded-full bg-success-100/50 blur-3xl" />

        <div className="relative flex flex-col items-center gap-5">
          {/* Branding */}
          <InstituteBrandingComponent
            branding={branding}
            size="large"
            showName={false}
          />

          {/* Success icon with halo */}
          <div className="relative -mt-6 flex items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-success-200/60" />
            <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-success-500 to-success-400 shadow-lg shadow-success-200">
              <CheckCircle size={44} weight="fill" className="text-white" />
            </div>
          </div>

          {/* Title + assessment name */}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-200 px-3 py-0.5 text-caption font-semibold uppercase tracking-wide text-success-700">
              <Sparkle size={12} weight="fill" />
              {t("common.registrationCompletedBadge")}
            </span>
            <h1 className="text-xl sm:text-2xl font-semibold text-neutral-900">
              {t("completed.title")}
            </h1>
            <p className="text-sm text-neutral-500 max-w-ch-26">
              {assessmentName}
            </p>
          </div>

          {/* Countdown or live banner */}
          <div className="w-full rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 to-primary-50/30 px-4 py-4">
            {isLive ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-success-700">
                  <span className="size-1.5 rounded-full bg-success-500 animate-pulse" />
                  {t("completed.liveBadge")}
                </div>
                <span className="text-sm font-medium text-neutral-700">
                  {t("completed.liveMessage")}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary-700">
                  <Timer size={14} weight="bold" />
                  {t("completed.goesLiveIn")}
                </div>
                <span className="text-2xl sm:text-3xl font-bold tabular-nums text-primary-600">
                  {String(timeLeft.hours).padStart(2, "0")}
                  :
                  {String(timeLeft.minutes).padStart(2, "0")}
                  :
                  {String(timeLeft.seconds).padStart(2, "0")}
                </span>
              </div>
            )}
          </div>

          {/* CTA */}
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            className="group w-full gap-2"
            disable={!isLive}
            onClick={handleNavigateAssessment}
          >
            {t("completed.cta")}
            <ArrowRight
              size={16}
              weight="bold"
              className="transition-transform group-hover:translate-x-0.5"
            />
          </MyButton>

          {!isLive && (
            <p className="text-center text-xs text-neutral-400">
              {t("completed.unlockHint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentRegistrationCompleted;
