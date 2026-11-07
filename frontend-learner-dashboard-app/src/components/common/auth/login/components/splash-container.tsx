import { motion } from "framer-motion";
import { SplashScreenProps } from "@/types/loginTypes";
// import { SsdcLogo_Login } from "@/assets/svgs";
import { useEffect } from "react";
import Logo from "@/svgs/ssdc-logo.svg?url"
import { useTranslation } from "react-i18next";

export const SplashScreen = ({ children }: SplashScreenProps) => {
  const { t } = useTranslation("authExtraA");
  useEffect(() => {
    // Disable scrolling while splash screen is active
    document.body.style.overflow = "hidden";
    return () => {
      // Re-enable scrolling after splash screen
      document.body.style.overflow = "auto";
    };
  }, []);

  return (
    <div className="fixed flex flex-col w-screen h-screen bg-white items-center justify-start z-50">
      {/* Fading Background */}
      <motion.div
        initial={{ backgroundColor: "hsl(var(--primary-50))" }}
        animate={{ backgroundColor: "rgba(255, 255, 255, 0)" }}
        transition={{
          duration: 2,
          delay: 1.25,
          ease: "easeInOut",
        }}
        className="fixed h-screen w-screen z-0"
      ></motion.div>

      {/* Animated Logo */}
      <motion.div
        className="relative flex flex-col w-full items-center justify-center z-10"
        style={{
          padding: "6%", // Matches padding from HeaderLogo
        }}
        initial={{ y: "50vh", scale: 3 }}
        animate={{ y: 0, scale: 1 }}
        transition={{
          duration: 1.5,
          delay: 0,
          ease: "easeInOut",
        }}
      >
        <img src={Logo} alt={t("logo.alt")} />
      </motion.div>

      {/* Content Section */}
      <motion.div
        className="relative w-full flex flex-col items-center text-neutral-600"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: 3.5,
          delay: 0.75,
          ease: "easeInOut",
        }}
      >
        {children}
      </motion.div>
    </div>
  );
};
