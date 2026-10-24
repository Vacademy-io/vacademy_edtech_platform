import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionCustomFields } from "../-hooks/useGetRegistrationFormData";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { toast } from "sonner";
import {
  transformToCollectPublicUserDataDTO,
  transformToGuestRegistrationDTO,
  transformToPaidRegistrationDTO,
} from "../-utils/helper";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AccessLevel } from "../-types/enum";
import { LiveSessionPaymentInfo, RegistrationFormValues } from "../-types/type";
import {
  fetchLiveSessionPaymentInfo,
  useCollectPublicUserData,
  useLiveSessionGuestRegistration,
  useLiveSessionRegisterAndPay,
} from "../-hooks/useLiveSessionGuestRegistration";
import { getCurrencySymbol } from "@/utils/currency";
import { Button } from "@/components/ui/button";
import { CreditCard } from "@phosphor-icons/react";
import { useEarliestScheduleId } from "../-hooks/useEarliestScheduleId";
import { fetchSessionDetails } from "@/routes/live-class-guest/-hooks/useSessionDetails";
import { SessionDetailsResponse } from "@/routes/study-library/live-class/-types/types";
import { SessionStreamingServiceType } from "@/routes/register/live-class/-types/enum";
import { getPublicFileUrl } from "../-hooks/getPublicUrl";
import { useMarkAttendance } from "@/routes/live-class-guest/-hooks/useMarkAttendance";
import axios from "axios";
import { urlInstituteDetails } from "@/constants/urls";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";

// Import the separated components
import RegistrationForm from "./RegistrationForm";
import SessionStatusCard from "./SessionStatusCard";
import SessionInfo from "./SessionInfo";
import OtpVerificationDialog, {
  type OtpChannel,
} from "./OtpVerificationDialog";
import {
  getLegacyStoredEmail,
  getRememberedEmails,
  getStoredRegistration,
  storeRegistration,
  type GuestIdentity,
} from "../-utils/guestSessionStorage";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useTheme } from "@/providers/theme/theme-provider";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { trackUtmAttribution } from "@/lib/utm-attribution";

export interface InstituteBrandingInfo {
  instituteName: string | null;
  instituteLogoUrl: string | null;
}

