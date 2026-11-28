import React, { useEffect, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  useSuspenseQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useParentPortalStore } from "@/stores/parent-portal-store";
import { ParentPageLayout } from "../-components/ParentPageLayout";
import { handleFetchCompleteInstituteDetails } from "@/routes/study-library/courses/-services/institute-details";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Lock } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { SEARCH_ENQUIRY, SUBMIT_ADMISSION } from "@/constants/urls";

export const Route = createFileRoute("/parent/admission/")({
  component: Page,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type AdmissionSource = "enquiry" | "application" | "direct" | null;
type ParentType = "FATHER" | "MOTHER" | null;

/** Mirrors the SUBMIT_ADMISSION payload exactly */
type AdmissionPayload = {
  institute_id: string;
  source: string;
  source_id: string;
  session_id: string;
  destination_package_session_id: string;
  // Student
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  mobile_number: string;
  student_aadhaar: string;
  blood_group: string;
  mother_tongue: string;
  nationality: string;
  religion: string;
  caste: string;
  how_did_you_know: string;
  // Admission details
  class_applying_for: string;
  section: string;
  admission_no: string;
  date_of_admission: string;
  has_transport: boolean;
  student_type: string;
  class_group: string;
  admission_type: string;
  // Previous school
  previous_school_name: string;
  previous_class: string;
  previous_board: string;
  year_of_passing: string;
  previous_percentage: string;
  previous_admission_no: string;
  // Father
  father_name: string;
  father_mobile: string;
  father_email: string;
  father_aadhaar: string;
  father_qualification: string;
  father_occupation: string;
  // Mother
  mother_name: string;
  mother_mobile: string;
  mother_email: string;
  mother_aadhaar: string;
  mother_qualification: string;
  mother_occupation: string;
  // Guardian
  guardian_name: string;
  guardian_mobile: string;
  // Address
  current_address: string;
  current_locality: string;
  current_pin_code: string;
  permanent_address: string;
  permanent_locality: string;
  // Custom fields
  custom_field_values: Record<string, string>;
};

function makeEmptyPayload(
  instituteId = "",
  sessionId = "",
  destinationPackageSessionId = "",
  firstName = "",
  gender = "MALE",
  dob = "",
): AdmissionPayload {
  return {
    institute_id: instituteId,
    source: "INSTITUTE",
    source_id: instituteId,
    session_id: sessionId,
    destination_package_session_id: destinationPackageSessionId,
    first_name: firstName,
    last_name: "",
    gender,
    date_of_birth: dob,
    mobile_number: "",
    student_aadhaar: "",
    blood_group: "",
    mother_tongue: "",
    nationality: "",
    religion: "",
    caste: "",
    how_did_you_know: "",
    class_applying_for: "",
    section: "",
    admission_no: "",
    date_of_admission: "",
    has_transport: false,
    student_type: "",
    class_group: "",
    admission_type: "",
    previous_school_name: "",
    previous_class: "",
    previous_board: "",
    year_of_passing: "",
    previous_percentage: "",
    previous_admission_no: "",
    father_name: "",
    father_mobile: "",
    father_email: "",
    father_aadhaar: "",
    father_qualification: "",
    father_occupation: "",
    mother_name: "",
    mother_mobile: "",
    mother_email: "",
    mother_aadhaar: "",
    mother_qualification: "",
    mother_occupation: "",
    guardian_name: "",
    guardian_mobile: "",
    current_address: "",
    current_locality: "",
    current_pin_code: "",
    permanent_address: "",
    permanent_locality: "",
    custom_field_values: {},
  };
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold text-sm">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">{children}</div>
    </div>
  );
}

// ─── Main Form Component ──────────────────────────────────────────────────────

function AdmissionFormInner() {
  const { t } = useTranslation("parent");
  const selectedChild = useParentPortalStore((s) => s.selectedChild);
  const { data: instituteData } = useSuspenseQuery(
    handleFetchCompleteInstituteDetails(),
  );

  const destinationPackageSessionId =
    selectedChild?.destinationPackageSessionId ?? "";

  // Labels derived from institute batch data
  const packageSessionLabel = useMemo(() => {
    if (!instituteData?.batches_for_sessions) return "";
    const batch = instituteData.batches_for_sessions.find(
      (b: any) => b.id === destinationPackageSessionId,
    );
    if (!batch)
      return destinationPackageSessionId
        ? t("admissionPortal.applicationForm.selectedSession")
        : "";
    const pkgName = batch.package_dto?.package_name || "";
    const levelName = batch.level?.level_name || "";
    return levelName ? `${pkgName} - ${levelName}` : pkgName;
  }, [instituteData, destinationPackageSessionId, t]);

  const sessionId = useMemo(() => {
    if (!instituteData?.batches_for_sessions) return "";
    const batch = instituteData.batches_for_sessions.find(
      (b: any) => b.id === destinationPackageSessionId,
    );
    return batch?.session?.id ?? "";
  }, [instituteData, destinationPackageSessionId]);

  // Source selection
  const [source, setSource] = useState<AdmissionSource>("direct");

  // Lookup IDs
  const [enquiryTrackingId, setEnquiryTrackingId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingApp, setLoadingApp] = useState(false);

  // Parent-type prompt for enquiry prefill
  const [showParentTypePrompt, setShowParentTypePrompt] = useState(false);
  const [parentTypeToPrefill, setParentTypeToPrefill] =
    useState<ParentType>(null);
  const [rawEnquiryResult, setRawEnquiryResult] = useState<any>(null);

  // Build initial form from child profile + institute
  const initialPayload = useMemo(
    () =>
      makeEmptyPayload(
        instituteData?.id ?? "",
        sessionId,
        destinationPackageSessionId,
        selectedChild?.full_name ?? "",
        selectedChild?.gender ?? "MALE",
        selectedChild?.date_of_birth ?? "",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instituteData?.id, sessionId, destinationPackageSessionId],
  );

  const [form, setForm] = useState<AdmissionPayload>(initialPayload);

  // Sync session/institute once data loads
  useEffect(() => {
    setForm((f) => ({
      ...f,
      institute_id: instituteData?.id ?? f.institute_id,
      source_id: instituteData?.id ?? f.source_id,
      session_id: sessionId || f.session_id,
      destination_package_session_id:
        destinationPackageSessionId || f.destination_package_session_id,
    }));
  }, [instituteData?.id, sessionId, destinationPackageSessionId]);

  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  // Enquiry search
  const enquiryQuery = useQuery({
    queryKey: ["parent-portal", "search-enquiry", enquiryTrackingId],
    queryFn: async () => {
      const resp = await authenticatedAxiosInstance.get(SEARCH_ENQUIRY, {
        params: { enquiryTrackingId },
      });
      return resp.data;
    },
    enabled: !!enquiryTrackingId && searching,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (searching && enquiryQuery.data) {
      setRawEnquiryResult(enquiryQuery.data);
      setShowParentTypePrompt(true);
      setSearching(false);
    }
  }, [enquiryQuery.data, searching]);

  // Apply enquiry prefill after parent type chosen
  useEffect(() => {
    if (!parentTypeToPrefill || !rawEnquiryResult) return;
    const parent = rawEnquiryResult.parent || {};
    const child = rawEnquiryResult.child || {};

    const childFirstName = (child.name || "").split(" ")[0] || "";
    const childLastName =
      (child.name || "").split(" ").slice(1).join(" ") || "";

    setForm((f) => ({
      ...f,
      first_name: childFirstName || f.first_name,
      last_name: childLastName || f.last_name,
      date_of_birth: child.dob ? child.dob.split("T")[0] : f.date_of_birth,
      gender: child.gender || f.gender,
      current_address: parent.address_line || f.current_address,
      current_locality: parent.city || f.current_locality,
      current_pin_code: parent.pin_code || f.current_pin_code,
      ...(parentTypeToPrefill === "FATHER"
        ? {
            father_name: parent.name || f.father_name,
            father_mobile: parent.phone || f.father_mobile,
            father_email: parent.email || f.father_email,
          }
        : {
            mother_name: parent.name || f.mother_name,
            mother_mobile: parent.phone || f.mother_mobile,
            mother_email: parent.email || f.mother_email,
          }),
    }));

    setShowParentTypePrompt(false);
    setParentTypeToPrefill(null);
    toast.success(t("admissionPortal.applicationForm.enquiryLoaded"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentTypeToPrefill]);

  // Load from application ID
  const handleLoadFromApplication = async () => {
    if (!applicationId)
      return toast.error(t("admissionPortal.admissionForm.enterApplicationId"));
    setLoadingApp(true);
    try {
      const resp = await authenticatedAxiosInstance.get(
        `/admin-core-service/v1/application/${applicationId}`,
      );
      const data = resp.data;
      const parent = data.parent || {};
      const child = data.child || {};
      setForm((f) => ({
        ...f,
        first_name: (child.name || f.first_name).split(" ")[0] || f.first_name,
        last_name:
          (child.name || "").split(" ").slice(1).join(" ") || f.last_name,
        date_of_birth: child.dob ? child.dob.split("T")[0] : f.date_of_birth,
        gender: child.gender || f.gender,
        father_name: parent.father_name || f.father_name,
        father_mobile: parent.father_mobile || f.father_mobile,
        father_email: parent.father_email || f.father_email,
        mother_name: parent.mother_name || f.mother_name,
        mother_mobile: parent.mother_mobile || f.mother_mobile,
        mother_email: parent.mother_email || f.mother_email,
        current_address: parent.address_line || f.current_address,
        current_locality: parent.city || f.current_locality,
        current_pin_code: parent.pin_code || f.current_pin_code,
      }));
      toast.success(t("admissionPortal.admissionForm.applicationLoaded"));
    } catch {
      toast.error(t("admissionPortal.admissionForm.applicationLoadFailed"));
    } finally {
      setLoadingApp(false);
    }
  };

  const handleReset = () => {
    setForm(initialPayload);
    setEnquiryTrackingId("");
    setApplicationId("");
    setShowParentTypePrompt(false);
    setRawEnquiryResult(null);
  };

  const submitMutation = useMutation({
    mutationFn: async (payload: AdmissionPayload) => {
      const resp = await authenticatedAxiosInstance.post(
        SUBMIT_ADMISSION,
        payload,
      );
      return resp.data;
    },
    onSuccess: () => {
      toast.success(t("admissionPortal.admissionForm.submitSuccess"));
      queryClient.invalidateQueries({ queryKey: ["parent-portal"] });
    },
    onError: () => {
      toast.error(t("admissionPortal.admissionForm.submitFailed"));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.institute_id)
      return toast.error(t("admissionPortal.applicationForm.instituteNotFound"));
    try {
      setSubmitting(true);
      await submitMutation.mutateAsync(form);
    } finally {
      setSubmitting(false);
    }
  };

  const set =
    (key: keyof AdmissionPayload) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">
          {t("admissionPortal.admissionForm.heading")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("admissionPortal.admissionForm.submitForPrefix")}{" "}
          <span className="font-medium text-foreground">
            {selectedChild?.full_name ??
              t("admissionPortal.admissionForm.theStudent")}
          </span>
          .
        </p>
      </div>

      {/* Source Selector – compact dropdown */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium whitespace-nowrap">
          {t("admissionPortal.admissionForm.applyingFrom")}
        </label>
        <Select
          value={source ?? ""}
          onValueChange={(v) => {
            setSource(v as AdmissionSource);
            setEnquiryTrackingId("");
            setApplicationId("");
            setShowParentTypePrompt(false);
            setRawEnquiryResult(null);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue
              placeholder={t("admissionPortal.admissionForm.selectSource")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enquiry">
              {t("admissionPortal.admissionForm.enquiryTrackingId")}
            </SelectItem>
            <SelectItem value="application">
              {t("admissionPortal.admissionForm.applicationIdOption")}
            </SelectItem>
            <SelectItem value="direct">
              {t("admissionPortal.admissionForm.directManualEntry")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lookup panel – Enquiry */}
      {source === "enquiry" && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">
            {t("admissionPortal.admissionForm.enterEnquiryTrackingId")}
          </p>
          <div className="flex gap-2">
            <Input
              placeholder={t(
                "admissionPortal.admissionForm.enquiryTrackingIdPlaceholder",
              )}
              value={enquiryTrackingId}
              onChange={(e) => setEnquiryTrackingId(e.target.value)}
            />
            <Button
              type="button"
              disabled={enquiryQuery.isFetching}
              onClick={() => {
                if (!enquiryTrackingId)
                  return toast.error(
                    t("admissionPortal.admissionForm.enterTrackingId"),
                  );
                setSearching(true);
              }}
            >
              {enquiryQuery.isFetching
                ? t("admissionPortal.applicationForm.loading")
                : t("admissionPortal.admissionForm.load")}
            </Button>
          </div>
          {showParentTypePrompt && (
            <div className="border rounded-lg p-4 bg-background space-y-3">
              <p className="text-sm font-medium">
                {t("admissionPortal.applicationForm.parentTypePrompt")}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setParentTypeToPrefill("FATHER")}
                >
                  {t("admissionPortal.applicationForm.father")}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setParentTypeToPrefill("MOTHER")}
                >
                  {t("admissionPortal.applicationForm.mother")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lookup panel – Application */}
      {source === "application" && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">
            {t("admissionPortal.admissionForm.enterApplicationId")}
          </p>
          <div className="flex gap-2">
            <Input
              placeholder={t(
                "admissionPortal.admissionForm.applicationIdPlaceholder",
              )}
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
            />
            <Button
              type="button"
              disabled={loadingApp}
              onClick={handleLoadFromApplication}
            >
              {loadingApp
                ? t("admissionPortal.applicationForm.loading")
                : t("admissionPortal.admissionForm.load")}
            </Button>
          </div>
        </div>
      )}

      {/* Full Form – visible once source is chosen */}
      {source && (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Locked: Applying For Class */}
          <div className="border rounded-lg p-4 bg-primary/5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              {t("admissionPortal.admissionForm.fields.applyingForClass")}
            </p>
            <div className="flex items-center gap-2 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm font-medium">
              <span className="flex-1 truncate">
                {packageSessionLabel ||
                  t("admissionPortal.admissionForm.notAssigned")}
              </span>
            </div>
          </div>

          {/* Student Information */}
          <Section title={t("admissionPortal.admissionForm.sections.student")}>
            <Field label={t("admissionPortal.admissionForm.fields.firstName")}>
              <Input
                value={form.first_name}
                onChange={set("first_name")}
                required
              />
            </Field>
            <Field label={t("admissionPortal.admissionForm.fields.lastName")}>
              <Input value={form.last_name} onChange={set("last_name")} />
            </Field>
            <Field label={t("admissionPortal.admissionForm.fields.gender")}>
              <Select
                value={form.gender}
                onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t(
                      "admissionPortal.applicationForm.fields.selectGender",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">
                    {t("admissionPortal.applicationForm.genderOptions.male")}
                  </SelectItem>
                  <SelectItem value="FEMALE">
                    {t("admissionPortal.applicationForm.genderOptions.female")}
                  </SelectItem>
                  <SelectItem value="OTHER">
                    {t("admissionPortal.applicationForm.genderOptions.other")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.dateOfBirth")}
            >
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={set("date_of_birth")}
                required
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.mobileNumber")}
            >
              <Input
                value={form.mobile_number}
                onChange={set("mobile_number")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.studentAadhaar")}
            >
              <Input
                value={form.student_aadhaar}
                onChange={set("student_aadhaar")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.bloodGroup")}
            >
              <Input value={form.blood_group} onChange={set("blood_group")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.motherTongue")}
            >
              <Input
                value={form.mother_tongue}
                onChange={set("mother_tongue")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.nationality")}
            >
              <Input value={form.nationality} onChange={set("nationality")} />
            </Field>
            <Field label={t("admissionPortal.admissionForm.fields.religion")}>
              <Input value={form.religion} onChange={set("religion")} />
            </Field>
            <Field label={t("admissionPortal.admissionForm.fields.caste")}>
              <Input value={form.caste} onChange={set("caste")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.howDidYouKnow")}
            >
              <Input
                value={form.how_did_you_know}
                onChange={set("how_did_you_know")}
              />
            </Field>
          </Section>

          {/* Admission Details */}
          <Section
            title={t("admissionPortal.admissionForm.sections.admission")}
          >
            <Field label={t("admissionPortal.admissionForm.fields.section")}>
              <Input value={form.section} onChange={set("section")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.admissionNo")}
            >
              <Input value={form.admission_no} onChange={set("admission_no")} />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.dateOfAdmission",
              )}
            >
              <Input
                type="date"
                value={form.date_of_admission}
                onChange={set("date_of_admission")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.studentType")}
            >
              <Input value={form.student_type} onChange={set("student_type")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.classGroup")}
            >
              <Input value={form.class_group} onChange={set("class_group")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.admissionType")}
            >
              <Input
                value={form.admission_type}
                onChange={set("admission_type")}
              />
            </Field>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox
                id="has_transport"
                checked={form.has_transport}
                onCheckedChange={(c) =>
                  setForm((f) => ({ ...f, has_transport: !!c }))
                }
              />
              <label
                htmlFor="has_transport"
                className="text-xs text-muted-foreground"
              >
                {t("admissionPortal.admissionForm.fields.hasTransport")}
              </label>
            </div>
          </Section>

          {/* Previous School */}
          <Section
            title={t("admissionPortal.admissionForm.sections.previousSchool")}
          >
            <Field
              label={t("admissionPortal.admissionForm.fields.schoolName")}
            >
              <Input
                value={form.previous_school_name}
                onChange={set("previous_school_name")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.previousClass",
              )}
            >
              <Input
                value={form.previous_class}
                onChange={set("previous_class")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.previousBoard",
              )}
            >
              <Input
                value={form.previous_board}
                onChange={set("previous_board")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.yearOfPassing",
              )}
            >
              <Input
                value={form.year_of_passing}
                onChange={set("year_of_passing")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.percentage")}
            >
              <Input
                value={form.previous_percentage}
                onChange={set("previous_percentage")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.previousAdmissionNo",
              )}
            >
              <Input
                value={form.previous_admission_no}
                onChange={set("previous_admission_no")}
              />
            </Field>
          </Section>

          {/* Father Information */}
          <Section
            title={t("admissionPortal.admissionForm.sections.father")}
          >
            <Field
              label={t("admissionPortal.applicationForm.fields.fatherName")}
            >
              <Input value={form.father_name} onChange={set("father_name")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.fatherMobile")}
            >
              <Input
                value={form.father_mobile}
                onChange={set("father_mobile")}
              />
            </Field>
            <Field
              label={t("admissionPortal.applicationForm.fields.fatherEmail")}
            >
              <Input
                type="email"
                value={form.father_email}
                onChange={set("father_email")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.fatherAadhaar")}
            >
              <Input
                value={form.father_aadhaar}
                onChange={set("father_aadhaar")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.fatherQualification",
              )}
            >
              <Input
                value={form.father_qualification}
                onChange={set("father_qualification")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.fatherOccupation",
              )}
            >
              <Input
                value={form.father_occupation}
                onChange={set("father_occupation")}
              />
            </Field>
          </Section>

          {/* Mother Information */}
          <Section
            title={t("admissionPortal.admissionForm.sections.mother")}
          >
            <Field
              label={t("admissionPortal.applicationForm.fields.motherName")}
            >
              <Input value={form.mother_name} onChange={set("mother_name")} />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.motherMobile")}
            >
              <Input
                value={form.mother_mobile}
                onChange={set("mother_mobile")}
              />
            </Field>
            <Field
              label={t("admissionPortal.applicationForm.fields.motherEmail")}
            >
              <Input
                type="email"
                value={form.mother_email}
                onChange={set("mother_email")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.motherAadhaar")}
            >
              <Input
                value={form.mother_aadhaar}
                onChange={set("mother_aadhaar")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.motherQualification",
              )}
            >
              <Input
                value={form.mother_qualification}
                onChange={set("mother_qualification")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.motherOccupation",
              )}
            >
              <Input
                value={form.mother_occupation}
                onChange={set("mother_occupation")}
              />
            </Field>
          </Section>

          {/* Guardian */}
          <Section
            title={t("admissionPortal.admissionForm.sections.guardian")}
          >
            <Field
              label={t("admissionPortal.admissionForm.fields.guardianName")}
            >
              <Input
                value={form.guardian_name}
                onChange={set("guardian_name")}
              />
            </Field>
            <Field
              label={t("admissionPortal.admissionForm.fields.guardianMobile")}
            >
              <Input
                value={form.guardian_mobile}
                onChange={set("guardian_mobile")}
              />
            </Field>
          </Section>

          {/* Address */}
          <Section title={t("admissionPortal.admissionForm.sections.address")}>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.currentAddress",
              )}
            >
              <Input
                value={form.current_address}
                onChange={set("current_address")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.currentLocality",
              )}
            >
              <Input
                value={form.current_locality}
                onChange={set("current_locality")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.currentPinCode",
              )}
            >
              <Input
                value={form.current_pin_code}
                onChange={set("current_pin_code")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.permanentAddress",
              )}
            >
              <Input
                value={form.permanent_address}
                onChange={set("permanent_address")}
              />
            </Field>
            <Field
              label={t(
                "admissionPortal.admissionForm.fields.permanentLocality",
              )}
            >
              <Input
                value={form.permanent_locality}
                onChange={set("permanent_locality")}
              />
            </Field>
          </Section>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting
                ? t("admissionPortal.admissionForm.submitting")
                : t("admissionPortal.admissionForm.submitAdmission")}
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              {t("admissionPortal.applicationForm.reset")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <ParentPageLayout>
      <AdmissionFormInner />
    </ParentPageLayout>
  );
}
