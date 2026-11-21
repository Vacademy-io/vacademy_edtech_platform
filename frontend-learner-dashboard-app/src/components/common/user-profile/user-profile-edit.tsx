"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  X,
  User,
  EnvelopeSimple,
  MapPin,
  Buildings,
  Users,
  GraduationCap,
  GlobeSimple,
} from "@phosphor-icons/react";
import { PencilSimple } from "@phosphor-icons/react";

import { HOLISTIC_INSTITUTE_ID, STUDENT_DETAIL_EDIT } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { useNavigate } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import { MyButton } from "@/components/design-system/button";
import { SpinnerGap } from "@phosphor-icons/react";
import type { Student } from "@/types/user/user-detail";
import { FormProvider, useForm } from "react-hook-form";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSystemFieldVisibility } from "@/hooks/use-system-field-visibility";
import PhoneInputField from "@/components/design-system/phone-input-field";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { PaymentBillingSection } from "./payment-billing/payment-billing-section";

interface UpdateStudentRequest {
  user_id: string;
  email: string;
  full_name: string;
  contact_number: string;
  gender: string;
  address_line: string;
  city: string;
  state: string;
  pin_code: string;
  institute_name: string;
  father_name: string;
  mother_name: string;
  parents_mobile_number: string;
  parents_email: string;
  face_file_id: string;
  country: string;
}