export default function LiveClassRegistrationPage() {
  const { t } = useTranslation("registrationA");
  const liveSession = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession,
  ).toLocaleLowerCase();
  const session = getTerminology(
    ContentTerms.Session,
    SystemTerms.Session,
  ).toLocaleLowerCase();
  const [sessionDetails, setSessionDetails] =
    useState<SessionDetailsResponse | null>(null);
  const router = useRouter();
  const { sessionId } = router.state.location.search;
  const { data, isLoading } = useSessionCustomFields(sessionId || "");
  const { data: earliestScheduleId } = useEarliestScheduleId(sessionId || "");
  const navigate = useNavigate();
  // Logo box / name suppression come from institute_domain_routing, the same
  // source the sidebar, login page and invite form use — the branding fetched
  // below only carries the institute record, not these display overrides.
  const domainRouting = useDomainRouting();
  const { setPrimaryColor } = useTheme();
  const [coverFileUrl, setCoverFileUrl] = useState<string | undefined>(
    undefined
  );
  const [instituteBranding, setInstituteBranding] =
    useState<InstituteBrandingInfo>({ instituteName: null, instituteLogoUrl: null });
  const [registrationResponse, setRegistrationResponse] = useState<string>("");
  const [paymentInfo, setPaymentInfo] = useState<LiveSessionPaymentInfo | null>(
    null
  );
  const { mutateAsync: registerGuestUser } = useLiveSessionGuestRegistration();
  const { mutateAsync: registerAndPay } = useLiveSessionRegisterAndPay();
  const { mutateAsync: collectPublicUserData } = useCollectPublicUserData();
  const [verifiedEmail, setVerifiedEmail] = useState<string>("");
  const [verifiedEmails, setVerifiedEmails] = useState<string[]>([]);
  const [isUserAlreadyRegistered, setIsUserAlreadyRegistered] =
    useState<boolean>(false);
  const [alreadyRegisteredEmail, setAlreadyRegisteredEmail] =
    useState<string>("");
  // True while the on-load "is this device already registered?" lookup runs,
  // so a returning learner never sees the blank form flash before being
  // routed into their class.
  const [resolvingRegistration, setResolvingRegistration] =
    useState<boolean>(true);

  // OTP verification gate (per-session admin config): channels still awaiting
  // verification for the submission parked in pendingSubmissionRef. Identities
  // verified once this page-load are remembered so re-submits skip the OTP.
  const [otpChannels, setOtpChannels] = useState<OtpChannel[]>([]);
  const pendingSubmissionRef = useRef<RegistrationFormValues | null>(null);
  // New-device resume parked behind OTP: someone typed an already-registered
  // identity, but this session requires verification — prove ownership before
  // handing over the registration (a paid one especially).
  const pendingResumeRef = useRef<{
    identity: GuestIdentity;
    info: LiveSessionPaymentInfo;
  } | null>(null);
  const verifiedIdentitiesRef = useRef<Set<string>>(new Set());

  const { mutateAsync: markAttendance } = useMarkAttendance();

  // Emails this device has used before — prefill only, no verification step.
  useEffect(() => {
    setVerifiedEmails(getRememberedEmails());
  }, []);

  const fetchCoverFileUrl = useCallback(async () => {
    const response = await getPublicFileUrl(data?.coverFileId || "");
    setCoverFileUrl(response);
  }, [data?.coverFileId]);

  // Fetch institute branding: first try cached domain routing, then fallback to public API using session's instituteId
  const fetchInstituteBranding = useCallback(async () => {
    try {
      // Try cached branding first (from domain routing)
      const cached = getCachedInstituteBranding();
      if (cached?.instituteName || cached?.instituteLogoFileId) {
        let logoUrl: string | null = null;
        if (cached.instituteLogoFileId) {
          try {
            logoUrl = await getPublicFileUrl(cached.instituteLogoFileId);
          } catch {
            // ignore logo fetch failure
          }
        }
        // Apply theme from cached branding
        if (cached.instituteThemeCode) {
          setPrimaryColor(cached.instituteThemeCode);
        }
        setInstituteBranding({
          instituteName: cached.instituteName,
          instituteLogoUrl: logoUrl,
        });
        return;
      }

      // Fallback: fetch institute details using the session's instituteId
      if (!data?.instituteId) return;
      const response = await axios.get(
        `${urlInstituteDetails}/${data.instituteId}`,
        { params: { instituteId: data.instituteId } }
      );
      const details = response.data;
      let logoUrl: string | null = null;
      if (details?.institute_logo_file_id) {
        try {
          logoUrl = await getPublicFileUrl(details.institute_logo_file_id);
        } catch {
          // ignore logo fetch failure
        }
      }
      // Apply the institute theme
      if (details?.institute_theme_code) {
        setPrimaryColor(details.institute_theme_code);
      }
      setInstituteBranding({
        instituteName: details?.institute_name || null,
        instituteLogoUrl: logoUrl,
      });
    } catch (error) {
      console.error("Failed to fetch institute branding:", error);
    }
  }, [data?.instituteId, setPrimaryColor]);

  const fetchSessionDetail = useCallback(async (id: string) => {
    try {
      const response = await fetchSessionDetails(id);
      setSessionDetails(response);
    } catch (error) {
      console.error("Failed to fetch session details:", error);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      router.navigate({ to: "/dashboard" });
    } else {
      const scheduleIdToUse = earliestScheduleId || sessionId;
      fetchSessionDetail(scheduleIdToUse);
    }
  }, [sessionId, earliestScheduleId, fetchSessionDetail, router]);

  useEffect(() => {
    if (data?.accessLevel === AccessLevel.PRIVATE) {
      router.navigate({ to: "/study-library/live-class" });
    } else {
      fetchCoverFileUrl();
      fetchInstituteBranding();
    }
  }, [data, fetchCoverFileUrl, fetchInstituteBranding, router]);

  const goToInvoicePayment = useCallback(
    (invoiceId: string) => {
      // Mark that we're leaving for payment so the return visit auto-resumes
      // straight into the class instead of parking on the status card.
      try {
        sessionStorage.setItem(`live-session-paying:${sessionId ?? ""}`, "1");
      } catch {
        /* storage blocked — return flow just shows the join card instead */
      }
      const redirect = `${window.location.pathname}${window.location.search}`;
      navigate({
        to: "/pay/invoice/$invoiceId",
        params: { invoiceId },
        search: { redirect },
      });
    },
    [navigate, sessionId]
  );

  // On load (refresh, closed tab, returning from the payment page): resolve
  // whether this device's known email is already registered for THIS session —
  // free and paid alike — so a returning learner is routed straight back into
  // the class instead of seeing the registration form again.
  useEffect(() => {
    const resolveExistingRegistration = async () => {
      if (isLoading) return;
      if (!data?.sessionId) {
        setResolvingRegistration(false);
        return;
      }
      try {
        const stored = getStoredRegistration(data.sessionId);
        const candidateEmail =
          stored?.email ||
          (await getLegacyStoredEmail()) ||
          getRememberedEmails()[0];
        const candidatePhone = stored?.mobileNumber;
        if (!candidateEmail && !candidatePhone) return; // brand-new visitor → show the form

        if (candidateEmail) setVerifiedEmail(candidateEmail);
        // payment-info doubles as the registration lookup for free sessions
        // (registration_id is filled whenever the email/phone is registered).
        const info = await fetchLiveSessionPaymentInfo(
          data.sessionId,
          candidateEmail,
          candidatePhone
        );
        setPaymentInfo(info);
        if (!info.registration_id) return; // known identity, not registered here

        await storeRegistration(
          data.sessionId,
          { email: candidateEmail, mobileNumber: candidatePhone },
          info.registration_id
        );
        setRegistrationResponse(info.registration_id);
        setIsUserAlreadyRegistered(true);
        setAlreadyRegisteredEmail(candidateEmail || candidatePhone || "");
        if (!info.payment_required || info.payment_status === "PAID") {
          // Fresh return from the payment page: don't park on the status card —
          // take the payer directly into the class (waiting room / live join).
          let cameFromPayment = false;
          try {
            const justPaidKey = `live-session-paying:${data.sessionId}`;
            cameFromPayment = sessionStorage.getItem(justPaidKey) === "1";
            if (cameFromPayment) sessionStorage.removeItem(justPaidKey);
          } catch {
            /* ignore */
          }
          if (cameFromPayment && info.payment_status === "PAID") {
            const details = await fetchSessionDetails(
              earliestScheduleId || sessionId || ""
            );
            if (details) {
              setSessionDetails(details);
              await handlePostRegistrationNavigation(
                details,
                info.registration_id
              );
              return;
            }
          }
          // refetch with the registration id now persisted (paid access needs it)
          fetchSessionDetail(earliestScheduleId || sessionId || "");
        }
      } catch (error) {
        console.error("Failed to resolve live-session registration:", error);
        // Offline/flaky lookup: trust the cached per-session record so the
        // returning learner still lands on the join card instead of the form.
        const cached = getStoredRegistration(data.sessionId);
        if (cached) {
          setRegistrationResponse(cached.registrationId);
          setIsUserAlreadyRegistered(true);
          setAlreadyRegisteredEmail(cached.email);
          fetchSessionDetail(earliestScheduleId || sessionId || "");
        }
      } finally {
        setResolvingRegistration(false);
      }
    };
    resolveExistingRegistration();
  }, [
    isLoading,
    data?.sessionId,
    sessionId,
    earliestScheduleId,
    fetchSessionDetail,
  ]);

  const onSubmit = async (formValues: RegistrationFormValues) => {
    let payload;
    let userPayload;
    // Extract email robustly: try form value, then look in custom fields
    let email = formValues.email ? String(formValues.email) : "";
    if (!email || email === "undefined") {
      const emailField = (data?.customFields || []).find(
        (f) =>
          f.fieldKey === "email" ||
          f.fieldKey === "email_address" ||
          f.fieldName.toLowerCase() === "email"
      );
      if (emailField) {
        const val = formValues[emailField.fieldKey];
        if (val) email = String(val);
      }
    }
    // Final fallback: use the verified email
    if (!email || email === "undefined") {
      email = verifiedEmail || "";
    }
    try {
      payload = transformToGuestRegistrationDTO(
        formValues,
        data?.sessionId || "",
        data?.customFields || []
      );

      userPayload = transformToCollectPublicUserDataDTO(
        formValues,
        data?.sessionId || "",
        data?.customFields || []
      );
    } catch (error) {
      toast.error(t("liveClass.page.toast.buildRequestError"));
      console.error("DTO transformation error:", error);
      return;
    }
    if (!email) {
      email = payload.email || "";
    }
    const mobileNumber = payload.mobile_number || "";
    const identity: GuestIdentity = {
      email: email || undefined,
      mobileNumber: mobileNumber || undefined,
    };
    // At least one identity is required; paid classes additionally need an
    // email because the invoice is billed and mailed to it.
    if (!email && !mobileNumber) {
      toast.error(t("liveClass.page.toast.identityRequired"));
      return;
    }
    if (data?.paymentRequired && !email) {
      toast.error(t("liveClass.page.toast.emailRequiredPaid", { liveSession }));
      return;
    }

    // Per-session OTP verification gate: park the submission and collect the
    // channels the admin requires that haven't been verified yet this visit.
    // onVerified releases the parked submission back through this function.
    const channelsToVerify: OtpChannel[] = [];
    if (data?.requireEmailVerification) {
      if (!email) {
        toast.error(t("liveClass.page.toast.emailRequired", { liveSession }));
        return;
      }
      if (!verifiedIdentitiesRef.current.has(`email:${email.toLowerCase()}`)) {
        channelsToVerify.push({ type: "email", value: email });
      }
    }
    if (data?.requirePhoneVerification) {
      if (!mobileNumber) {
        toast.error(t("liveClass.page.toast.phoneRequired", { liveSession }));
        return;
      }
      const digits = mobileNumber.replace(/\D/g, "");
      if (!verifiedIdentitiesRef.current.has(`phone:${digits}`)) {
        channelsToVerify.push({ type: "phone", value: mobileNumber });
      }
    }
    if (channelsToVerify.length > 0) {
      pendingSubmissionRef.current = formValues;
      setOtpChannels(channelsToVerify);
      return;
    }

    // Both the paid and the free branch below end in a successful
    // registration, and both need the same attribution recorded — declared once
    // here so a change to one branch cannot quietly leave the other untracked.
    const recordUtmTouch = () =>
      trackUtmAttribution({
        instituteId: data?.instituteId,
        email: email || undefined,
        mobileNumber: mobileNumber || undefined,
        sourceType: "LIVE_SESSION",
        sourceId: data?.sessionId,
      });

    // Paid live class: one call registers the guest AND raises the fee invoice,
    // then we hand off to the shared /pay/invoice page. Joining stays locked
    // until the invoice is settled (server-enforced).
    if (data?.paymentRequired) {
      try {
        const paidPayload = transformToPaidRegistrationDTO(
          formValues,
          data?.sessionId || "",
          data?.customFields || []
        );
        const payResponse = await registerAndPay(paidPayload);
        setPaymentInfo(payResponse);
        if (payResponse.registration_id) {
          setRegistrationResponse(payResponse.registration_id);
          await storeRegistration(
            data?.sessionId || "",
            identity,
            payResponse.registration_id
          );
        }
        try {
          await collectPublicUserData({
            payload: userPayload,
            instituteId: data?.instituteId || "",
          });
        } catch (collectError) {
          console.error("Failed to collect public user data:", collectError);
        }
        recordUtmTouch();
        setIsUserAlreadyRegistered(true);
        setAlreadyRegisteredEmail(email);
        if (
          payResponse.payment_status === "PAID" ||
          !payResponse.payment_required
        ) {
          toast.success(t("liveClass.page.toast.registrationSuccess"));
          const sessionDetailResponse = await fetchSessionDetails(
            earliestScheduleId || ""
          );
          if (sessionDetailResponse) {
            await handlePostRegistrationNavigation(
              sessionDetailResponse,
              payResponse.registration_id || ""
            );
            setSessionDetails(sessionDetailResponse);
          }
        } else if (payResponse.invoice_id) {
          // Stay on this page: the render below swaps the form for the
          // "Payment pending" card with the Pay & Confirm button, exactly what
          // a returning visitor sees. Payment navigation only ever happens
          // from that explicit click — never automatically.
          toast.success(t("liveClass.page.toast.spotReserved"));
        }
      } catch (error) {
        console.error("Paid registration failed:", error);
      }
      return;
    }

    try {
      const registerResponse = await registerGuestUser(payload);
      setRegistrationResponse(registerResponse);

      if (registerResponse) {
        await storeRegistration(data?.sessionId || "", identity, registerResponse);
        toast.success(t("liveClass.page.toast.registrationSuccess"));

        const sessionDetailResponse = await fetchSessionDetails(
          earliestScheduleId || ""
        );

        if (sessionDetailResponse) {
          await handlePostRegistrationNavigation(
            sessionDetailResponse,
            registerResponse
          );
          setSessionDetails(sessionDetailResponse);
          setIsUserAlreadyRegistered(true);
          setAlreadyRegisteredEmail(email || mobileNumber);
        }
      }

      try {
        await collectPublicUserData({
          payload: userPayload,
          instituteId: data?.instituteId || "",
        });
      } catch (collectError) {
        console.error("Failed to collect public user data:", collectError);
      }
      recordUtmTouch();
    } catch (error: any) {
      console.error("Registration API call failed:", error);

      // Legacy backend duplicate-registration error (the current backend is
      // idempotent and returns the existing id instead). Recover by looking the
      // registration up server-side — works even on a fresh device.
      if (error?.response?.status === 511 || error?.response?.data?.ex?.includes("already")) {
        setIsUserAlreadyRegistered(true);
        setAlreadyRegisteredEmail(email || mobileNumber);
        try {
          const info = await fetchLiveSessionPaymentInfo(
            data?.sessionId || "",
            email,
            mobileNumber
          );
          if (info.registration_id) {
            await storeRegistration(
              data?.sessionId || "",
              identity,
              info.registration_id
            );
            setRegistrationResponse(info.registration_id);
            const sessionDetailResponse = await fetchSessionDetails(
              earliestScheduleId || ""
            );
            if (sessionDetailResponse) {
              await handlePostRegistrationNavigation(
                sessionDetailResponse,
                info.registration_id
              );
              setSessionDetails(sessionDetailResponse);
            }
          }
        } catch (recoveryError) {
          console.error("Failed to recover existing registration:", recoveryError);
        }
      }
    }
  };

  const handlePostRegistrationNavigation = async (
    sessionDetailResponse: SessionDetailsResponse,
    guestId: string
  ) => {
    const now = new Date();

    if (!sessionDetailResponse.meetingDate || !sessionDetailResponse.scheduleStartTime) {
      console.error("Missing session date or time data");
      return;
    }

    // Check if session has timezone information
    const sessionTimezone = (sessionDetailResponse as any).timezone;

    let sessionDate: Date;

    if (sessionTimezone) {
      try {
        sessionDate = convertSessionTimeToUserTimezone(
          sessionDetailResponse.meetingDate,
          sessionDetailResponse.scheduleStartTime,
          sessionTimezone
        );
      } catch (error) {
        console.error("Error converting timezone:", error);
        sessionDate = new Date(`${sessionDetailResponse.meetingDate}T${sessionDetailResponse.scheduleStartTime}`);
      }
    } else {
      sessionDate = new Date(`${sessionDetailResponse.meetingDate}T${sessionDetailResponse.scheduleStartTime}`);
    }

    if (isNaN(sessionDate.getTime())) return;

    const waitingRoomStart = new Date(sessionDate);
    waitingRoomStart.setMinutes(
      waitingRoomStart.getMinutes() - (sessionDetailResponse.waitingRoomTime ?? 0)
    );

    const isInWaitingRoom = now >= waitingRoomStart && now < sessionDate;
    const isInMainSession = now >= sessionDate;

    const handleSessionNavigation = async () => {
      const streamingType = sessionDetailResponse.sessionStreamingServiceType?.toLowerCase();
      if (isInWaitingRoom) {
        await navigate({
          to: "/live-class-guest/waiting-room",
          search: {
            sessionId: earliestScheduleId || "",
            guestId: guestId || "",
          },
        });
      } else if (
        isInMainSession &&
        sessionDetailResponse.defaultMeetLink &&
        streamingType === SessionStreamingServiceType.EMBED.toLowerCase()
      ) {
        try {
          await markAttendance({
            sessionId: sessionDetailResponse.sessionId,
            scheduleId: earliestScheduleId || "",
            userSourceType: "EXTERNAL_USER",
            userSourceId: guestId || "",
            details: "Guest joined live class after registration",
          });
        } catch (err) {
          console.error("Attendance marking failed, but proceeding to embed:", err);
        }
        navigate({
          to: "/live-class-guest/embed",
          search: {
            sessionId: earliestScheduleId || "",
          },
        });
      } else if (
        isInMainSession &&
        sessionDetailResponse.defaultMeetLink &&
        (streamingType === SessionStreamingServiceType.REDIRECT.toLowerCase() || !streamingType)
      ) {
        const joinLink = sessionDetailResponse.customMeetingLink || sessionDetailResponse.defaultMeetLink;
        window.open(joinLink, "_blank", "noopener,noreferrer");
      }
    };

    await handleSessionNavigation();
  };

  const onError = (errors: unknown) => {
    console.log("Validation errors:", errors);
  };

  // Finishes a typed-identity resume: persist the registration locally and
  // collapse the form into the registered state.
  const completeIdentityResume = async (
    identity: GuestIdentity,
    info: LiveSessionPaymentInfo
  ) => {
    if (!data?.sessionId || !info.registration_id) return;
    await storeRegistration(data.sessionId, identity, info.registration_id);
    setRegistrationResponse(info.registration_id);
    setIsUserAlreadyRegistered(true);
    setAlreadyRegisteredEmail(identity.email || identity.mobileNumber || "");
    toast.success(t("liveClass.page.toast.alreadyRegistered", { session }));
    if (!info.payment_required || info.payment_status === "PAID") {
      fetchSessionDetail(earliestScheduleId || sessionId || "");
    }
  };

  // Called when the learner types/picks an email or mobile number in the form:
  // silently look up whether that identity is already registered for this
  // session. On a match, collapse into the registered state — but when the
  // session requires OTP verification, prove ownership of the typed identity
  // first (this is the new-device path; without it anyone who knows a payer's
  // email could take over their seat). Returns whether a registration was
  // found so the form's explicit "Already registered?" lookup can react.
  const checkIdentityRegistration = async (
    identity: GuestIdentity
  ): Promise<boolean> => {
    if (!data?.sessionId) return false;
    if (!identity.email && !identity.mobileNumber) return false;
    try {
      const info = await fetchLiveSessionPaymentInfo(
        data.sessionId,
        identity.email,
        identity.mobileNumber
      );
      setPaymentInfo(info);
      if (info.registration_id) {
        const channelsToVerify: OtpChannel[] = [];
        if (
          data?.requireEmailVerification &&
          identity.email &&
          !verifiedIdentitiesRef.current.has(
            `email:${identity.email.toLowerCase()}`
          )
        ) {
          channelsToVerify.push({ type: "email", value: identity.email });
        }
        if (
          data?.requirePhoneVerification &&
          identity.mobileNumber &&
          !verifiedIdentitiesRef.current.has(
            `phone:${identity.mobileNumber.replace(/\D/g, "")}`
          )
        ) {
          channelsToVerify.push({
            type: "phone",
            value: identity.mobileNumber,
          });
        }
        if (channelsToVerify.length > 0) {
          pendingResumeRef.current = { identity, info };
          setOtpChannels(channelsToVerify);
          return true;
        }
        await completeIdentityResume(identity, info);
        return true;
      } else {
        setIsUserAlreadyRegistered(false);
        return false;
      }
    } catch (error) {
      console.error("Failed to check registration:", error);
      return false;
    }
  };

  const handleIdentityChange = (identity: GuestIdentity): Promise<boolean> => {
    if (identity.email) setVerifiedEmail(identity.email);
    return checkIdentityRegistration(identity);
  };

  if (isLoading || resolvingRegistration) return <DashboardLoader />;

  return (
    <>
      <div className="w-screen min-h-screen bg-gradient-to-b from-primary-50/80 via-white to-primary-50/40 relative overflow-hidden">
        {/* Hero background: the admin-uploaded cover becomes a full-bleed
            backdrop with a dark gradient for contrast; the content sits on
            frosted cards. Without a cover, keep the soft theme gradient. */}
        {coverFileUrl ? (
          <>
            <img
              src={coverFileUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
          </>
        ) : (
          <>
            {/* Decorative background elements */}
            <div className="absolute top-0 end-0 w-blob-lg h-blob-lg bg-primary-100/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
            <div className="absolute bottom-0 start-0 w-blob-md h-blob-md bg-primary-100/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3 pointer-events-none" />
          </>
        )}

        <div className="relative z-10 w-full min-h-screen p-4 sm:p-8 lg:p-12 flex flex-col lg:flex-row gap-8 lg:gap-14 justify-center items-center max-w-7xl mx-auto">
          <SessionInfo
            sessionTitle={data?.sessionTitle}
            startTime={data?.startTime}
            lastEntryTime={data?.lastEntryTime}
            sessionDetails={sessionDetails}
            instituteName={instituteBranding.instituteName}
            instituteLogoUrl={instituteBranding.instituteLogoUrl}
            logoWidthPx={domainRouting.logoWidthPx}
            logoHeightPx={domainRouting.logoHeightPx}
            hideInstituteName={domainRouting.hideInstituteName}
            glass={!!coverFileUrl}
          />

          <div className="w-full max-w-reg-420 lg:w-blob-sm flex-shrink-0">
            {data?.paymentRequired && !isUserAlreadyRegistered && (
              <div className="mb-3 flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 px-4 py-3">
                <span className="text-body font-medium text-foreground">
                  {t("liveClass.page.priceLabel")}
                </span>
                <span className="text-subtitle font-semibold text-primary-500">
                  {getCurrencySymbol(data.currency || "")}
                  {data.price}
                </span>
              </div>
            )}
            {isUserAlreadyRegistered &&
            data?.paymentRequired &&
            paymentInfo?.payment_status !== "PAID" ? (
              <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div>
                  <h2 className="text-subtitle font-semibold text-foreground">
                    {t("liveClass.page.completeRegistration")}
                  </h2>
                  <p className="mt-1 text-body text-muted-foreground">
                    {t("liveClass.page.completeRegistrationDescription")}
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-primary-50 px-4 py-3">
                  <span className="text-body text-muted-foreground">{t("liveClass.page.total")}</span>
                  <span className="text-subtitle font-semibold text-primary-500">
                    {getCurrencySymbol(
                      paymentInfo?.currency || data.currency || ""
                    )}
                    {paymentInfo?.total_amount ??
                      paymentInfo?.price ??
                      data.price}
                  </span>
                </div>
                <Button
                  size="lg"
                  className="w-full gap-2"
                  disabled={!paymentInfo?.invoice_id}
                  onClick={() =>
                    paymentInfo?.invoice_id &&
                    goToInvoicePayment(paymentInfo.invoice_id)
                  }
                >
                  <CreditCard size={18} weight="regular" />
                  {t("liveClass.page.payAndConfirm")}
                </Button>
              </div>
            ) : isUserAlreadyRegistered && sessionDetails ? (
              <SessionStatusCard
                sessionDetails={sessionDetails}
                registrationResponse={registrationResponse}
                alreadyRegisteredEmail={alreadyRegisteredEmail}
                earliestScheduleId={earliestScheduleId || ""}
              />
            ) : (
              <RegistrationForm
                customFields={data?.customFields || []}
                verifiedEmail={verifiedEmail}
                verifiedEmails={verifiedEmails}
                paymentRequired={!!data?.paymentRequired}
                requireEmailVerification={!!data?.requireEmailVerification}
                requirePhoneVerification={!!data?.requirePhoneVerification}
                onSubmit={onSubmit}
                onError={onError}
                onIdentityChange={handleIdentityChange}
              />
            )}
          </div>
        </div>
      </div>

      <OtpVerificationDialog
        open={otpChannels.length > 0}
        channels={otpChannels}
        instituteId={data?.instituteId || ""}
        whatsappTemplateName={data?.whatsappOtpTemplateName}
        onVerified={() => {
          otpChannels.forEach((channel) => {
            const key =
              channel.type === "email"
                ? `email:${channel.value.toLowerCase()}`
                : `phone:${channel.value.replace(/\D/g, "")}`;
            verifiedIdentitiesRef.current.add(key);
          });
          setOtpChannels([]);
          const pendingSubmit = pendingSubmissionRef.current;
          const pendingResume = pendingResumeRef.current;
          pendingSubmissionRef.current = null;
          pendingResumeRef.current = null;
          if (pendingSubmit) {
            onSubmit(pendingSubmit);
          } else if (pendingResume) {
            completeIdentityResume(pendingResume.identity, pendingResume.info);
          }
        }}
        onClose={() => {
          setOtpChannels([]);
          pendingSubmissionRef.current = null;
          pendingResumeRef.current = null;
        }}
      />
    </>
  );
}
