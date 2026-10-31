import { useNavigate } from "@tanstack/react-router";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import AccountDetailsEdit from "./account-details-edit";

const ChangePasswordPage = () => {
  const { t } = useTranslation("userProfileExtra");
  const navigate = useNavigate();
  const { permissions, isLoading: permissionsLoading } =
    useStudentPermissions();

  // Redirect if user doesn't have permission to edit profile
  useEffect(() => {
    if (!permissionsLoading && !permissions.canEditProfile) {
      navigate({ to: "/dashboard" });
    }
  }, [permissions.canEditProfile, permissionsLoading, navigate]);

  // Show loading while checking permissions
  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600">{t("changePassword.checkingPermissions")}</p>
        </div>
      </div>
    );
  }

  // Don't render if user doesn't have permission
  if (!permissions.canEditProfile) {
    return null;
  }

  return (
    <div className="bg-white relative rounded-lg h-screen w-full max-w-md mx-auto shadow-lg sm:max-w-md md:max-w-lg lg:max-w-xl">
      <AccountDetailsEdit isModal={false} />
    </div>
  );
};

export default ChangePasswordPage;
