import React, { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BASE_URL } from "@/constants/urls";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useStudyLibraryQuery } from "@/services/study-library/getStudyLibraryDetails";
import {
  useSubmitApplication,
  useSearchApplicant,
} from "@/hooks/use-parent-portal";
import { ChildProfile } from "@/types/parent-portal";
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
import { handleFetchCompleteInstituteDetails } from "@/routes/study-library/courses/-services/institute-details";

type SessionOption = {
  id: string;
  packageName: string;
  levelName: string;
};

type ParentType = "FATHER" | "MOTHER" | null;

type ApplicationFormData = {
  // Parent Section
  father_name: string;
  father_phone: string;
  father_email: string;
  mother_name: string;
  mother_phone: string;
  mother_email: string;

  // Student Section
  child_name: string;
  child_dob: string | null;
  child_gender: string;
  blood_group?: string;
  mother_tongue?: string;
  languages_known?: string;
  category?: string;
  nationality?: string;

  // Academic Section
  previous_school_name?: string;
  previous_school_board?: string;
  last_class_attended?: string;
  last_exam_result?: string;
  subjects_studied?: string;
  applying_for_class?: string;
  academic_year?: string;
  board_preference?: string;

  // Address Section
  address_line: string;
  city: string;
  pin_code: string;

  // Identity Documents
  id_number?: string;
  id_type?: string;

  // Transfer Certificate
  tc_number?: string;
  tc_issue_date?: string;
  tc_pending?: boolean;

  // Medical & Special Needs
  has_special_education_needs?: boolean;
  is_physically_challenged?: boolean;
  medical_conditions?: string;
  dietary_restrictions?: string;
};

