import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle,
  CircleNotch,
  Clock,
  HourglassMedium,
  MapPin,
  VideoCamera,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { handleGetPublicInstituteDetails } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";
import {
  ModernCard,
  ModernCardHeader,
  ModernCardTitle,
} from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { MyInput } from "@/components/design-system/input";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { getDynamicSchema } from "@/routes/register/-utils/helper";
import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import SlotPicker from "./slot-picker";
import BookingCustomFields from "./booking-custom-fields";
import {
  BookingCustomFieldFormValue,
  buildBookingCustomFieldDefaults,
  buildCustomFieldValues,
  convertBookingCustomFields,
} from "../-utils/booking-custom-field-utils";
import { buildBookPayload, shouldSkipDetails } from "../-utils/booking-flow";
import {
  BookingPageResponse,
  BookingView,
  bookSlot,
  extractBookingErrorMessage,
  getBrowserTimezone,
} from "../-services/booking-services";
import { useTranslation } from "react-i18next";

// Fixed invitee fields + the page's campaign custom fields (validated by the
// same getDynamicSchema the audience-response/register forms use, nested
// under the `custom` group).
//
// `authed` drops the identity rules entirely: a signed-in learner never sees those
// three inputs, and the authenticated book endpoint fills name/email/phone in from
// their account. Keeping the rules would fail validation on fields nobody can fill.
interface DetailsValidationMessages {
  nameRequired: string;
  emailInvalid: string;
  identityRequired: string;
  phoneInvalid: string;
}

const buildDetailsSchema = (
  formFields: AssessmentCustomFieldOpenRegistration[],
  authed: boolean,
  messages: DetailsValidationMessages
) => {
  const base = z.object({
    name: authed
      ? z.string().trim()
      : z.string().trim().min(1, messages.nameRequired),
    email: z.string().trim().email(messages.emailInvalid).or(z.literal("")),
    phone: z.string().trim(),
    custom: getDynamicSchema(formFields),
  });
  if (authed) return base;
  return base
    .refine((v) => v.email !== "" || v.phone !== "", {
      message: messages.identityRequired,
      path: ["email"],
    })
    .refine((v) => v.phone === "" || v.phone.replace(/\D/g, "").length >= 7, {
      message: messages.phoneInvalid,
      path: ["phone"],
    });
};

interface DetailsFormValues {
  name: string;
  email: string;
  phone: string;
  custom: Record<string, BookingCustomFieldFormValue>;
}

interface BookingPageProps {
  pageData: BookingPageResponse;
  instituteId: string;
  slug: string;
  // When true (My Mentors flow), book via the authenticated endpoint so the
  // meeting is tied to the learner's account. Public links leave this unset.
  authed?: boolean;
}

type Step = "pick" | "details" | "confirmed";

const formatSlotFull = (iso: string, tz: string) =>
  formatInTimeZone(new Date(iso), tz, "EEEE, d MMMM yyyy 'at' h:mm a");