export default function EditProfile() {
  const { t } = useTranslation("userProfileExtra");
  const [studentData, setStudentData] = useState<Student | null>(null);
  const [formData, setFormData] = useState<UpdateStudentRequest>({
    user_id: "",
    email: "",
    full_name: "",
    contact_number: "",
    gender: "",
    address_line: "",
    city: "",
    state: "",
    pin_code: "",
    institute_name: "",
    father_name: "",
    mother_name: "",
    parents_mobile_number: "",
    parents_email: "",
    face_file_id: "",
    country: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { uploadFile, getPublicUrl } = useFileUpload();
  const { showForInstitutes } = useInstituteFeatureStore();
  // Honor the admin's system-field toggles (Settings → Custom Fields). Fails open.
  const { isFieldVisible } = useSystemFieldVisibility();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const methods = useForm();
  const navigate = useNavigate();

  const getProfileImage = async (faceFileId: string) => {
    if (!faceFileId) return null;
    try {
      return await getPublicUrl(faceFileId);
    } catch (error) {
      console.error("Error getting profile image URL:", error);
      return null;
    }
  };

  const handleProfileImageChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId: formData.user_id,
        source: "PROFILE_PHOTOS",
        sourceId: "STUDENTS",
        publicUrl: true,
      });

      if (fileId) {
        const existingDetails = await Preferences.get({
          key: "StudentDetails",
        });

        if (existingDetails.value) {
          const detailsObj = JSON.parse(existingDetails.value);
          detailsObj.face_file_id = fileId;

          await Preferences.set({
            key: "StudentDetails",
            value: JSON.stringify(detailsObj),
          });
        }

        setFormData((prev) => ({
          ...prev,
          face_file_id: fileId,
        }));

        const url = await getPublicUrl(fileId);
        setProfileImageUrl(url);
      }
    } catch (error) {
      console.error("Error uploading profile image:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveProfileImage = async () => {
    try {
      setIsUploading(true);

      const existingDetails = await Preferences.get({ key: "StudentDetails" });
      if (existingDetails.value) {
        const detailsObj = JSON.parse(existingDetails.value);
        detailsObj.face_file_id = "";

        await Preferences.set({
          key: "StudentDetails",
          value: JSON.stringify(detailsObj),
        });
      }

      setFormData((prev) => ({
        ...prev,
        face_file_id: "",
      }));

      setProfileImageUrl(null);
    } catch (error) {
      console.error("Error removing profile image:", error);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    const fetchStudentData = async () => {
      try {
        setIsFetching(true);

        const { value } = await Preferences.get({ key: "StudentDetails" });
        if (!value) {
          setIsFetching(false);
          return;
        }

        const parsedData = JSON.parse(value);
        let studentDetails: Student;

        if (Array.isArray(parsedData)) {
          if (parsedData.length === 0) return;
          studentDetails = parsedData[0];
        } else {
          studentDetails = parsedData;
        }

        setStudentData(studentDetails);

        setFormData({
          user_id: studentDetails.user_id || "",
          email: studentDetails.email || "",
          full_name: studentDetails.full_name || "",
          contact_number: studentDetails.mobile_number || "",
          gender: studentDetails.gender || "",
          address_line: studentDetails.address_line || "",
          city: studentDetails.city || "",
          state: studentDetails.region || "",
          pin_code: studentDetails.pin_code || "",
          institute_name: studentDetails.linked_institute_name || "",
          father_name: studentDetails.father_name || "",
          mother_name: studentDetails.mother_name || "",
          parents_mobile_number: studentDetails.parents_mobile_number || "",
          parents_email: studentDetails.parents_email || "",
          face_file_id: studentDetails.face_file_id || "",
          country: studentDetails.country || "",
        });

        if (studentDetails.face_file_id) {
          const imageUrl = await getProfileImage(studentDetails.face_file_id);
          setProfileImageUrl(imageUrl);
        }
      } catch (error) {
        console.error("Error fetching student data:", error);
      } finally {
        setIsFetching(false);
      }
    };

    fetchStudentData();
  }, []);

  const handleChange = (field: keyof UpdateStudentRequest, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authenticatedAxiosInstance.put(STUDENT_DETAIL_EDIT, formData);

      if (studentData) {
        const updatedStudentData = {
          ...studentData,
          ...formData,
          mobile_number: formData.contact_number,
          region: formData.state,
          linked_institute_name: formData.institute_name,
        };

        const { value } = await Preferences.get({ key: "StudentDetails" });

        if (value) {
          const parsedData = JSON.parse(value);

          if (Array.isArray(parsedData)) {
            parsedData[0] = updatedStudentData;
            await Preferences.set({
              key: "StudentDetails",
              value: JSON.stringify(parsedData),
            });
          } else {
            await Preferences.set({
              key: "StudentDetails",
              value: JSON.stringify(updatedStudentData),
            });
          }
        }
      }

      navigate({ to: "/user-profile", replace: true });
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    navigate({ to: "/user-profile", replace: true });
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center h-screen">
        <DashboardLoader />
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <div className="min-h-screen bg-gray-50/50 p-4 md:p-8 pb-20 md:pb-8">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <PencilSimple className="w-5 h-5 text-primary-500" />
              {t("profileEdit.header")}
            </h1>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
            >
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8">
            {/* Profile Image Section */}
            <div className="flex flex-col items-center">
              <div className="relative group">
                <div className="h-28 w-28 rounded-full border-4 border-white shadow-md overflow-hidden bg-gray-100 flex items-center justify-center">
                  {profileImageUrl ? (
                    <img
                      src={profileImageUrl || "/placeholder.svg"}
                      alt={t("profileEdit.profileImageAlt")}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User size={48} className="text-gray-400" />
                  )}
                  {isUploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent"></div>
                    </div>
                  )}
                </div>

                <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="absolute bottom-1 end-1 p-2 rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600 transition-colors border-2 border-white">
                      <PencilSimple className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        document.getElementById("profile-upload")?.click();
                        setIsMenuOpen(false);
                      }}
                    >
                      {t("profileEdit.uploadNew")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        handleRemoveProfileImage();
                        setIsMenuOpen(false);
                      }}
                      className="text-red-600"
                    >
                      {t("profileEdit.removePhoto")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <input
                  type="file"
                  id="profile-upload"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    handleProfileImageChange(e);
                    setIsMenuOpen(false);
                  }}
                />
              </div>
              <p className="mt-3 text-sm text-gray-500">{t("profileEdit.allowedFileTypes")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column */}
              <div className="space-y-8">
                {/* General Details */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 border-b pb-2">
                    <User size={20} className="text-primary-500" weight="bold" />
                    <h3>{t("profileEdit.sections.generalDetails")}</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="full_name" className="text-xs uppercase font-medium text-gray-500">
                        {t("profileEdit.fields.fullName")}
                      </Label>
                      <Input
                        id="full_name"
                        value={formData.full_name}
                        onChange={(e) => handleChange("full_name", e.target.value)}
                        placeholder={t("profileEdit.fields.fullNamePlaceholder")}
                        required
                        className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                      />
                    </div>

                    {isFieldVisible("GENDER") && (
                      <div className="space-y-2">
                        <Label htmlFor="gender" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.gender")}
                        </Label>
                        <Select
                          value={formData.gender}
                          onValueChange={(value) => handleChange("gender", value)}
                        >
                          <SelectTrigger className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors">
                            <SelectValue placeholder={t("profileEdit.fields.genderPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Male">{t("profileEdit.fields.genderMale")}</SelectItem>
                            <SelectItem value="Female">{t("profileEdit.fields.genderFemale")}</SelectItem>
                            <SelectItem value="Other">{t("profileEdit.fields.genderOther")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {!showForInstitutes([HOLISTIC_INSTITUTE_ID]) &&
                      isFieldVisible("LINKED_INSTITUTE_NAME") && (
                      <div className="space-y-2">
                        <Label htmlFor="institute_name" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.instituteName")}
                        </Label>
                        <div className="relative">
                          <Input
                            id="institute_name"
                            value={formData.institute_name}
                            onChange={(e) => handleChange("institute_name", e.target.value)}
                            placeholder={t("profileEdit.fields.instituteNamePlaceholder")}
                            className="h-11 ps-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                          <GraduationCap
                            size={18}
                            className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contact Information */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 border-b pb-2">
                    <EnvelopeSimple size={20} className="text-secondary-500" weight="bold" />
                    <h3>{t("profileEdit.sections.contactInformation")}</h3>
                  </div>

                  <div className="space-y-4">
                    {isFieldVisible("MOBILE_NUMBER") && (
                      <div className="space-y-2">
                        <Label htmlFor="contact_number" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.mobileNumber")}
                        </Label>
                        <PhoneInputField
                          label=""
                          name="contact_number"
                          placeholder={t("profileEdit.fields.mobileNumberPlaceholder")}
                          control={methods.control}
                          value={formData.contact_number}
                          onChange={(value) => handleChange("contact_number", value)}
                        />
                      </div>
                    )}

                    {isFieldVisible("EMAIL") && (
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.email")}
                        </Label>
                        <div className="relative">
                          <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => handleChange("email", e.target.value)}
                            placeholder={t("profileEdit.fields.emailPlaceholder")}
                            required
                            className="h-11 ps-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                          <EnvelopeSimple
                            size={18}
                            className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-8">
                {/* Location Details */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 border-b pb-2">
                    <MapPin size={20} className="text-tertiary-500" weight="bold" />
                    <h3>{t("profileEdit.sections.locationDetails")}</h3>
                  </div>

                  {showForInstitutes([HOLISTIC_INSTITUTE_ID]) ? (
                    <div className="space-y-2">
                      <Label htmlFor="country" className="text-xs uppercase font-medium text-gray-500">
                        {t("profileEdit.fields.country")}
                      </Label>
                      <div className="relative">
                        <Input
                          id="country"
                          value={formData.country}
                          onChange={(e) => handleChange("country", e.target.value)}
                          placeholder={t("profileEdit.fields.countryPlaceholder")}
                          className="h-11 ps-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                        />
                        <GlobeSimple
                          size={18}
                          className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="address_line" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.addressLine")}
                        </Label>
                        <div className="relative">
                          <Input
                            id="address_line"
                            value={formData.address_line}
                            onChange={(e) => handleChange("address_line", e.target.value)}
                            placeholder={t("profileEdit.fields.addressLinePlaceholder")}
                            className="h-11 ps-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                          <Buildings
                            size={18}
                            className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {isFieldVisible("CITY") && (
                          <div className="space-y-2">
                            <Label htmlFor="city" className="text-xs uppercase font-medium text-gray-500">
                              {t("profileEdit.fields.city")}
                            </Label>
                            <Input
                              id="city"
                              value={formData?.city || ""}
                              onChange={(e) => handleChange("city", e.target.value)}
                              className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                            />
                          </div>
                        )}

                        {isFieldVisible("REGION") && (
                          <div className="space-y-2">
                            <Label htmlFor="state" className="text-xs uppercase font-medium text-gray-500">
                              {t("profileEdit.fields.state")}
                            </Label>
                            <Input
                              id="state"
                              value={formData.state}
                              onChange={(e) => handleChange("state", e.target.value)}
                              className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="pin_code" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.pincode")}
                        </Label>
                        <Input
                          id="pin_code"
                          value={formData.pin_code}
                          onChange={(e) => handleChange("pin_code", e.target.value)}
                          className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Parent Details — hidden entirely when every guardian field is toggled off */}
                {!showForInstitutes([HOLISTIC_INSTITUTE_ID]) &&
                  (isFieldVisible("FATHER_NAME") ||
                    isFieldVisible("MOTHER_NAME") ||
                    isFieldVisible("PARENTS_EMAIL") ||
                    isFieldVisible("PARENTS_MOBILE_NUMBER")) && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-lg font-semibold text-gray-900 border-b pb-2">
                      <Users size={20} className="text-gray-500" weight="bold" />
                      <h3>{t("profileEdit.sections.guardianDetails")}</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {isFieldVisible("FATHER_NAME") && (
                        <div className="space-y-2">
                          <Label htmlFor="father_name" className="text-xs uppercase font-medium text-gray-500">
                            {t("profileEdit.fields.fatherName")}
                          </Label>
                          <Input
                            id="father_name"
                            value={formData.father_name}
                            onChange={(e) => handleChange("father_name", e.target.value)}
                            className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                        </div>
                      )}
                      {isFieldVisible("MOTHER_NAME") && (
                        <div className="space-y-2">
                          <Label htmlFor="mother_name" className="text-xs uppercase font-medium text-gray-500">
                            {t("profileEdit.fields.motherName")}
                          </Label>
                          <Input
                            id="mother_name"
                            value={formData.mother_name}
                            onChange={(e) => handleChange("mother_name", e.target.value)}
                            className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                        </div>
                      )}
                    </div>

                    {isFieldVisible("PARENTS_EMAIL") && (
                      <div className="space-y-2">
                        <Label htmlFor="parents_email" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.guardianEmail")}
                        </Label>
                        <div className="relative">
                          <Input
                            id="parents_email"
                            type="email"
                            value={formData.parents_email}
                            onChange={(e) => handleChange("parents_email", e.target.value)}
                            className="h-11 ps-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                          />
                          <EnvelopeSimple
                            size={18}
                            className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                        </div>
                      </div>
                    )}

                    {isFieldVisible("PARENTS_MOBILE_NUMBER") && (
                      <div className="space-y-2">
                        <Label htmlFor="parents_mobile_number" className="text-xs uppercase font-medium text-gray-500">
                          {t("profileEdit.fields.guardianMobile")}
                        </Label>
                        <PhoneInputField
                          label=""
                          name="parents_mobile_number"
                          placeholder={t("profileEdit.fields.mobileNumberPlaceholder")}
                          control={methods.control}
                          value={formData.parents_mobile_number}
                          onChange={(value) => handleChange("parents_mobile_number", value)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="pt-6 border-t border-gray-100 flex items-center justify-end gap-3 sticky bottom-0 bg-white p-4 -mx-6 -mb-6 md:p-0 md:m-0 md:static">
              <MyButton
                type="button"
                scale="medium"
                buttonType="secondary"
                layoutVariant="default"
                onClick={handleCancel}
              >
                {t("common.cancel")}
              </MyButton>
              <MyButton
                type="submit"
                scale="medium"
                buttonType="primary"
                layoutVariant="default"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <SpinnerGap className="h-4 w-4 animate-spin me-2" />
                    {t("common.saving")}
                  </>
                ) : (
                  t("profileEdit.saveChanges")
                )}
              </MyButton>
            </div>
          </form>

          {/* Payment & Billing — outside the profile <form> because the
              billing details editor submits its own form. Hidden on native iOS
              (reader-mode): payment methods / autopay / access-expiry are the
              paid-subscription surfaces Apple flags under Guideline 3.1.1. */}
          {studentData?.institute_id && formData.user_id && !shouldHidePaidPurchaseUI() && (
            <div className="border-t border-gray-100 p-6 md:p-8">
              <PaymentBillingSection
                instituteId={studentData.institute_id}
                userId={formData.user_id}
              />
            </div>
          )}
        </div>
      </div>
    </FormProvider>
  );
}
