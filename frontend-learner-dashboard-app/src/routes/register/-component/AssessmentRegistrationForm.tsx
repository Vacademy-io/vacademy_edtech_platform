import { MyButton } from "@/components/design-system/button";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Calendar,
  Exam,
  Timer,
  ArrowRight,
  Lightning,
  ListChecks,
  CheckCircle,
  ClipboardText,
  UserPlus,
} from "@phosphor-icons/react";
import {
  InstituteBrandingComponent,
  type InstituteBranding,
} from "@/components/common/institute-branding";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import {
  getOpenTestRegistrationDetails,
  handleGetParticipantsTest,
  handleGetPublicInstituteBranding,
  handleGetStudentDetailsOfInstitute,
  handleGetUserId,
  handleRegisterOpenParticipant,
} from "../-services/open-registration-services";
import { Route } from "..";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { convertToLocalDateTime } from "@/constants/helper";
import { isRichTextEmpty, sanitizeHtml } from "@/lib/utils";
import {
  calculateTimeDifference,
  calculateTimeLeft,
  case1,
  case2,
  case3,
  isEffectivelyUnbounded,
  getDynamicSchema,
  getOpenRegistrationUserDetailsByEmail,
} from "../-utils/helper";
import {
  AssessmentCustomFieldOpenRegistration,
  DynamicSchemaData,
  ParticipantsDataInterface,
} from "@/types/assessment-open-registration";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import {
  FieldRenderType,
  getFieldRenderType,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { capitalise } from "@/utils/custom-field";
import CheckEmailStatusAlertDialog from "./CheckEmailStatusAlertDialog";
import AssessmentClosedExpiredComponent from "./AssessmentClosedExpiredComponent";
import {
  getTokenDecodedData,
  getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { AxiosError } from "axios";
import i18next from "i18next";
import { toast } from "sonner";
import AssessmentRegistrationCompleted from "./AssessmentRegistrationCompleted";
import PostRegistrationOTPVerify from "./PostRegistrationOTPVerify";
import { useNavigate } from "@tanstack/react-router";
import PhoneInputField from "@/components/design-system/phone-input-field";
import { useInstituteDetails } from "../live-class/-hooks/useInstituteDetails";
import { useTheme } from "@/providers/theme/theme-provider";
import { useTranslation } from "react-i18next";
import { classifyRequestError } from "../-utils/request-error";

const MetaChip = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-2 py-3 text-center shadow-sm">
    <div className="flex size-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
      {icon}
    </div>
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-caption font-medium uppercase tracking-wide text-neutral-500 leading-tight">
        {label}
      </span>
      <span className="text-xs font-semibold text-neutral-800 leading-tight break-words">
        {value}
      </span>
    </div>
  </div>
);

const DateBlock = ({
  icon,
  title,
  start,
  end,
}: {
  icon: React.ReactNode;
  title: string;
  start: string;
  end: string;
}) => {
  const { t } = useTranslation("registrationA");
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-success-50 px-1.5 py-0.5 text-caption font-semibold text-success-700">
            {t("form.dateBlock.start")}
          </span>
          <span className="text-neutral-700">
            {start || t("form.dateBlock.noLimit")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-danger-50 px-1.5 py-0.5 text-caption font-semibold text-danger-700">
            {t("form.dateBlock.end")}
          </span>
          <span className="text-neutral-700">
            {end || t("form.dateBlock.noLimit")}
          </span>
        </div>
      </div>
    </div>
  );
};

// Surface the backend's human-readable message (ErrorInfo.ex) when present,
// falling back to the axios message. Also toasts plain Errors (e.g. the
// client-side blank user_id guard) instead of letting them fail silently.
const showRegistrationError = (error: unknown) => {
  console.error("[register] registration failed:", error);
  if (error instanceof AxiosError) {
    const { kind, message } = classifyRequestError(error);
    toast.error(
      kind === "network"
        ? i18next.t("registrationA:form.toast.networkError")
        : message || error.message,
      {
        className: "error-toast",
        duration: 3000,
      },
    );
  } else if (error instanceof Error) {
    toast.error(error.message, {
      className: "error-toast",
      duration: 2000,
    });
  } else {
    console.error("Unexpected error:", error);
  }
};

const AssessmentRegistrationForm = () => {
  const { t } = useTranslation("registrationA");
  const navigate = useNavigate();
  const [userHasAttemptCount, setUserHasAttemptCount] = useState(false);
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  // NOTE: the name is misleading — `true` means the email was NOT found (a new
  // registrant); `false` means the email already EXISTS (set in
  // CheckEmailStatusAlertDialog when an OTP is sent). onSubmit no longer relies
  // on this flag to decide the user_id — it keys off participantsDto.user_id.
  const [userAlreadyRegistered, setUserAlreadyRegistered] = useState(false);
  const { code } = Route.useSearch();
  const { data: instituteDetails } = useInstituteDetails();
  const { setPrimaryColor } = useTheme();

  const { data, isLoading } = useSuspenseQuery(
    getOpenTestRegistrationDetails(code),
  );

  // Fallback: when the domain-routing API fails (e.g. on pages.dev subdomains),
  // Preferences has no InstituteDetails → useInstituteDetails() returns null.
  // In that case, fetch the public branding payload directly using the
  // institute_id that the assessment-page API already gave us.
  const assessmentInstituteId = data?.institute_id ?? null;
  const needsBrandingFallback = !instituteDetails && !!assessmentInstituteId;
  const { data: fallbackBranding } = useQuery({
    queryKey: ["public-institute-branding", assessmentInstituteId],
    queryFn: () => handleGetPublicInstituteBranding(assessmentInstituteId!),
    enabled: needsBrandingFallback,
    staleTime: 10 * 60 * 1000,
  });

  const branding: InstituteBranding = {
    instituteId:
      instituteDetails?.id || fallbackBranding?.institute_id || null,
    instituteName:
      instituteDetails?.institute_name ||
      fallbackBranding?.institute_name ||
      null,
    instituteLogoFileId:
      instituteDetails?.institute_logo_file_id ||
      fallbackBranding?.logo_file_id ||
      null,
    instituteThemeCode: fallbackBranding?.institute_theme_code ?? null,
    homeIconClickRoute: instituteDetails?.homeIconClickRoute ?? null,
  };

  // Apply institute theme on the register page: default to Vacademy orange
  // ("primary"), override with the institute_theme_code from whichever source
  // returned it (local Preferences via useInstituteDetails, or the public
  // branding fallback when domain-routing has failed).
  useEffect(() => {
    const themeCode =
      (instituteDetails as unknown as { institute_theme_code?: string } | null)
        ?.institute_theme_code ?? fallbackBranding?.institute_theme_code;
    setPrimaryColor(
      themeCode && themeCode.trim().length > 0 ? themeCode : "primary",
    );
  }, [
    (instituteDetails as unknown as { institute_theme_code?: string } | null)
      ?.institute_theme_code,
    fallbackBranding?.institute_theme_code,
    setPrimaryColor,
  ]);

  const serverTime = useRef(
    new Date(Date.parse(data.server_time_in_gmt)).getTime(),
  );

  const [case1Status] = useState(
    case1(
      serverTime.current,
      data.assessment_public_dto.registration_open_date,
    ),
  );
  const [case2Status] = useState(
    case2(
      serverTime.current,
      data.assessment_public_dto.registration_open_date,
      data.assessment_public_dto.registration_close_date,
    ),
  );
  const [case3Status] = useState(
    case3(
      serverTime.current,
      data.assessment_public_dto.registration_close_date,
    ),
  );

  const [participantsDto, setParticipantsDto] =
    useState<ParticipantsDataInterface>({
      username: "",
      user_id: "",
      email: "",
      full_name: "",
      mobile_number: "",
      file_id: "",
      guardian_email: "",
      guardian_mobile_number: "",
      reattempt_count: 0,
    });
  const zodSchema = getDynamicSchema(data.assessment_custom_fields || []);
  type FormValues = z.infer<typeof zodSchema>;

  const [timeLeft, setTimeLeft] = useState(
    calculateTimeLeft(
      serverTime.current,
      data.assessment_public_dto.bound_start_time,
    ),
  );

  const [timeLeftForRegistrationCase1, setTimeLeftForRegistrationCase1] =
    useState(
      calculateTimeLeft(
        serverTime.current,
        data.assessment_public_dto.registration_open_date,
      ),
    );

  const registrationDeadlineIsUnbounded = isEffectivelyUnbounded(
    serverTime.current,
    data.assessment_public_dto.registration_close_date,
  );

  const [timeLeftForRegistrationCase2, setTimeLeftForRegistrationCase2] =
    useState(
      calculateTimeLeft(
        serverTime.current,
        data.assessment_public_dto.registration_close_date,
      ),
    );

  const formRef = useRef<HTMLDivElement>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues: (data.assessment_custom_fields || [])
      .sort(
        (
          a: AssessmentCustomFieldOpenRegistration,
          b: AssessmentCustomFieldOpenRegistration,
        ) => a.field_order - b.field_order,
      )
      .reduce(
        (
          defaults: Record<
            string,
            {
              name: string;
              value: string;
              is_mandatory: boolean;
              type: string;
              comma_separated_options?: string[];
            }
          >,
          field: AssessmentCustomFieldOpenRegistration,
        ) => {
          if (field.field_type === "dropdown") {
            const optionsArray = field.comma_separated_options
              ? field.comma_separated_options
                  .split(",")
                  .map((opt) => opt.trim())
              : [];

            defaults[field.field_key] = {
              name: field.field_name,
              value: optionsArray[0] || "",
              is_mandatory: field.is_mandatory || false,
              comma_separated_options: optionsArray,
              type: field.field_type,
            };
          } else {
            defaults[field.field_key] = {
              name: field.field_name,
              value: "",
              is_mandatory: field.is_mandatory || false,
              type: field.field_type,
            };
          }
          return defaults;
        },
        {} as Record<
          string,
          {
            name: string;
            value: string;
            is_mandatory: boolean;
            type: string;
            comma_separated_options?: string[];
          }
        >,
      ),
    mode: "onChange",
  });
  form.watch();

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleRegisterParticipant = useMutation({
    mutationFn: async ({
      assessment_custom_fields,
      institute_id,
      assessment_id,
      participantsDto,
      custom_field_request_list,
    }: {
      assessment_custom_fields: AssessmentCustomFieldOpenRegistration[];
      institute_id: string;
      assessment_id: string;
      participantsDto: ParticipantsDataInterface;
      custom_field_request_list: DynamicSchemaData;
    }) => {
      return handleRegisterOpenParticipant(
        assessment_custom_fields,
        institute_id,
        assessment_id,
        participantsDto,
        custom_field_request_list,
      );
    },
    onSuccess: (_data, variables) => {
      toast.success(t("form.toast.registeredSuccess"));
      setRegisteredEmail(variables.participantsDto.email);
    },
    onError: showRegistrationError,
  });

  const handleGetUserIdMutation = useMutation({
    mutationFn: async ({
      institute_id,
      custom_field_request_list,
    }: {
      institute_id: string;
      custom_field_request_list: DynamicSchemaData;
    }) => {
      return handleGetUserId(institute_id, custom_field_request_list);
    },
    onSuccess: async (response) => {
      if (!response?.user_id) {
        toast.error(t("form.toast.accountUnresolved"), {
          className: "error-toast",
          duration: 3000,
        });
        return;
      }
      const participantsData = {
        username: response.username,
        user_id: response.user_id,
        email: response.email,
        full_name: response.full_name,
        mobile_number: response.mobile_number,
        file_id: response.face_file_id,
        guardian_email: response.parents_email,
        guardian_mobile_number: response.parents_mobile_number,
        reattempt_count: 1,
      };
      // handleRegisterOpenParticipant returns response.data and axios throws on
      // non-2xx, so reaching here means the registration succeeded.
      await handleRegisterOpenParticipant(
        data.assessment_custom_fields,
        data.institute_id,
        data.assessment_public_dto.assessment_id,
        participantsData,
        form.getValues(),
      );
      toast.success(t("form.toast.registeredSuccess"));
      setRegisteredEmail(response.email);
    },
    onError: showRegistrationError,
  });

  function onSubmit(values: FormValues) {
    // Register directly only when we already hold a resolved learner identity:
    // CheckEmailStatusAlertDialog populates `participantsDto` (with a real user_id
    // and the remaining attempt count) once an existing learner verifies their
    // email. In every other case — a brand-new email, or an existing auth user who
    // isn't yet a learner in this institute (so the dialog left participantsDto
    // blank) — resolve/create the learner via add-institute_learner first, then
    // register. This guarantees we never POST a blank user_id, which would collide
    // on the UNIQUE(assessment_id, user_id) constraint for every anonymous registrant.
    if (participantsDto.user_id) {
      handleRegisterParticipant.mutate({
        assessment_custom_fields: data.assessment_custom_fields,
        institute_id: data.institute_id,
        assessment_id: data.assessment_public_dto.assessment_id,
        participantsDto,
        custom_field_request_list: values,
      });
    } else {
      handleGetUserIdMutation.mutate({
        institute_id: data.institute_id,
        custom_field_request_list: values,
      });
    }
  }

  const onInvalid = (err: unknown) => {
    console.error(err);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      serverTime.current = serverTime.current + 1000;
    }, 1000);

    return () => clearInterval(timer);
  }, []); // Empty dependency array ensures it only runs once

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(
        calculateTimeLeft(
          serverTime.current,
          data.assessment_public_dto.bound_start_time,
        ),
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [data.assessment_public_dto.bound_start_time]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeftForRegistrationCase1(
        calculateTimeLeft(
          serverTime.current,
          data.assessment_public_dto.registration_open_date,
        ),
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [data.assessment_public_dto.registration_open_date]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeftForRegistrationCase2(
        calculateTimeLeft(
          serverTime.current,
          data.assessment_public_dto.registration_close_date,
        ),
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [data.assessment_public_dto.registration_close_date]);

  useEffect(() => {
    const fetchToken = async () => {
      const accessToken = await getTokenFromStorage(TokenKey.accessToken);
      if (!accessToken) return;
      // Best effort: a stale token or a failed lookup simply means we treat
      // the visitor as not logged in. Never let it surface as an unhandled
      // rejection.
      try {
        const decodedData = getTokenDecodedData(accessToken);
        const userId = decodedData?.user;
        const assessmentId = data.assessment_public_dto.assessment_id;
        const instituteId = data.institute_id;
        const getAllStudentDetails =
          await handleGetStudentDetailsOfInstitute(instituteId);
        const userDetails = getOpenRegistrationUserDetailsByEmail(
          getAllStudentDetails,
          decodedData?.email,
        );
        const psIds = userDetails?.package_session_id;
        const getTestDetailsOfParticipants = await handleGetParticipantsTest(
          assessmentId,
          instituteId,
          userId,
          psIds,
        );
        if (
          getTestDetailsOfParticipants?.is_already_registered &&
          getTestDetailsOfParticipants.remaining_attempts > 0
        ) {
          setIsAlreadyLoggedIn(true);
        }
      } catch (error) {
        console.warn("[register] logged-in status check skipped:", error);
      }
    };

    fetchToken();
  }, []);

  useEffect(() => {
    if (data.error_message === "Assessment is Private") {
      navigate({
        to: "/login",
      });
    }
  }, []);

  if (isLoading) return <DashboardLoader />;

  if (
    userAlreadyRegistered &&
    case3Status &&
    calculateTimeDifference(
      serverTime.current,
      data.assessment_public_dto.bound_end_time,
    )
  )
    return (
      <AssessmentClosedExpiredComponent
        isExpired={false}
        assessmentName={data.assessment_public_dto.assessment_name}
      />
    );

  if (
    userAlreadyRegistered &&
    case3Status &&
    !calculateTimeDifference(
      serverTime.current,
      data.assessment_public_dto.bound_end_time,
    )
  )
    return (
      <AssessmentClosedExpiredComponent
        isExpired={true}
        assessmentName={data.assessment_public_dto.assessment_name}
      />
    );

  // Returning user who re-authenticated via OTP: already logged in, go straight to assessment.
  if (isAlreadyLoggedIn && case2Status)
    return (
      <AssessmentRegistrationCompleted
        assessmentId={data.assessment_public_dto.assessment_id}
        assessmentName={data.assessment_public_dto.assessment_name}
        timeLeft={timeLeft}
      />
    );

  // New registration (or re-registration while not logged in): verify email via OTP
  // so the learner can jump directly into the assessment without a separate login redirect.
  if (
    (handleRegisterParticipant.status === "success" ||
      handleGetUserIdMutation.status === "success") &&
    case2Status &&
    registeredEmail
  )
    return (
      <PostRegistrationOTPVerify
        email={registeredEmail}
        assessmentId={data.assessment_public_dto.assessment_id}
        assessmentName={data.assessment_public_dto.assessment_name}
        instituteId={data.institute_id}
        branding={branding}
      />
    );

  // Backend has explicitly marked this assessment as non-registrable.
  // Common causes: the registration window has closed, the assessment
  // has been unpublished, or the learner is outside the allowed audience.
  // Render a clear "closed" screen instead of falling through to the
  // email-check dialog flow. The private-assessment case has its own
  // dedicated redirect handled elsewhere.
  if (
    data.can_register === false &&
    data.error_message !== "Assessment is Private"
  ) {
    const isHardExpired = !calculateTimeDifference(
      serverTime.current,
      data.assessment_public_dto.bound_end_time,
    );
    return (
      <AssessmentClosedExpiredComponent
        isExpired={isHardExpired}
        assessmentName={data.assessment_public_dto.assessment_name}
      />
    );
  }

  // The assessment window itself has ended (bound_end_time is in the past).
  // Handles the case where the backend still returned can_register: true
  // (usually because the assessment hasn't been flagged as closed yet)
  // but the learner can no longer do anything useful.
  if (
    !calculateTimeDifference(
      serverTime.current,
      data.assessment_public_dto.bound_end_time,
    )
  ) {
    return (
      <AssessmentClosedExpiredComponent
        isExpired={true}
        assessmentName={data.assessment_public_dto.assessment_name}
      />
    );
  }

  return (
    <>
      {case1Status && (
        <div className="flex justify-center items-start w-full p-3 sm:p-6 bg-gradient-to-b from-primary-50/40 via-background to-background">
          <div className="flex flex-col w-full max-w-2xl gap-5 bg-white/90 backdrop-blur-sm border border-primary-100 rounded-2xl px-4 sm:px-6 py-6 shadow-sm">
            <div className="flex flex-col items-center gap-stack">
              <InstituteBrandingComponent
                branding={branding}
                size="large"
                showName={false}
              />
              <div className="flex flex-col items-center gap-2 -mt-8">
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 border border-warning-200 px-3 py-0.5 text-caption font-semibold uppercase tracking-wide text-warning-700">
                  <span className="size-1.5 rounded-full bg-warning-500 animate-pulse" />
                  {t("form.notYetOpenBadge")}
                </span>
                <h1 className="text-base sm:text-2xl font-semibold text-center text-neutral-900">
                  {data?.assessment_public_dto?.assessment_name}
                </h1>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 to-primary-50/30 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary-700">
                <Timer size={14} weight="bold" />
                {t("form.opensIn")}
              </div>
              <span className="text-2xl sm:text-3xl font-bold tabular-nums text-primary-600">
                {String(timeLeftForRegistrationCase1.hours).padStart(2, "0")}
                :
                {String(timeLeftForRegistrationCase1.minutes).padStart(2, "0")}
                :
                {String(timeLeftForRegistrationCase1.seconds).padStart(2, "0")}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetaChip
                icon={<Clock size={16} weight="bold" />}
                label={t("form.meta.duration")}
                value={t("form.meta.durationValue", { minutes: data.assessment_public_dto.duration })}
              />
              <MetaChip
                icon={<Exam size={16} weight="bold" />}
                label={t("form.meta.mode")}
                value={data.assessment_public_dto.play_mode}
              />
              <MetaChip
                icon={<Lightning size={16} weight="bold" />}
                label={t("form.meta.evaluation")}
                value={data.assessment_public_dto.evaluation_type}
              />
              <MetaChip
                icon={<ListChecks size={16} weight="bold" />}
                label={t("form.meta.attempts")}
                value={String(
                  data.assessment_public_dto.reattempt_count ?? 1,
                )}
              />
            </div>

            <div className="flex flex-col gap-stack">
              <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
                <Calendar
                  size={16}
                  weight="bold"
                  className="text-primary-500"
                />
                {t("form.dates.heading")}
              </h2>
              <div className="grid grid-cols-1 gap-stack">
                <DateBlock
                  icon={
                    <UserPlus
                      size={16}
                      weight="bold"
                      className="text-info-600"
                    />
                  }
                  title={t("form.dates.registrationWindow")}
                  start={convertToLocalDateTime(
                    data.assessment_public_dto.registration_open_date,
                  )}
                  end={convertToLocalDateTime(
                    data.assessment_public_dto.registration_close_date,
                  )}
                />
                <DateBlock
                  icon={
                    <Lightning
                      size={16}
                      weight="bold"
                      className="text-warning-600"
                    />
                  }
                  title={t("form.dates.assessmentLive")}
                  start={convertToLocalDateTime(
                    data.assessment_public_dto.bound_start_time,
                  )}
                  end={convertToLocalDateTime(
                    data.assessment_public_dto.bound_end_time,
                  )}
                />
              </div>
            </div>

            {!isRichTextEmpty(data.assessment_public_dto.instructions?.content) && (
              <div className="flex flex-col gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
                  <ClipboardText
                    size={16}
                    weight="bold"
                    className="text-primary-500"
                  />
                  {t("form.instructions")}
                </h2>
                <div
                  className="richtext-content text-sm text-neutral-600"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(
                      data.assessment_public_dto.instructions?.content ?? "",
                    ),
                  }}
                />
              </div>
            )}

            {!isRichTextEmpty(data.assessment_public_dto.about?.content) && (
              <div className="flex flex-col gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                <h2 className="text-sm font-semibold text-neutral-800">
                  {t("form.aboutAssessment")}
                </h2>
                <div
                  className="richtext-content text-sm text-neutral-600"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(
                      data.assessment_public_dto.about?.content ?? "",
                    ),
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {(case2Status ||
        case3Status ||
        data.error_message === "Assessment is Private") && (
        <CheckEmailStatusAlertDialog
          timeLeft={timeLeft}
          registrationData={data}
          registrationForm={form}
          setParticipantsDto={setParticipantsDto}
          userAlreadyRegistered={userAlreadyRegistered}
          setUserAlreadyRegistered={setUserAlreadyRegistered}
          userHasAttemptCount={userHasAttemptCount}
          setUserHasAttemptCount={setUserHasAttemptCount}
          case3Status={case3Status}
          serverTime={serverTime.current}
        />
      )}
      {!userHasAttemptCount && case2Status && (
        <div className="flex w-full items-start justify-center bg-gradient-to-b from-primary-50/40 via-background to-background gap-section lg:gap-10 flex-col sm:flex-row p-2 sm:p-4">
          <div className="flex justify-center items-start w-full mt-2 sm:mt-4">
            <div className="flex flex-col w-full sm:w-11/12 gap-5 bg-white/90 backdrop-blur-sm border border-primary-100 rounded-2xl px-4 sm:px-6 py-6 shadow-sm">
              {/* Branding + title */}
              <div className="flex flex-col items-center gap-stack">
                <InstituteBrandingComponent
                  branding={branding}
                  size="large"
                  showName={false}
                />
                <div className="flex flex-col items-center gap-2 -mt-8">
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-200 px-3 py-0.5 text-caption font-semibold uppercase tracking-wide text-success-700">
                    <span className="size-1.5 rounded-full bg-success-500 animate-pulse" />
                    {t("form.openBadge")}
                  </span>
                  <h1 className="text-base sm:text-2xl font-semibold text-center text-neutral-900">
                    {data?.assessment_public_dto?.assessment_name}
                  </h1>
                </div>
              </div>

              {/* Countdown + mobile register CTA */}
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 to-primary-50/30 px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary-700">
                  <Timer size={14} weight="bold" />
                  {registrationDeadlineIsUnbounded
                    ? t("form.noClosingDate")
                    : t("form.closesIn")}
                </div>
                {(!registrationDeadlineIsUnbounded &&
                  (timeLeftForRegistrationCase2.days > 0 ||
                  timeLeftForRegistrationCase2.hours > 0 ||
                  timeLeftForRegistrationCase2.minutes > 0 ||
                  timeLeftForRegistrationCase2.seconds > 0)) ? (
                  <div className="flex items-end gap-2 tabular-nums text-primary-600">
                    {timeLeftForRegistrationCase2.days > 0 && (
                      <div className="flex flex-col items-center">
                        <span className="text-2xl sm:text-3xl font-bold leading-none">
                          {timeLeftForRegistrationCase2.days}
                        </span>
                        <span className="text-xs font-medium uppercase tracking-wider text-primary-400 mt-0.5">{t("form.countdown.dayUnit", { count: timeLeftForRegistrationCase2.days })}</span>
                      </div>
                    )}
                    <div className="flex flex-col items-center">
                      <span className="text-2xl sm:text-3xl font-bold leading-none">
                        {String(timeLeftForRegistrationCase2.hours).padStart(2, "0")}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wider text-primary-400 mt-0.5">{t("form.countdown.hr")}</span>
                    </div>
                    <span className="text-2xl sm:text-3xl font-bold leading-none pb-4">:</span>
                    <div className="flex flex-col items-center">
                      <span className="text-2xl sm:text-3xl font-bold leading-none">
                        {String(timeLeftForRegistrationCase2.minutes).padStart(2, "0")}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wider text-primary-400 mt-0.5">{t("form.countdown.min")}</span>
                    </div>
                    <span className="text-2xl sm:text-3xl font-bold leading-none pb-4">:</span>
                    <div className="flex flex-col items-center">
                      <span className="text-2xl sm:text-3xl font-bold leading-none">
                        {String(timeLeftForRegistrationCase2.seconds).padStart(2, "0")}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wider text-primary-400 mt-0.5">{t("form.countdown.sec")}</span>
                    </div>
                  </div>
                ) : (
                  <span className="text-sm font-medium text-neutral-500">
                    {t("form.closingSoon")}
                  </span>
                )}
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="medium"
                  layoutVariant="default"
                  className="block sm:hidden mt-1"
                  onClick={scrollToForm}
                >
                  {t("form.registerNowMobile")}
                </MyButton>
              </div>

              {/* Metadata chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetaChip
                  icon={<Clock size={16} weight="bold" />}
                  label={t("form.meta.duration")}
                  value={t("form.meta.durationValue", { minutes: data.assessment_public_dto.duration })}
                />
                <MetaChip
                  icon={<Exam size={16} weight="bold" />}
                  label={t("form.meta.mode")}
                  value={data.assessment_public_dto.play_mode}
                />
                <MetaChip
                  icon={<Lightning size={16} weight="bold" />}
                  label={t("form.meta.evaluation")}
                  value={data.assessment_public_dto.evaluation_type}
                />
                <MetaChip
                  icon={<ListChecks size={16} weight="bold" />}
                  label={t("form.meta.attempts")}
                  value={String(
                    data.assessment_public_dto.reattempt_count ?? 1,
                  )}
                />
              </div>

              {/* Important dates */}
              <div className="flex flex-col gap-stack">
                <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
                  <Calendar size={16} weight="bold" className="text-primary-500" />
                  {t("form.dates.heading")}
                </h2>
                <div className="grid grid-cols-1 gap-stack">
                  <DateBlock
                    icon={
                      <UserPlus
                        size={16}
                        weight="bold"
                        className="text-info-600"
                      />
                    }
                    title={t("form.dates.registrationWindow")}
                    start={convertToLocalDateTime(
                      data.assessment_public_dto.registration_open_date,
                    )}
                    end={convertToLocalDateTime(
                      data.assessment_public_dto.registration_close_date,
                    )}
                  />
                  <DateBlock
                    icon={
                      <Lightning
                        size={16}
                        weight="bold"
                        className="text-warning-600"
                      />
                    }
                    title={t("form.dates.assessmentLive")}
                    start={convertToLocalDateTime(
                      data.assessment_public_dto.bound_start_time,
                    )}
                    end={convertToLocalDateTime(
                      data.assessment_public_dto.bound_end_time,
                    )}
                  />
                </div>
              </div>

              {/* Instructions */}
              {!isRichTextEmpty(data.assessment_public_dto.instructions?.content) && (
                <div className="flex flex-col gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                  <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
                    <ClipboardText
                      size={16}
                      weight="bold"
                      className="text-primary-500"
                    />
                    {t("form.instructions")}
                  </h2>
                  <div
                    className="richtext-content text-sm text-neutral-600"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        data.assessment_public_dto.instructions?.content ?? "",
                      ),
                    }}
                  />
                </div>
              )}

              {/* About */}
              {!isRichTextEmpty(data.assessment_public_dto.about?.content) && (
                <div className="flex flex-col gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                  <h2 className="text-sm font-semibold text-neutral-800">
                    {t("form.aboutAssessment")}
                  </h2>
                  <div
                    className="richtext-content text-sm text-neutral-600"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        data.assessment_public_dto.about?.content ?? "",
                      ),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <Separator className="block sm:hidden mx-4" />
          <div
            className="flex justify-center items-start w-full mt-2 sm:mt-4"
            ref={formRef}
          >
            <div className="flex justify-center items-start w-full sm:w-11/12 flex-col bg-white rounded-2xl p-5 sm:p-6 shadow-lg border border-primary-100 mx-4 mb-4">
              <div className="flex items-start gap-3 w-full">
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-400 text-white shadow-sm shrink-0">
                  <UserPlus size={20} weight="bold" />
                </div>
                <div className="flex-1">
                  <h1 className="text-lg font-semibold text-neutral-900">
                    {t("common.registrationFormHeading")}
                  </h1>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
                    {t("form.registrationFormSubheading")}
                  </p>
                </div>
              </div>
              {!isRichTextEmpty(
                data.assessment_public_dto.registration_instructions?.content,
              ) && (
                <div className="mt-4 flex gap-2 rounded-xl border border-info-100 bg-info-50/50 px-3 py-2.5 text-xs text-info-700 w-full">
                  <CheckCircle
                    size={16}
                    weight="bold"
                    className="shrink-0 mt-0.5"
                  />
                  {/* Rendered as HTML (not flattened to text) so the admin's
                      line breaks survive. `.richtext-content` is deliberately
                      NOT used here — it hardcodes a grey body colour that would
                      override the info-700 text of this callout. */}
                  <div
                    className="leading-relaxed [&_p]:my-1 [&_li]:ms-4 [&_li]:list-disc"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        data.assessment_public_dto.registration_instructions
                          ?.content ?? "",
                      ),
                    }}
                  />
                </div>
              )}
              <FormProvider {...form}>
                <form className="w-full flex flex-col gap-section mt-5 sm:max-h-screen-70 sm:overflow-auto pe-1">
                  {Object.entries(form.getValues()).map(([key, value]) => {
                    // A value without `name` is not a real form field (e.g. a
                    // key injected by a reset for a field this form doesn't
                    // have). Rendering it throws on `capitalise(value.name)`
                    // and the route's errorComponent shows "Expired".
                    if (!value || typeof value.name !== "string") return null;
                    if (key === "phone_number") {
                      return (
                        <FormField
                          key={key}
                          control={form.control}
                          name={`${key}.value`}
                          render={() => (
                            <FormItem>
                              <FormControl>
                                <PhoneInputField
                                  label={t("form.phoneNumberLabel")}
                                  placeholder={t("form.phoneNumberPlaceholder")}
                                  name={`${key}.value`}
                                  control={form.control}
                                  required
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      );
                    }

                    const field = (data.assessment_custom_fields || []).find(
                      (f: AssessmentCustomFieldOpenRegistration) =>
                        f.field_key === key,
                    );
                    const renderType = getFieldRenderType(
                      key,
                      value.type || field?.field_type || "text",
                    );
                    const fieldConfig =
                      (value as { config?: string | object }).config ||
                      field?.config;

                    return (
                      <FormField
                        key={key}
                        control={form.control}
                        name={`${key}.value`}
                        render={({ field: formField }) => (
                          <FormItem>
                            <div className="flex flex-col gap-1">
                              <label className="text-subtitle font-regular">
                                {capitalise(value.name)}
                                {value.is_mandatory && (
                                  <span className="text-danger-600"> *</span>
                                )}
                              </label>
                              <FormControl>
                                <CustomFieldRenderer
                                  type={renderType as FieldRenderType}
                                  name={value.name}
                                  value={formField.value || ""}
                                  onChange={(val) => formField.onChange(val)}
                                  config={fieldConfig}
                                  options={value.comma_separated_options?.map(
                                    (option: string, index: number) => ({
                                      value: option,
                                      label: option,
                                      _id: index,
                                    }),
                                  )}
                                  required={value.is_mandatory}
                                />
                              </FormControl>
                            </div>
                          </FormItem>
                        )}
                      />
                    );
                  })}
                  <div className="flex items-center justify-center flex-col gap-stack border-t border-neutral-100 pt-2">
                    <MyButton
                      type="button"
                      buttonType="primary"
                      scale="large"
                      layoutVariant="default"
                      className="group w-full sm:w-auto gap-2"
                      onClick={form.handleSubmit(onSubmit, onInvalid)}
                      disable={(["phone_number", "email", "full_name"] as const).some(
                        (key) => {
                          const field = form.getValues(key as any) as
                            | { value?: string }
                            | undefined;
                          // Only block if the field is present in the schema and empty.
                          return field !== undefined && !field.value;
                        },
                      )}
                    >
                      {t("form.register")}
                      <ArrowRight
                        size={16}
                        weight="bold"
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </MyButton>
                    <p
                      className="border-none !text-primary-500 !text-sm mb-1 cursor-pointer hover:underline"
                      onClick={() => form.reset()}
                    >
                      {t("form.resetForm")}
                    </p>
                  </div>
                </form>
              </FormProvider>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AssessmentRegistrationForm;