// Track which parent type to prefill
export function ParentApplicationForm({
  onComplete,
  destinationPackageSessionId,
  child,
}: {
  onComplete?: () => void;
  /** When provided the form auto-selects this session and the user cannot change it. */
  destinationPackageSessionId: string;
  /** Child profile to prefill student details */
  child: ChildProfile;
}) {
  const { t } = useTranslation("parent");
  const [trackingId, setTrackingId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [enquiryResult, setEnquiryResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [session, setSession] = useState<string>("");
  const [showParentTypePrompt, setShowParentTypePrompt] = useState(false);
  const { data: instituteData } = useSuspenseQuery(
    handleFetchCompleteInstituteDetails(),
  );

  const packageSessionLabel = useMemo(() => {
    if (!instituteData?.batches_for_sessions) return "";
    const batch = instituteData.batches_for_sessions.find(
      (b: any) => b.id === destinationPackageSessionId,
    );
    if (batch) {
      const pkgName = batch.package_dto?.package_name || "";
      const levelName = batch.level?.level_name || "";
      return levelName ? `${pkgName} - ${levelName}` : pkgName;
    }
    return t("admissionPortal.applicationForm.selectedSession");
  }, [instituteData, destinationPackageSessionId, t]);

  const sessionLabel = useMemo(() => {
    if (!instituteData?.batches_for_sessions) return "";
    const batch = instituteData.batches_for_sessions.find(
      (b: any) => b.id === destinationPackageSessionId,
    );
    if (batch) {
      setSession(batch.session.id);
      const pkgName = batch.session?.session_name || "";
      return pkgName;
    }
    return t("admissionPortal.applicationForm.selectedSession");
  }, [instituteData, destinationPackageSessionId, t]);

  const [parentTypeToPrefill, setParentTypeToPrefill] =
    useState<ParentType>(null);
  const searchQuery = useSearchApplicant(
    instituteData?.id || undefined,
    trackingId || undefined,
    searching,
  );

  const [form, setForm] = useState<ApplicationFormData>({
    // Parent
    father_name: "",
    father_phone: "",
    father_email: "",
    mother_name: "",
    mother_phone: "",
    mother_email: "",
    // Student
    child_name: child?.full_name || "",
    child_dob: child?.date_of_birth || null,
    child_gender: child?.gender || "MALE",
    blood_group: "",
    mother_tongue: "",
    languages_known: "",
    category: "",
    nationality: "",
    // Academic
    previous_school_name: "",
    previous_school_board: "",
    last_class_attended: "",
    last_exam_result: "",
    subjects_studied: "",
    applying_for_class: destinationPackageSessionId ?? "",
    academic_year: "",
    board_preference: "",
    // Address
    address_line: "",
    city: "",
    pin_code: "",
    // Identity
    id_number: "",
    id_type: "",
    // TC
    tc_number: "",
    tc_issue_date: "",
    tc_pending: false,
    // Medical
    has_special_education_needs: false,
    is_physically_challenged: false,
    medical_conditions: "",
    dietary_restrictions: "",
  });

  // Whenever destinationPackageSessionId arrives (or changes), lock the session
  useEffect(() => {
    if (destinationPackageSessionId) {
      setForm((f) => ({
        ...f,
        applying_for_class: destinationPackageSessionId,
      }));
    }
  }, [destinationPackageSessionId]);

  // Only set enquiry result when manually triggered
  useEffect(() => {
    if (searching && searchQuery.data) {
      setEnquiryResult(searchQuery.data);
      setShowParentTypePrompt(true);
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery.data]);

  // Prefill logic after parent type is selected
  useEffect(() => {
    if (!parentTypeToPrefill || !enquiryResult) return;
    const app = enquiryResult;
    const parent = app.parent || {};
    const child = app.child || {};
    let mapped: Partial<ApplicationFormData> = {
      address_line: parent.address_line || form.address_line,
      city: parent.city || form.city,
      pin_code: parent.pin_code || form.pin_code,
      child_name: child.name || form.child_name,
      child_dob: child.dob ? child.dob.split("T")[0] : form.child_dob,
      child_gender: child.gender || form.child_gender,
    };
    if (parentTypeToPrefill === "FATHER") {
      mapped = {
        ...mapped,
        father_name: parent.name || form.father_name,
        father_phone: parent.phone || form.father_phone,
        father_email: parent.email || form.father_email,
      };
    } else if (parentTypeToPrefill === "MOTHER") {
      mapped = {
        ...mapped,
        mother_name: parent.name || form.mother_name,
        mother_phone: parent.phone || form.mother_phone,
        mother_email: parent.email || form.mother_email,
      };
    }
    setForm((f) => ({ ...f, ...mapped }));
    setShowParentTypePrompt(false);
    setParentTypeToPrefill(null);
    toast.success(t("admissionPortal.applicationForm.enquiryLoaded"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentTypeToPrefill]);

  const submitMutation = useSubmitApplication();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instituteData?.id) {
      toast.error(t("admissionPortal.applicationForm.instituteNotFound"));
      return;
    }

    const payload = {
      enquiry_id: trackingId || null,
      institute_id: instituteData?.id,
      session_id: session,
      source: "INSTITUTE",
      source_id: instituteData?.id,
      form_data: form,
      workflow_type: "APPLICATION",
      custom_field_values: {},
    };

    try {
      setSubmitting(true);
      const res = await submitMutation.mutateAsync(
        payload as unknown as Record<string, unknown>,
      );
      if (res) {
        // Try to create a payment order using available payment options
        try {
          // Fetch payment options for institute
          const paymentOptionsResp = await fetch(
            `${BASE_URL}/admin-core-service/payment/v1/get-payment-options`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("parent_token")}`,
              },
              body: JSON.stringify({
                types: ["ONE_TIME"],
                source: "INSTITUTE",
                source_id: instituteData?.id,
              }),
            },
          );

          if (paymentOptionsResp.ok) {
            const opts = await paymentOptionsResp.json();
            const option =
              Array.isArray(opts) && opts.length > 0 ? opts[0] : null;
            const plan = option?.payment_plans?.[0];

            if (option && plan) {
              const orderResp = await fetch(
                `${BASE_URL}/admin-core-service/payment/v1/create-order`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("parent_token")}`,
                  },
                  body: JSON.stringify({
                    applicant_id: res.applicant_id || res.applicantId || null,
                    payment_option_id: option.id,
                    payment_plan_id: plan.id,
                    institute_id: instituteData?.id,
                    amount: plan.actual_price || plan.amount,
                    currency: plan.currency || "INR",
                  }),
                },
              );

              if (orderResp.ok) {
                const order = await orderResp.json();
                const link =
                  order.payment_link || order.paymentLink || order.order_url;
                if (link) {
                  window.location.href = link;
                  return;
                }
              }
            }
          }
        } catch {
          // ignore and continue
        }

        toast.success(t("admissionPortal.applicationForm.submitSuccess"));
        if (onComplete) onComplete();
      }
    } catch {
      // handled by hook
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h2 className="text-lg font-semibold">
        {t("admissionPortal.applicationForm.heading")}
      </h2>
      <h4>
        {t("admissionPortal.applicationForm.sessionLabel", {
          session: sessionLabel,
        })}
      </h4>
      <div className="flex items-center gap-2">
        <Input
          placeholder={t("admissionPortal.applicationForm.trackingIdPlaceholder")}
          value={trackingId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setTrackingId(e.target.value)
          }
        />
        <Button
          onClick={() => {
            if (!trackingId)
              return toast.error(
                t("admissionPortal.applicationForm.enterTrackingId"),
              );
            if (!instituteData?.id)
              return toast.error(
                t("admissionPortal.applicationForm.instituteNotFound"),
              );
            setSearching(true);
          }}
          className="bg-blue-500"
          disabled={searching}
        >
          {searching
            ? t("admissionPortal.applicationForm.loading")
            : t("admissionPortal.applicationForm.loadEnquiry")}
        </Button>
      </div>

      {/* Prompt for parent type selection if needed */}
      {showParentTypePrompt && (
        <div className="mb-4 p-4 border rounded bg-gray-50 flex flex-col items-start gap-2">
          <span>
            {t("admissionPortal.applicationForm.parentTypePrompt")}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setParentTypeToPrefill("FATHER")}
            >
              {t("admissionPortal.applicationForm.father")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setParentTypeToPrefill("MOTHER")}
            >
              {t("admissionPortal.applicationForm.mother")}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Student Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.student")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.studentName")}
              </label>
              <Input
                value={form.child_name}
                onChange={(e) =>
                  setForm({ ...form, child_name: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.dateOfBirth")}
              </label>
              <Input
                type="date"
                value={form.child_dob ?? ""}
                onChange={(e) =>
                  setForm({ ...form, child_dob: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.gender")}
              </label>
              <Select
                value={form.child_gender}
                onValueChange={(value) =>
                  setForm({ ...form, child_gender: value })
                }
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
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.bloodGroup")}
              </label>
              <Input
                value={form.blood_group}
                onChange={(e) =>
                  setForm({ ...form, blood_group: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.motherTongue")}
              </label>
              <Input
                value={form.mother_tongue}
                onChange={(e) =>
                  setForm({ ...form, mother_tongue: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.languagesKnown")}
              </label>
              <Input
                value={form.languages_known}
                onChange={(e) =>
                  setForm({ ...form, languages_known: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.category")}
              </label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.nationality")}
              </label>
              <Input
                value={form.nationality}
                onChange={(e) =>
                  setForm({ ...form, nationality: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        {/* Parent Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.parent")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.fatherName")}
              </label>
              <Input
                value={form.father_name}
                onChange={(e) =>
                  setForm({ ...form, father_name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.fatherPhone")}
              </label>
              <Input
                value={form.father_phone}
                onChange={(e) =>
                  setForm({ ...form, father_phone: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.fatherEmail")}
              </label>
              <Input
                value={form.father_email}
                onChange={(e) =>
                  setForm({ ...form, father_email: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.motherName")}
              </label>
              <Input
                value={form.mother_name}
                onChange={(e) =>
                  setForm({ ...form, mother_name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.motherPhone")}
              </label>
              <Input
                value={form.mother_phone}
                onChange={(e) =>
                  setForm({ ...form, mother_phone: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.motherEmail")}
              </label>
              <Input
                value={form.mother_email}
                onChange={(e) =>
                  setForm({ ...form, mother_email: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        {/* Academic Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.academic")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t(
                  "admissionPortal.applicationForm.fields.previousSchoolName",
                )}
              </label>
              <Input
                value={form.previous_school_name}
                onChange={(e) =>
                  setForm({ ...form, previous_school_name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t(
                  "admissionPortal.applicationForm.fields.previousSchoolBoard",
                )}
              </label>
              <Input
                value={form.previous_school_board}
                onChange={(e) =>
                  setForm({ ...form, previous_school_board: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t(
                  "admissionPortal.applicationForm.fields.lastClassAttended",
                )}
              </label>
              <Input
                value={form.last_class_attended}
                onChange={(e) =>
                  setForm({ ...form, last_class_attended: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.lastExamResult")}
              </label>
              <Input
                value={form.last_exam_result}
                onChange={(e) =>
                  setForm({ ...form, last_exam_result: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.subjectsStudied")}
              </label>
              <Input
                value={form.subjects_studied}
                onChange={(e) =>
                  setForm({ ...form, subjects_studied: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs flex items-center gap-1">
                {t("admissionPortal.applicationForm.fields.applyingForClass")}
              </label>
              <div className="flex items-center gap-2 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm font-medium">
                <span className="flex-1 truncate">{packageSessionLabel}</span>
              </div>
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.academicYear")}
              </label>
              <Input
                value={form.academic_year}
                onChange={(e) =>
                  setForm({ ...form, academic_year: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.boardPreference")}
              </label>
              <Input
                value={form.board_preference}
                onChange={(e) =>
                  setForm({ ...form, board_preference: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        {/* Address Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.address")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.addressLine")}
              </label>
              <Input
                value={form.address_line}
                onChange={(e) =>
                  setForm({ ...form, address_line: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.city")}
              </label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.pinCode")}
              </label>
              <Input
                value={form.pin_code}
                onChange={(e) => setForm({ ...form, pin_code: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Identity Documents Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.identityDocuments")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.idNumber")}
              </label>
              <Input
                value={form.id_number}
                onChange={(e) =>
                  setForm({ ...form, id_number: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.idType")}
              </label>
              <Input
                value={form.id_type}
                onChange={(e) => setForm({ ...form, id_type: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Transfer Certificate Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t(
              "admissionPortal.applicationForm.sections.transferCertificate",
            )}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.tcNumber")}
              </label>
              <Input
                value={form.tc_number}
                onChange={(e) =>
                  setForm({ ...form, tc_number: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.tcIssueDate")}
              </label>
              <Input
                type="date"
                value={form.tc_issue_date || ""}
                onChange={(e) =>
                  setForm({ ...form, tc_issue_date: e.target.value })
                }
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox
                checked={form.tc_pending || false}
                onCheckedChange={(checked) =>
                  setForm({ ...form, tc_pending: !!checked })
                }
                id="tc_pending"
              />
              <label className="text-xs" htmlFor="tc_pending">
                {t("admissionPortal.applicationForm.fields.tcPending")}
              </label>
            </div>
          </div>
        </div>

        {/* Medical & Special Needs Section */}
        <div className="border rounded p-4 space-y-2">
          <h3 className="font-semibold">
            {t("admissionPortal.applicationForm.sections.medical")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-stack">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.has_special_education_needs || false}
                onCheckedChange={(checked) =>
                  setForm({ ...form, has_special_education_needs: !!checked })
                }
                id="special_needs"
              />
              <label className="text-xs" htmlFor="special_needs">
                {t(
                  "admissionPortal.applicationForm.fields.hasSpecialNeeds",
                )}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.is_physically_challenged || false}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_physically_challenged: !!checked })
                }
                id="physically_challenged"
              />
              <label className="text-xs" htmlFor="physically_challenged">
                {t(
                  "admissionPortal.applicationForm.fields.physicallyChallenged",
                )}
              </label>
            </div>
            <div>
              <label className="text-xs">
                {t("admissionPortal.applicationForm.fields.medicalConditions")}
              </label>
              <Input
                value={form.medical_conditions}
                onChange={(e) =>
                  setForm({ ...form, medical_conditions: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs">
                {t(
                  "admissionPortal.applicationForm.fields.dietaryRestrictions",
                )}
              </label>
              <Input
                value={form.dietary_restrictions}
                onChange={(e) =>
                  setForm({ ...form, dietary_restrictions: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting} className="bg-blue-700">
            {submitting
              ? t("admissionPortal.applicationForm.submitting")
              : t("admissionPortal.applicationForm.submit")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm({
                father_name: "",
                father_phone: "",
                father_email: "",
                mother_name: "",
                mother_phone: "",
                mother_email: "",
                child_name: child?.full_name || "",
                child_dob: child?.date_of_birth || null,
                child_gender: child?.gender || "MALE",
                blood_group: "",
                mother_tongue: "",
                languages_known: "",
                category: "",
                nationality: "",
                previous_school_name: "",
                previous_school_board: "",
                last_class_attended: "",
                last_exam_result: "",
                subjects_studied: "",
                applying_for_class: destinationPackageSessionId ?? "",
                academic_year: "",
                board_preference: "",
                address_line: "",
                city: "",
                pin_code: "",
                id_number: "",
                id_type: "",
                tc_number: "",
                tc_issue_date: "",
                tc_pending: false,
                has_special_education_needs: false,
                is_physically_challenged: false,
                medical_conditions: "",
                dietary_restrictions: "",
              });
            }}
          >
            {t("admissionPortal.applicationForm.reset")}
          </Button>
        </div>
      </form>
    </div>
  );
}
