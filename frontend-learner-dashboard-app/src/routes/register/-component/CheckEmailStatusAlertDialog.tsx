import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog";
import { useEffect, useState } from "react";
import {
  useForm,
  Controller,
  FormProvider,
  UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { z } from "zod";
import { FormControl, FormItem } from "@/components/ui/form";
import { MyInput } from "@/components/design-system/input";
import { MyButton } from "@/components/design-system/button";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { LOGIN_OTP, REQUEST_OTP } from "@/constants/urls";
import { toast } from "sonner";
import {
  getTokenDecodedData,
  removeTokensAndLogout,
  setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import {
  handleGetParticipantsTest,
  handleGetStudentDetailsOfInstitute,
} from "../-services/open-registration-services";
import { TokenKey } from "@/constants/auth/tokens";
import {
  calculateTimeDifference,
  getOpenRegistrationUserDetailsByEmail,
} from "../-utils/helper";
import { OpenTestAssessmentRegistrationDetails } from "@/types/open-test";
import {
  DynamicSchemaData,
  ParticipantsDataInterface,
} from "@/types/assessment-open-registration";
import AssessmentRegistrationCompleted from "./AssessmentRegistrationCompleted";
import AssessmentClosedExpiredComponent from "./AssessmentClosedExpiredComponent";
import { useNavigate } from "@tanstack/react-router";
import { classifyRequestError } from "../-utils/request-error";
import { useTranslation } from "react-i18next";

const checkCloseTestTimeCondition = (serverTime: number, endDate: string) => {
  const registrationEndDate: number = new Date(Date.parse(endDate)).getTime();
  return serverTime <= registrationEndDate;
};

// Define Zod Schema
const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z
    .array(z.string().length(1, "Each digit must be 1 character"))
    .length(6, "OTP must be 6 digits"),
});

// Define Form Values Type
type FormValues = z.infer<typeof formSchema>;
interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
}

