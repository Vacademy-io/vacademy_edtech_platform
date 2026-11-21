import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { FileText, ArrowLeft, Users, CreditCard, WarningCircle, BookOpen } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";

export const Route = createFileRoute("/terms-and-conditions/")({
  component: TermsAndConditions,
});

function TermsAndConditions() {
  const { t } = useTranslation("miscRoutesB");
  const navigate = useNavigate();
  
  // Redirect to institute-specific terms if configured
  useEffect(() => {
    (async () => {
      try {
        const instituteId = (await Preferences.get({ key: "InstituteId" })).value || "";
        if (!instituteId) return;
        const stored = await Preferences.get({ key: `LEARNER_${instituteId}` });
        if (!stored?.value) return;
        const parsed = JSON.parse(stored.value);
        if (parsed?.termsAndConditionUrl) {
          window.location.assign(parsed.termsAndConditionUrl);
        }
      } catch {
        // Ignore and show internal terms page
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle Background Pattern (gradients removed) */}
      <div className="absolute inset-0 -z-10" />
      
      {/* Subtle Floating Background Elements */}
      <motion.div 
        animate={{ 
          x: [0, 20, 0],
          y: [0, -10, 0],
          rotate: [0, 2, 0] 
        }}
        transition={{ 
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut" 
        }}
        className="absolute top-20 start-20 w-48 h-48 bg-muted/10 rounded-full blur-3xl"
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          {/* Back Button */}
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => navigate({ to: "/login" })}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors duration-200 mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
            <span className="text-sm font-medium">{t("termsAndConditions.backToLogin")}</span>
          </motion.button>

          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gray-900 rounded-xl mx-auto flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              {t("termsAndConditions.header.title")}
            </h1>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              {t("termsAndConditions.header.description")}
            </p>
            <p className="text-sm text-gray-500 mt-4">
              {t("termsAndConditions.header.effectiveDate")}
            </p>
          </div>
        </motion.div>

        {/* Introduction */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 mb-8 space-y-4"
        >
          <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.welcome.title")}</h2>
          <p className="text-gray-700 leading-relaxed">
            {t("termsAndConditions.welcome.intro1")}
          </p>
          <p className="text-gray-700 leading-relaxed">
            {t("termsAndConditions.welcome.intro2")}
          </p>
        </motion.div>

        {/* Terms Sections */}
        <div className="space-y-6">
          {/* Acceptance of Terms */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
          >
            <div className="flex items-center gap-x-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.sections.acceptance.title")}</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.acceptance.agreement.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.acceptance.agreement.text")}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.acceptance.modifications.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.acceptance.modifications.text")}
                </p>
              </div>
            </div>
          </motion.div>

          {/* User Accounts */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
          >
            <div className="flex items-center gap-x-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.sections.userAccounts.title")}</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.userAccounts.creation.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.userAccounts.creation.text")}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.userAccounts.security.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.userAccounts.security.text")}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Educational Services */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
          >
            <div className="flex items-center gap-x-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.sections.educationalServices.title")}</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.educationalServices.courseAccess.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.educationalServices.courseAccess.text")}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.educationalServices.learningMaterials.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.educationalServices.learningMaterials.text")}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Payment Terms */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
          >
            <div className="flex items-center gap-x-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.sections.paymentTerms.title")}</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.paymentTerms.processing.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.paymentTerms.processing.text")}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.paymentTerms.refunds.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.paymentTerms.refunds.text")}
                </p>
              </div>
            </div>
          </motion.div>

          {/* User Conduct */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
          >
            <div className="flex items-center gap-x-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                <WarningCircle className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.sections.userConduct.title")}</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.userConduct.acceptableUse.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.userConduct.acceptableUse.text")}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-800">{t("termsAndConditions.sections.userConduct.prohibited.subtitle")}</h3>
                <p className="text-gray-700 leading-relaxed">
                  {t("termsAndConditions.sections.userConduct.prohibited.text")}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Contact Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 mt-8 space-y-4"
        >
          <h2 className="text-xl font-bold text-gray-900">{t("termsAndConditions.contact.title")}</h2>
          <p className="text-gray-700 leading-relaxed">
            {t("termsAndConditions.contact.intro")}
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800">{t("termsAndConditions.contact.legalLabel")}</h3>
              <p className="text-gray-600">{t("termsAndConditions.contact.legalEmail")}</p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800">{t("termsAndConditions.contact.supportLabel")}</h3>
              <p className="text-gray-600">{t("termsAndConditions.contact.supportEmail")}</p>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="text-center mt-12 mb-8 space-y-2"
        >
          <p className="text-sm text-gray-500">
            {t("termsAndConditions.footer.effective")}
          </p>
          <p className="text-xs text-gray-400">
            {t("termsAndConditions.footer.acknowledgement")}
          </p>
        </motion.div>
      </div>
    </div>
  );
} 