/** Confirmation view — shared shape for both PENDING and CONFIRMED bookings. */
export const BookingConfirmation = ({
  booking,
  instituteId,
}: {
  booking: BookingView;
  instituteId?: string;
}) => {
  const { t } = useTranslation("liveClassGuest");
  const isPending = booking.status === "PENDING";
  const tz = booking.invitee_timezone;
  return (
    <div className="flex flex-col items-center gap-section py-6 text-center">
      <div
        className={
          isPending
            ? "flex size-16 items-center justify-center rounded-full bg-warning-50"
            : "flex size-16 items-center justify-center rounded-full bg-success-50"
        }
      >
        {isPending ? (
          <HourglassMedium size={32} className="text-warning-600" />
        ) : (
          <CheckCircle size={32} className="text-success-600" />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold text-neutral-700">
          {isPending
            ? t("bookingResponse.confirmation.pendingTitle")
            : t("bookingResponse.confirmation.confirmedTitle")}
        </h2>
        <p className="text-body text-neutral-500">
          {isPending
            ? booking.host_name
              ? t("bookingResponse.confirmation.pendingWithHost", {
                  title: booking.title,
                  host: booking.host_name,
                })
              : t("bookingResponse.confirmation.pendingNoHost", {
                  title: booking.title,
                })
            : booking.host_name
              ? t("bookingResponse.confirmation.confirmedWithHost", {
                  title: booking.title,
                  host: booking.host_name,
                })
              : t("bookingResponse.confirmation.confirmedNoHost", {
                  title: booking.title,
                })}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-left">
        <div className="flex items-center gap-2 text-body text-neutral-600">
          <CalendarCheck size={18} className="shrink-0 text-primary-500" />
          <span className="font-semibold">
            {formatSlotFull(booking.start_time_utc, tz)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-caption text-neutral-500">
          <Clock size={18} className="shrink-0 text-primary-500" />
          <span>{t("common.timezoneLabel", { tz: tz.replace(/_/g, " ") })}</span>
        </div>
      </div>
      {booking.meet_link && (
        <a
          href={booking.meet_link}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full"
        >
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            className="w-full"
          >
            <VideoCamera size={18} className="me-2" /> {t("common.joinMeetingLink")}
          </MyButton>
        </a>
      )}
      <p className="text-caption text-neutral-500">
        {booking.invitee_email
          ? t("bookingResponse.confirmation.emailSentWithAddress", {
              email: booking.invitee_email,
            })
          : t("bookingResponse.confirmation.emailSentGeneric")}
      </p>
      <Link
        to="/booking-manage"
        search={{ token: booking.manage_token, instituteId }}
        className="text-body font-semibold text-primary-500 underline-offset-2 hover:underline"
      >
        {t("bookingResponse.confirmation.manageLink")}
      </Link>
    </div>
  );
};

const BookingPage = ({ pageData, instituteId, slug, authed }: BookingPageProps) => {
  const { t } = useTranslation("liveClassGuest");
  const domainRouting = useDomainRouting();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("pick");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedTz, setSelectedTz] = useState<string | null>(null);
  // Picker state lives here (not in SlotPicker) so it survives navigating to
  // the details step and back, or a slot-taken failure returning to "pick".
  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const [pickerTz, setPickerTz] = useState<string>(browserTz);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<BookingView | null>(null);

  // Session types: when the page offers more than one bookable length the invitee
  // picks one first; its duration drives slot fetching and the booking length.
  const sessionTypes = pageData.session_types ?? [];
  const [selectedTypeIdx, setSelectedTypeIdx] = useState(0);
  const selectedType =
    sessionTypes.length > 0
      ? sessionTypes[Math.min(selectedTypeIdx, sessionTypes.length - 1)]
      : undefined;
  const selectedDuration = selectedType?.duration_minutes;

  const { data: instituteData } = useQuery(
    handleGetPublicInstituteDetails({ instituteId })
  );

  // Campaign custom fields linked to this booking page (empty for standalone
  // pages). Rendered in the details step and validated alongside the fixed
  // fields.
  const formFields = useMemo(
    () => convertBookingCustomFields(pageData.custom_fields ?? []),
    [pageData.custom_fields]
  );
  const detailsSchema = useMemo(
    () =>
      buildDetailsSchema(formFields, !!authed, {
        nameRequired: t("bookingResponse.page.validation.nameRequired"),
        emailInvalid: t("bookingResponse.page.validation.emailInvalid"),
        identityRequired: t("bookingResponse.page.validation.identityRequired"),
        phoneInvalid: t("bookingResponse.page.validation.phoneInvalid"),
      }),
    [formFields, authed, t]
  );

  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema) as Resolver<DetailsFormValues>,
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      custom: buildBookingCustomFieldDefaults(formFields),
    },
    mode: "onChange",
  });

  /**
   * A signed-in learner with nothing left to answer goes straight from the slot to a
   * confirmed booking. Asking them to retype the name, email and phone their account
   * already holds was the whole of the "details" step for a mentor booking — pure
   * friction, and a typo there meant the confirmation went to nobody.
   */
  const bookDirectly = shouldSkipDetails(!!authed, formFields.length);

  const handleSlotSelected = (slotIso: string, tz: string) => {
    // On the direct path a tap IS the booking, so a second tap while the first is
    // still in flight would create two meetings. There is no submit button to disable.
    if (submitting) return;
    setSelectedSlot(slotIso);
    setSelectedTz(tz);
    if (bookDirectly) {
      void confirmBooking(slotIso, tz, {});
      return;
    }
    setStep("details");
  };

  /**
   * The one place a booking is created, whether it came from the details form or
   * straight off a slot tap. `authed` bookings send no identity: the authenticated
   * endpoint fills it from the caller's own account.
   */
  const confirmBooking = async (
    slotIso: string,
    tz: string,
    values: Partial<DetailsFormValues>
  ) => {
    setSubmitting(true);
    try {
      const customFieldValues = buildCustomFieldValues(
        formFields,
        values.custom ?? {}
      );
      const result = await bookSlot({
        instituteId,
        slug,
        authenticated: authed,
        payload: buildBookPayload({
          identity: {
            name: values.name,
            email: values.email,
            phone: values.phone,
          },
          startTime: slotIso,
          inviteeTimezone: tz,
          customFieldValues,
          durationMinutes: selectedDuration,
        }),
      });
      setBooking(result);
      setStep("confirmed");
    } catch (error) {
      // Most common: the slot was taken while filling the form. Surface the
      // backend message, refresh availability and send the user back to pick.
      toast.error(
        extractBookingErrorMessage(
          error,
          t("bookingResponse.page.bookingFailed")
        )
      );
      await queryClient.invalidateQueries({ queryKey: ["GET_BOOKING_SLOTS"] });
      setSelectedSlot(null);
      setStep("pick");
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (values: DetailsFormValues) => {
    if (!selectedSlot || !selectedTz) return;
    await confirmBooking(selectedSlot, selectedTz, values);
  };

  return (
    <div className="min-h-screen w-full bg-neutral-50">
      {/* Navbar header (mirrors audience-response) */}
      <nav className="sticky top-0 z-50 border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-start py-3">
            <InstituteBrandingComponent
              branding={{
                instituteId: instituteId || null,
                instituteName:
                  instituteData?.institute_name ?? instituteData?.name ?? null,
                instituteLogoFileId:
                  instituteData?.institute_logo_file_id ?? null,
                instituteThemeCode:
                  (instituteData?.institute_theme_code as string) ||
                  (instituteData?.theme as string) ||
                  null,
                homeIconClickRoute: domainRouting.homeIconClickRoute ?? null,
                hideInstituteName: domainRouting.hideInstituteName,
                logoWidthPx: domainRouting.logoWidthPx,
                logoHeightPx: domainRouting.logoHeightPx,
              }}
              size="medium"
              showName={true}
              className="!flex-row !items-center !gap-3"
            />
          </div>
        </div>
      </nav>

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-section">
          {/* Page header */}
          <ModernCard variant="glass" padding="lg" rounded="lg">
            <ModernCardHeader className="mb-2 p-0">
              <ModernCardTitle size="lg" className="text-neutral-700">
                {pageData.title}
              </ModernCardTitle>
            </ModernCardHeader>
            {pageData.host_name && (
              <p className="text-body text-neutral-600">
                {t("common.hostedBy")}{" "}
                <span className="font-semibold">{pageData.host_name}</span>
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-4 text-caption text-neutral-500">
              <span className="flex items-center gap-1">
                <Clock size={16} className="text-primary-500" />
                {selectedDuration ?? pageData.duration_minutes}{" "}
                {t("bookingResponse.page.minutesShort")}
              </span>
              {pageData.location_type && (
                <span className="flex items-center gap-1">
                  <MapPin size={16} className="text-primary-500" />
                  {pageData.location_type.replace(/_/g, " ").toLowerCase()}
                </span>
              )}
            </div>
            {pageData.description && (
              <p className="mt-3 text-body leading-relaxed text-neutral-600">
                {pageData.description}
              </p>
            )}
          </ModernCard>

          {/* Step content */}
          <ModernCard variant="glass" padding="lg" rounded="lg">
            {step === "pick" && submitting && bookDirectly && (
              // The direct path has no form to sit on while the POST runs, so the
              // picker is replaced rather than left tappable — a second tap would
              // race the first booking.
              <div className="flex flex-col items-center gap-stack py-10 text-center">
                <CircleNotch
                  size={28}
                  className="animate-spin text-primary-500"
                />
                <p className="text-body text-neutral-600">
                  {t("bookingResponse.page.bookingInProgress")}
                </p>
              </div>
            )}

            {step === "pick" && !(submitting && bookDirectly) && (
              <>
                {sessionTypes.length > 0 && (
                  <div className="mb-5 space-y-stack">
                    <ModernCardHeader className="p-0">
                      <ModernCardTitle size="md" className="text-neutral-700">
                        {t("bookingResponse.page.chooseSession")}
                      </ModernCardTitle>
                    </ModernCardHeader>
                    <div className="flex flex-wrap gap-2">
                      {sessionTypes.map((st, i) => {
                        const active = i === selectedTypeIdx;
                        return (
                          <button
                            key={st.id ?? `${st.name}-${i}`}
                            type="button"
                            onClick={() => {
                              setSelectedTypeIdx(i);
                              setSelectedSlot(null);
                            }}
                            className={cn(
                              "flex flex-col items-start rounded-lg border px-4 py-2 text-left transition-colors",
                              active
                                ? "border-primary-500 bg-primary-50"
                                : "border-neutral-200 bg-white hover:border-primary-200"
                            )}
                          >
                            <span className="text-body font-medium text-neutral-700">
                              {st.name}
                            </span>
                            <span className="flex items-center gap-1 text-caption text-neutral-500">
                              <Clock size={12} className="text-primary-500" />
                              {st.duration_minutes} {t("bookingResponse.page.minutesShort")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <ModernCardHeader className="mb-4 p-0">
                  <ModernCardTitle size="md" className="text-neutral-700">
                    {t("bookingResponse.page.pickATime")}
                  </ModernCardTitle>
                </ModernCardHeader>
                <SlotPicker
                  instituteId={instituteId}
                  slug={slug}
                  pageTimezone={pageData.timezone}
                  bookingHorizonDays={pageData.booking_horizon_days}
                  onSelect={handleSlotSelected}
                  selectedSlot={selectedSlot}
                  browserTimezone={browserTz}
                  tz={pickerTz}
                  onTzChange={setPickerTz}
                  weekOffset={weekOffset}
                  onWeekOffsetChange={setWeekOffset}
                  selectedDayKey={selectedDayKey}
                  onSelectedDayKeyChange={setSelectedDayKey}
                  duration={selectedDuration}
                />
              </>
            )}

            {step === "details" && selectedSlot && selectedTz && (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <MyButton
                    type="button"
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    onClick={() => setStep("pick")}
                    aria-label={t("bookingResponse.page.backToTimeAria")}
                  >
                    <ArrowLeft size={16} />
                  </MyButton>
                  <ModernCardTitle size="md" className="text-neutral-700">
                    {authed
                      ? t("bookingResponse.page.questionsTitle")
                      : t("bookingResponse.page.detailsTitle")}
                  </ModernCardTitle>
                </div>
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 p-3 text-body text-neutral-700">
                  <CalendarCheck
                    size={18}
                    className="shrink-0 text-primary-500"
                  />
                  <span className="font-semibold">
                    {formatSlotFull(selectedSlot, selectedTz)}
                  </span>
                </div>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                  >
                    {!authed && (
                      <>
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <MyInput
                                  inputType="text"
                                  label={t("bookingResponse.page.form.nameLabel")}
                                  required
                                  inputPlaceholder={t(
                                    "bookingResponse.page.form.namePlaceholder"
                                  )}
                                  input={field.value}
                                  onChangeFunction={field.onChange}
                                  error={form.formState.errors.name?.message}
                                  size="large"
                                  className="w-full"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <MyInput
                                  inputType="email"
                                  label={t("bookingResponse.page.form.emailLabel")}
                                  inputPlaceholder={t(
                                    "bookingResponse.page.form.emailPlaceholder"
                                  )}
                                  input={field.value}
                                  onChangeFunction={field.onChange}
                                  error={form.formState.errors.email?.message}
                                  size="large"
                                  className="w-full"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <MyInput
                                  inputType="tel"
                                  label={t("bookingResponse.page.form.phoneLabel")}
                                  inputPlaceholder={t(
                                    "bookingResponse.page.form.phonePlaceholder"
                                  )}
                                  input={field.value}
                                  onChangeFunction={field.onChange}
                                  error={form.formState.errors.phone?.message}
                                  size="large"
                                  className="w-full"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <p className="text-caption text-neutral-500">
                          {t("bookingResponse.page.form.identityHint")}
                        </p>
                      </>
                    )}
                    {authed && (
                      <p className="text-caption text-neutral-500">
                        {t("bookingResponse.page.form.authedHint")}
                      </p>
                    )}
                    {formFields.length > 0 && (
                      <BookingCustomFields
                        formFields={formFields}
                        control={form.control}
                      />
                    )}
                    <MyButton
                      type="submit"
                      buttonType="primary"
                      scale="large"
                      layoutVariant="default"
                      disable={submitting}
                      className="w-full"
                    >
                      {submitting
                        ? t("bookingResponse.page.submit.booking")
                        : pageData.require_approval
                          ? t("bookingResponse.page.submit.requestBooking")
                          : t("bookingResponse.page.submit.confirmBooking")}
                    </MyButton>
                  </form>
                </Form>
              </>
            )}

            {step === "confirmed" && booking && (
              <BookingConfirmation booking={booking} instituteId={instituteId} />
            )}
          </ModernCard>
        </div>
      </div>
    </div>
  );
};

export default BookingPage;
