import { motion } from 'framer-motion';
import { LanguageDropdown } from '../../../../../components/common/localization/language-dropdown';
import { SplashScreenProps } from '@/routes/login/-types/loginTypes';
import LoginImage from '@/assets/svgs/login-image.svg';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import React, { useEffect, useRef, useState } from 'react';
import { getSubdomain, HOLISTIC_SUBDOMAIN } from '@/utils/subdomain';
import { useTranslation } from 'react-i18next';

export const SplashScreen = ({ children, isAnimationEnabled }: SplashScreenProps) => {
    const { t } = useTranslation('loginSplashContainer');
    const { instituteLogo, brandingDisplay } = useInstituteLogoStore();
    const [animationDone, setAnimationDone] = useState(!isAnimationEnabled);
    const animationTimeout = useRef<NodeJS.Timeout | null>(null);

    const hasCustomLogoDims =
        brandingDisplay.logoWidthPx != null || brandingDisplay.logoHeightPx != null;
    const customLogoStyle = hasCustomLogoDims
        ? {
              width: brandingDisplay.logoWidthPx ?? undefined,
              height: brandingDisplay.logoHeightPx ?? undefined,
          }
        : undefined;
    // When operator sets explicit dimensions, drop the circular crop so wide
    // logos are shown in full.
    const logoImgClass = hasCustomLogoDims
        ? 'object-contain'
        : 'size-2/3 rounded-full';

    useEffect(() => {
        if (isAnimationEnabled) {
            // Start animation timer
            animationTimeout.current = setTimeout(() => {
                setAnimationDone(true);
            }, 2000); // total animation duration (delay + duration)
        }

        // Listen for tab visibility changes
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isAnimationEnabled) {
                // If user returns and animation should be done, force complete
                setAnimationDone(true);
                if (animationTimeout.current) clearTimeout(animationTimeout.current);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (animationTimeout.current) clearTimeout(animationTimeout.current);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isAnimationEnabled]);

    return (
        <div className="flex min-h-screen w-screen bg-white">
            <div className="relative flex w-full items-center justify-center bg-primary-100">
                <motion.div
                    initial={
                        isAnimationEnabled ? { backgroundColor: '#FDEDD7', zIndex: '100' } : {}
                    }
                    animate={
                        animationDone
                            ? { backgroundColor: 'rgba(255, 255, 255, 0)', zIndex: 'auto' }
                            : { backgroundColor: '#FDEDD7', zIndex: '100' }
                    }
                    transition={{
                        duration: 1,
                        delay: 1.25,
                        ease: 'easeInOut',
                    }}
                    className="fixed left-0 top-0 h-screen w-screen"
                >
                    <motion.div
                        initial={
                            isAnimationEnabled
                                ? { x: '35vw', y: '25vh', scale: 1 }
                                : { x: 32, y: 32, scale: 0.25 }
                        }
                        animate={
                            animationDone
                                ? { x: 32, y: 32, scale: 0.25 }
                                : { x: '35vw', y: '25vh', scale: 1 }
                        }
                        transition={{
                            duration: 0.75,
                            delay: 1,
                            ease: 'easeInOut',
                        }}
                        className="left-8 top-8 size-full max-h-80 max-w-80 origin-top-left object-cover"
                    >
                        {instituteLogo ? (
                            <img
                                src={instituteLogo}
                                alt={t('instituteLogoAlt')}
                                className={logoImgClass}
                                style={customLogoStyle}
                            />
                        ) : getSubdomain() === HOLISTIC_SUBDOMAIN ? (
                            <img
                                src="/holistic-logo.svg"
                                alt={t('holisticLoginAlt')}
                                className="size-2/3 rounded-full"
                            />
                        ) : null}
                    </motion.div>
                </motion.div>
                {getSubdomain() === HOLISTIC_SUBDOMAIN ? (
                    <img src="/holistic-login.svg" alt={t('holisticLoginAlt')} className="size-2/3" />
                ) : (
                    <LoginImage />
                )}
            </div>
            <div className="relative flex w-full items-center justify-center text-neutral-600">
                <LanguageDropdown />
                <div className="w-[413px] items-center justify-center">{children}</div>
            </div>
        </div>
    );
};