const CheckEmailStatusAlertDialog = ({
  timeLeft,
  registrationData,
  registrationForm,
  setParticipantsDto,
  userAlreadyRegistered,
  setUserAlreadyRegistered,
  userHasAttemptCount,
  setUserHasAttemptCount,
  case3Status,
  serverTime,
}: {
  timeLeft: TimeLeft;
  registrationData: OpenTestAssessmentRegistrationDetails;
  registrationForm: UseFormReturn<DynamicSchemaData>;
  setParticipantsDto: React.Dispatch<
    React.SetStateAction<ParticipantsDataInterface>
  >;
  userAlreadyRegistered: boolean;
  setUserAlreadyRegistered: React.Dispatch<React.SetStateAction<boolean>>;
  userHasAttemptCount: boolean;
  setUserHasAttemptCount: React.Dispatch<React.SetStateAction<boolean>>;
  case3Status: boolean;
  serverTime: number;
}) => {
  const { t } = useTranslation("registrationA");
  const [
    isPrivateAssessmentAlreadyRegistered,
    setIsPrivateAssessmentAlreadyRegistered,
  ] = useState(false);

  const [
    isPrivateAssessmentNotAlreadyRegistered,
    setIsPrivateAssessmentNotAlreadyRegistered,
  ] = useState(false);

  const [isOtpSent, setIsOTPSent] = useState(false);
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      otp: Array(6).fill(""), // Empty array for 6 digits
    },
    mode: "onChange",
  });
  const navigate = useNavigate();

  const handleCloseAlertDialog = () => {
    setOpen(false);
  };

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle OTP input change
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return; // Allow only numbers

    const otpArray = [...form.getValues("otp")];
    otpArray[index] = value;
    form.setValue("otp", otpArray, { shouldValidate: true });

    // Auto-focus next field
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  // Handle OTP keydown for navigation
  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !form.getValues("otp")[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  // Watch form values
  const email = form.watch("email");
  const otp = form.watch("otp");

  // Check if form is valid
  const isEmailValid = formSchema.shape.email.safeParse(email).success;
  const isFormValid =
    email.trim() !== "" && otp.every((digit) => digit.trim() !== "");

  const startTimer = () => {
    setTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const sendOtpMutation = useMutation({
    // institute_id decides the OTP mail's sender address and branding; without it the send falls
    // back to support@vacademy.io. The assessment's own institute is the right one here.
    mutationFn: (email: string) =>
      axios.post(REQUEST_OTP, {
        email,
        ...(registrationData.institute_id && {
          institute_id: registrationData.institute_id,
        }),
      }),
    onSuccess: () => {
      setIsOTPSent(true);
      startTimer();
      toast.success(t("checkEmailDialog.toast.otpSent"));
      setUserAlreadyRegistered(false);
    },
    onError: async (error) => {
      // Only the backend's own rejection (511 "User not found!") means the
      // email is unknown. Offline / 5xx must not be read as "not registered"
      // — that would log the learner out and dump them on the blank form.
      const { kind } = classifyRequestError(error);
      if (kind === "network" || kind === "server" || kind === "unknown") {
        console.error("[register] request-otp failed:", error);
        toast.error(t("checkEmailDialog.toast.otpSendFailedTitle"), {
          description: t("checkEmailDialog.toast.otpSendFailedDescription"),
          duration: 3000,
        });
        return;
      }
      await removeTokensAndLogout();
      toast.error(t("checkEmailDialog.toast.notRegisteredTitle"), {
        description: t("checkEmailDialog.toast.notRegisteredDescription"),
        duration: 3000,
      });
      setUserAlreadyRegistered(true);
      handleCloseAlertDialog();
      // The email field is optional on the admin side (built-in fields can be
      // removed per form). Only prefill it when it exists — injecting a
      // half-formed `{ value }` object makes the form's render loop crash on
      // `value.name`, and the route then shows "Assessment Expired".
      registrationForm.reset({
        ...registrationForm.getValues(),
        ...(registrationForm.getValues("email") && {
          email: {
            ...registrationForm.getValues("email"),
            value: form.getValues("email"),
          },
        }),
      });
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: (data: { email: string; otp: string }) =>
      axios.post(LOGIN_OTP, data),
    onSuccess: async (response) => {
      await removeTokensAndLogout();
      // Store tokens in Capacitor Storage
      await setTokenInStorage(TokenKey.accessToken, response.data.accessToken);
      await setTokenInStorage(
        TokenKey.refreshToken,
        response.data.refreshToken,
      );
      const decodedData = getTokenDecodedData(response.data.accessToken);
      const userId = decodedData?.user;
      const assessmentId = registrationData.assessment_public_dto.assessment_id;
      const instituteId = registrationData.institute_id;

      // The OTP is already accepted at this point. If the follow-up lookups
      // fail (network blip, backend hiccup) say so — a throw here would
      // otherwise fall into onError and be reported as "Invalid OTP".
      let getAllStudentDetails: unknown;
      let getTestDetailsOfParticipants: {
        is_already_registered: boolean;
        remaining_attempts: number;
      };
      let userDetails: ReturnType<typeof getOpenRegistrationUserDetailsByEmail>;
      try {
        getAllStudentDetails =
          await handleGetStudentDetailsOfInstitute(instituteId);
        userDetails = getOpenRegistrationUserDetailsByEmail(
          getAllStudentDetails,
          email,
        );
        const psIds = userDetails?.package_session_id;
        getTestDetailsOfParticipants = await handleGetParticipantsTest(
          assessmentId,
          instituteId,
          userId,
          psIds,
        );
      } catch (lookupError) {
        console.error(
          "[register] post-OTP registration lookup failed:",
          lookupError,
        );
        toast.error(t("checkEmailDialog.toast.statusLookupFailedTitle"), {
          description: t(
            "checkEmailDialog.toast.statusLookupFailedDescription",
          ),
          duration: 4000,
        });
        return;
      }
      if (
        !getTestDetailsOfParticipants ||
        typeof getTestDetailsOfParticipants.is_already_registered !== "boolean"
      ) {
        console.error(
          "[register] unexpected participant-status payload:",
          getTestDetailsOfParticipants,
        );
        toast.error(t("checkEmailDialog.toast.statusLookupFailedTitle"), {
          description: t(
            "checkEmailDialog.toast.statusLookupFailedDescription",
          ),
          duration: 4000,
        });
        return;
      }
      if (userDetails) {
        setParticipantsDto({
          username: userDetails.username,
          user_id: userDetails.user_id,
          email: userDetails.email,
          full_name: userDetails.full_name,
          mobile_number: userDetails.mobile_number,
          file_id: userDetails.face_file_id || "",
          guardian_email: userDetails.parents_email,
          guardian_mobile_number: userDetails.parents_mobile_number,
          reattempt_count: getTestDetailsOfParticipants.remaining_attempts,
        });
      }
      if (
        registrationData.error_message === "Assessment is Private" &&
        getTestDetailsOfParticipants.is_already_registered &&
        getTestDetailsOfParticipants.remaining_attempts > 0
      ) {
        setIsPrivateAssessmentAlreadyRegistered(true);
      } else if (
        registrationData.error_message === "Assessment is Private" &&
        !getTestDetailsOfParticipants.is_already_registered &&
        getTestDetailsOfParticipants.remaining_attempts > 0
      ) {
        setIsPrivateAssessmentNotAlreadyRegistered(true);
      } else if (
        getTestDetailsOfParticipants.is_already_registered &&
        getTestDetailsOfParticipants.remaining_attempts > 0
      ) {
        setUserHasAttemptCount(true);
      } else if (
        getTestDetailsOfParticipants.is_already_registered &&
        getTestDetailsOfParticipants.remaining_attempts === 0
      ) {
        toast.error(
          t("checkEmailDialog.toast.attemptsOverTitle"),
          {
            description: t("checkEmailDialog.toast.attemptsOverDescription"),
            duration: 3000,
          },
        );
      } else {
        // Same guard as gender/state/city below: the built-in email/name/phone
        // fields can be removed from a form by the admin (Edzumo's coding
        // challenges have none). Resetting a key that isn't in the form injects
        // `{ value }` without `name`/`type`, and the form's render loop throws
        // on `capitalise(value.name)` — surfacing as "Assessment Expired".
        registrationForm.reset((prevValues) => ({
          ...prevValues,
          ...(registrationForm.getValues("email") && {
            email: {
              ...registrationForm.getValues("email"),
              // Fall back to the just-verified email when the user exists in auth
              // but isn't yet an institute learner (userDetails is null).
              value: userDetails?.email || email,
            },
          }),
          ...(registrationForm.getValues("full_name") && {
            full_name: {
              ...registrationForm.getValues("full_name"),
              value: userDetails?.full_name || "",
            },
          }),
          ...(registrationForm.getValues("phone_number") && {
            phone_number: {
              ...registrationForm.getValues("phone_number"),
              value: userDetails?.mobile_number || "",
            },
          }),
          ...(registrationForm.getValues("gender") && {
            gender: {
              ...registrationForm.getValues("gender"),
              value: userDetails?.gender || "",
            },
          }),
          ...(registrationForm.getValues("state") && {
            state: {
              ...registrationForm.getValues("state"),
              value: userDetails?.region || "",
            },
          }),
          ...(registrationForm.getValues("city") && {
            city: {
              ...registrationForm.getValues("city"),
              value: userDetails?.city || "",
            },
          }),
        }));
        handleCloseAlertDialog();
      }
    },
    onError: (error) => {
      const { kind, message } = classifyRequestError(error);
      console.error("[register] login-otp failed:", kind, error);
      if (kind === "network" || kind === "server" || kind === "unknown") {
        toast.error(t("checkEmailDialog.toast.verificationFailedTitle"), {
          description: t("checkEmailDialog.toast.verificationFailedDescription"),
          duration: 3000,
        });
        return;
      }
      // 510/511: the backend explained why ("OTP has expired. Please request a
      // new one.") — show that sentence rather than a generic "Invalid OTP".
      toast.error(
        kind === "business" && message
          ? t("checkEmailDialog.toast.otpExpiredOrInvalidTitle")
          : t("checkEmailDialog.toast.invalidOtpTitle"),
        {
          description:
            kind === "business" && message
              ? message
              : t("checkEmailDialog.toast.invalidOtpDescription"),
          duration: 4000,
        },
      );
    },
  });

  const onSubmit = (data: FormValues) => {
    const otpArray = data.otp;
    if (otpArray.every((val) => val !== "")) {
      verifyOtpMutation.mutate({
        email,
        otp: otpArray.join(""),
      });
    } else {
      toast.error(t("checkEmailDialog.toast.fillAllOtp"));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (/^\d{6}$/.test(pasted)) {
      e.preventDefault();
      const otpArray = pasted.split("");
      otpArray.forEach((char, i) => {
        form.setValue(`otp.${i}`, char);
      });
      // Optional: focus the last box
      const lastFilledIndex =
        Math.min(otpArray.length, otpRefs.current.length) - 1;
      otpRefs.current[lastFilledIndex]?.focus();
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setOpen(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (
      isPrivateAssessmentAlreadyRegistered &&
      checkCloseTestTimeCondition(
        serverTime,
        registrationData.assessment_public_dto.registration_close_date,
      )
    ) {
      navigate({
        to: "/assessment/examination",
      });
    }
  }, [isPrivateAssessmentAlreadyRegistered]);

  if (isPrivateAssessmentNotAlreadyRegistered)
    return (
      <AssessmentClosedExpiredComponent
        isExpired={false}
        assessmentName={registrationData.assessment_public_dto.assessment_name}
        isPrivate={true}
      />
    );

  if (
    !userAlreadyRegistered &&
    case3Status &&
    !calculateTimeDifference(
      serverTime,
      registrationData.assessment_public_dto.bound_end_time,
    )
  )
    return (
      <AssessmentClosedExpiredComponent
        isExpired={true}
        assessmentName={registrationData.assessment_public_dto.assessment_name}
      />
    );

  if (userHasAttemptCount)
    return (
      <AssessmentRegistrationCompleted
        assessmentId={registrationData.assessment_public_dto.assessment_id}
        assessmentName={registrationData.assessment_public_dto.assessment_name}
        timeLeft={timeLeft}
      />
    );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="p-0 overflow-hidden border border-primary-100 shadow-2xl sm:max-w-reg-430 rounded-2xl">
        <div className="px-5 py-4 bg-gradient-to-r from-primary-50 to-white border-b border-primary-100">
          <h1 className="text-primary-600 font-semibold text-base">
            {t("checkEmailDialog.title")}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {t("checkEmailDialog.subtitle")}
          </p>
        </div>
        <FormProvider {...form}>
          <form className="w-full flex flex-col gap-5 p-5 bg-white">
            <FormItem>
              <FormControl>
                <MyInput
                  inputType="email"
                  inputPlaceholder={t("checkEmailDialog.emailPlaceholder")}
                  input={form.watch("email")}
                  onChangeFunction={(e) =>
                    form.setValue("email", e.target.value)
                  }
                  required={true}
                  size="large"
                  label={t("common.email")}
                  className="!max-w-full !w-full"
                />
              </FormControl>
            </FormItem>
            {isOtpSent && (
              <>
                <div className="flex justify-start gap-2.5">
                  {form.watch("otp").map((_, index) => (
                    <Controller
                      key={index}
                      name={`otp.${index}`}
                      control={form.control}
                      render={({ field }) => (
                        <input
                          ref={(el) => (otpRefs.current[index] = el)}
                          type="text"
                          maxLength={1}
                          value={field.value}
                          onChange={(e) =>
                            handleOtpChange(index, e.target.value)
                          }
                          onKeyDown={(e) => handleKeyDown(index, e)}
                          onPaste={(e) => handlePaste(e)}
                          className="size-10 text-center border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
                        />
                      )}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="text-primary-600 text-xs -mt-1 cursor-pointer w-fit hover:text-primary-700 transition-colors disabled:text-neutral-400 disabled:cursor-not-allowed"
                  onClick={() => timer === 0 && sendOtpMutation.mutate(email)}
                  disabled={timer > 0}
                >
                  {timer > 0 ? (
                    <span className="!text-neutral-400">
                      {t("checkEmailDialog.resendIn", { seconds: timer })}
                    </span>
                  ) : (
                    t("common.resendOtp")
                  )}
                </button>
              </>
            )}
            <div className="flex items-center justify-center flex-col gap-4">
              {!isOtpSent ? (
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  layoutVariant="default"
                  className="w-full"
                  disable={!isEmailValid || sendOtpMutation.isPending}
                  onClick={() => sendOtpMutation.mutate(email)}
                >
                  {sendOtpMutation.isPending ? t("checkEmailDialog.sending") : t("checkEmailDialog.send")}
                </MyButton>
              ) : (
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  layoutVariant="default"
                  className="w-full"
                  disable={!isFormValid || verifyOtpMutation.isPending}
                  onClick={form.handleSubmit(onSubmit)}
                >
                  {verifyOtpMutation.isPending ? t("common.verifying") : t("checkEmailDialog.verify")}
                </MyButton>
              )}
            </div>
          </form>
        </FormProvider>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CheckEmailStatusAlertDialog;
