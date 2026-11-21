import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
    Shield,
    BookOpen,
    Users,
    Medal,
    Sparkle,
    CheckCircle,
    Star,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { ModularDynamicSignupContainer } from "../../components/ModularDynamicSignupContainer";
// Removed unused imports - using ModularDynamicSignupContainer instead
import { useModularSignupFlow } from "../../hooks/use-modular-signup-flow";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useTranslation } from "react-i18next";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";

export function SignUpForm({
    type,
    // courseId intentionally unused in current flow
}: {
    type?: string;
    courseId?: string;
}) {
    const { t } = useTranslation("auth");
    const navigate = useNavigate();
    const search = useSearch({ from: "/signup/" });
    useDomainRouting();
    const coursesPlural = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    );
    
    // Use search parameters if not provided as props
    const finalType = type || (search as { type?: string; courseId?: string; instituteId?: string }).type;
    const instituteId = (search as { instituteId?: string }).instituteId;

    // Check for OAuth callback parameters to extract institute ID
    const [finalInstituteId, setFinalInstituteId] = useState<string | null>(null);

    useEffect(() => {
      // Check if we have OAuth callback parameters
      const urlParams = new URLSearchParams(window.location.search);
      const signupDataParam = urlParams.get("signupData");
      const stateParam = urlParams.get("state");
      

      
      if (signupDataParam && stateParam) {
        try {
          const decodedState = JSON.parse(atob(stateParam));
          
          if (decodedState?.institute_id) {
            setFinalInstituteId(decodedState.institute_id);
            return;
          }
        } catch {
          // Silently handle OAuth state decoding errors
        }
      }
      
      // Fallback to instituteId from search params
      if (instituteId) {
        setFinalInstituteId(instituteId);
      } else {
        setFinalInstituteId(null);
      }
    }, [instituteId]);
    
    // Use the modular signup flow hook only if we have an institute ID
    const { settings } = useModularSignupFlow({ 
      instituteId: finalInstituteId || "" 
    });
    


    // Removed modal-specific logic - using unified signup flow

    return (
        <div
            className={`${finalType ? "h-reg-400 overflow-auto" : "min-h-screen overflow-hidden"}  bg-gray-50 relative `}
        >
            {/* Subtle Background Pattern (gradients removed) */}
            <div className="absolute inset-0 -z-10" />

            

            {/* Main Content */}
            <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
                <div className="w-full max-w-md">
                    {/* Header */}
                    <motion.div
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="text-center mb-8"
                    >
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                                delay: 0.2,
                                type: "spring",
                                stiffness: 200,
                            }}
                            className="w-20 h-20 bg-neutral-800 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-lg"
                        >
                            <Shield className="w-10 h-10 text-white" />
                        </motion.div>
                        <motion.h1
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.3, duration: 0.5 }}
                            className="text-3xl font-bold text-gray-900 mb-3"
                        >
                            {t("signup.joinCommunity")}
                        </motion.h1>
                        <motion.p
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4, duration: 0.5 }}
                            className="text-gray-600 text-lg leading-relaxed"
                        >
                            {t("signup.startJourney")}
                        </motion.p>
                        </motion.div>

                    {/* Dynamic content removed from left column to avoid duplicate sign-up containers */}

                    {/* Footer Features */}
                            <motion.div
                        initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.7, duration: 0.6 }}
                        className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4"
                    >
                        <motion.div
                            whileHover={{ scale: 1.05 }}
                            className="flex flex-col items-center text-center p-4 bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200/50 gap-2"
                        >
                            <BookOpen className="w-6 h-6 text-gray-700" />
                            <span className="text-sm font-medium text-gray-700">
                                {t("signup.accessCourses", { courses: coursesPlural })}
                            </span>
                            </motion.div>
                        <motion.div
                            whileHover={{ scale: 1.05 }}
                            className="flex flex-col items-center text-center p-4 bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200/50 gap-2"
                        >
                            <Users className="w-6 h-6 text-gray-700" />
                            <span className="text-sm font-medium text-gray-700">
                                {t("signup.joinCommunityFeature")}
                            </span>
                        </motion.div>
                        <motion.div
                            whileHover={{ scale: 1.05 }}
                            className="flex flex-col items-center text-center p-4 bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200/50 gap-2"
                        >
                            <Medal className="w-6 h-6 text-gray-700" />
                            <span className="text-sm font-medium text-gray-700">
                                {t("signup.earnCertificates")}
                            </span>
                        </motion.div>
                    </motion.div>

                    {/* Features Grid */}
                    <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.8 }}
                        className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                        {[
                            {
                                icon: BookOpen,
                                title: t("signup.accessCourses", {
                                    courses: coursesPlural,
                                }),
                                desc: t("signup.featureCoursesDesc", {
                                    courses: coursesPlural.toLowerCase(),
                                })
                            },
                            {
                                icon: Users,
                                title: t("signup.joinCommunityFeature"),
                                desc: t("signup.featureCommunityDesc")
                            },
                            {
                                icon: Medal,
                                title: t("signup.earnCertificates"),
                                desc: t("signup.featureCertificatesDesc")
                            }
                        ].map((feature, index) => (
                            <motion.div
                                key={feature.title}
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.6 + index * 0.05 }}
                                whileHover={{ scale: 1.02 }}
                                className="group p-3 rounded-md bg-white border border-gray-200 hover:bg-gray-50 transition-colors duration-200"
                            >
                                <feature.icon className="w-6 h-6 text-gray-700 mb-2 group-hover:scale-105 transition-transform duration-200" />
                                <h3 className="font-semibold text-gray-900 mb-1 text-sm">
                                    {feature.title}
                                </h3>
                                <p className="text-xs text-gray-600">
                                    {feature.desc}
                                </p>
                            </motion.div>
                        ))}




                        {/* Compact Trust Indicators */}

                        <motion.div

                            initial={{ y: 20, opacity: 0 }}

                            animate={{ y: 0, opacity: 1 }}

                            transition={{ delay: 0.8 }}

                            className="space-y-4"

                        >

                            <div className="flex items-center space-x-6 text-sm text-gray-500">

                                <div className="flex items-center space-x-2">

                                    <Shield className="w-4 h-4" />

                                    <span>{t("signup.isoCertified")}</span>

                                </div>

                                <div className="flex items-center space-x-2">

                                    <Sparkle className="w-4 h-4" />

                                    <span>{t("signup.uptime")}</span>

                                </div>

                            </div>

                            

                            {/* Social Proof */}

                            <div className="bg-white border border-gray-200 rounded-md p-4">

                                <div className="flex items-center space-x-2 mb-2">

                                    <div className="flex">

                                        {[1, 2, 3, 4, 5].map((star) => (

                                            <Star key={star} className="w-4 h-4 fill-yellow-400 text-yellow-400" />

                                        ))}

                                    </div>

                                    <span className="text-sm font-medium text-gray-700">4.9/5</span>

                                </div>

                                <p className="text-xs text-gray-600">

                                    {t("signup.testimonial")}

                                </p>

                                <p className="text-xs text-gray-500 mt-1">{t("signup.testimonialAuthor")}</p>

                            </div>

                        </motion.div>

                                         </motion.div>

                 </div>

                 {/* Right Side - Compact Sign Up Form */}

                <motion.div

                    initial={{ x: 50, opacity: 0 }}

                    animate={{ x: 0, opacity: 1 }}

                    transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}

                    className={`w-full ${type ? "p-4 bg-white" : "lg:w-1/2 xl:w-1/2  p-4 lg:p-6 xl:p-8 "}  flex items-center justify-center`}

                >

                    <div className="w-full max-w-lg xl:max-w-xl">

                        {/* Compact Sign Up Card */}

                        <motion.div

                            initial={{ y: 20, opacity: 0, scale: 0.98 }}

                            animate={{ y: 0, opacity: 1, scale: 1 }}

                            transition={{ delay: 0.3, duration: 0.4 }}

                            className={`bg-white rounded-md ${finalType ? "" : "shadow-md border border-gray-200 p-5 lg:p-6 xl:p-8"}  `}

                        >

                            {/* Header - Always show for consistent UX */}
                                <motion.div

                                    initial={{ y: 10, opacity: 0 }}

                                    animate={{ y: 0, opacity: 1 }}

                                    transition={{ delay: 0.5 }}

                                    className="text-center mb-6 space-y-2"

                                >

                                    <h2 className="text-xl lg:text-2xl font-bold text-gray-900">

                                        {t("signup.createAccount")}

                                    </h2>

                                    <p className="text-gray-600 text-sm">

                                        {t("signup.joinAndStart")}

                                    </p>

                                </motion.div>



                            {/* Form Content */}

                            <motion.div

                                initial={{ y: 10, opacity: 0 }}

                                animate={{ y: 0, opacity: 1 }}

                                transition={{ delay: 1.1 }}

                            >

                                {finalInstituteId && settings ? (
                                    <ModularDynamicSignupContainer
                                        instituteId={finalInstituteId ?? undefined}
                                        settings={settings}
                                        onBackToProviders={() => navigate({ to: "/login" })}
                                    />
                                ) : (
                                    <div className="text-center py-8 space-y-4">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                        <p className="text-gray-600">{t("signup.loadingOptions")}</p>
                                    </div>
                                )}

                            </motion.div>



                            {/* Compact Security Notice */}

                            <motion.div

                                initial={{ y: 10, opacity: 0 }}

                                animate={{ y: 0, opacity: 1 }}

                                transition={{ delay: 1.3 }}

                                className="mt-6 p-3 bg-gray-50/80 border border-gray-200/60 rounded-md"

                            >

                                <div className="flex items-start space-x-2">

                                    <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />

                                    <div className="space-y-1">

                                        <p className="text-xs font-medium text-gray-800">

                                            {t("signup.freeToStart")}

                                        </p>

                                        <p className="text-xs text-gray-600">

                                            {t("signup.freeToStartDesc")}

                                        </p>

                                    </div>

                                </div>

                            </motion.div>

                        </motion.div>



                        {/* Compact Footer Links */}

                        <motion.div

                            initial={{ y: 10, opacity: 0 }}

                            animate={{ y: 0, opacity: 1 }}

                            transition={{ delay: 1.5 }}

                            className="mt-6 text-center text-xs text-gray-600"

                        >

                            <p>

                                {t("signup.byCreating")}{" "}

                                <motion.button

                                    whileHover={{ scale: 1.02 }}

                                    onClick={() =>

                                        navigate({

                                            to: "/terms-and-conditions",

                                        })

                                    }

                                    className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"

                                >

                                    {t("signup.termsOfService")}

                                </motion.button>{" "}

                                {t("common.and")}{" "}

                                <motion.button

                                    whileHover={{ scale: 1.02 }}

                                    onClick={() =>

                                        navigate({ to: "/privacy-policy" })

                                    }

                                    className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"

                                >

                                    {t("common.privacyPolicy")}

                                </motion.button>

                            </p>

                        </motion.div>

                    </div>

                </motion.div>

            </div>

        </div>

    );

} 
