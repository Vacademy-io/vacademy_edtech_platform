import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { ModularDynamicLoginContainer } from "@/components/common/auth/login/components/modular/ModularDynamicLoginContainer";
import { ModularDynamicSignupContainer } from "@/components/common/auth/signup/components/ModularDynamicSignupContainer";
import { ModalForgotPasswordForm } from "@/components/common/auth/login/forms/modal/ModalForgotPasswordForm";
// import { Preferences } from "@capacitor/preferences";
import { useSignupFlow } from "@/components/common/auth/signup/hooks/use-signup-flow";
import { useModularLoginFlow } from "@/components/common/auth/login/hooks/modular/use-modular-login-flow";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { resolveInstituteIdFromLocalOrSubdomain } from "@/services/institute-resolver";
import { useTranslation } from "react-i18next";
import { DashboardLoader } from "@/components/core/dashboard-loader";

interface AuthModalProps {
    type?: string;
    courseId?: string;
    trigger: React.ReactNode;
    onModalOpen?: () => void;
    onLoginSuccess?: () => void;
    onSignupSuccess?: () => void;
    initialMode?: 'login' | 'signup' | 'forgot-password';
}

export interface AuthModalRef {
    setIsOpen: (open: boolean) => void;
}

export const AuthModal = forwardRef<AuthModalRef, AuthModalProps>(({
    type,
    courseId,
    trigger,
    onModalOpen,
    onLoginSuccess,
    onSignupSuccess,
    initialMode = 'login'
}, ref) => {
    const { t } = useTranslation("auth");
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const isOpen = internalIsOpen;
    const [currentMode, setCurrentMode] = useState<'login' | 'signup' | 'forgot-password'>(initialMode);
    const [isVisible, setIsVisible] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [instituteIdFromStorage, setInstituteIdFromStorage] = useState<string | null>(null);
    const lastPrefetchedInstituteIdRef = useRef<string | null>(null);
    const [prefilledEmail, setPrefilledEmail] = useState<string>("");
    const [autoSendOtp, setAutoSendOtp] = useState<boolean>(false);
    
    // Use domain routing hook for institute ID resolution
    const domainRouting = useDomainRouting();
    
    // Use the signup flow hook to get institute details and signup settings
    const { state: signupState, handleInstituteSelect: selectInstitute, getSignupSettings } = useSignupFlow(false, type, courseId);

    // The signup container falls back to "every provider on" when it has no
    // settings yet, so between opening the modal and the institute details
    // landing it briefly offered Google, GitHub and (on iOS, via the 4.8
    // pairing rule) Sign in with Apple to portals that allow none of them.
    // Hold the container until the prefetch has settled — success or failure —
    // so the first thing drawn is the institute's real provider list.
    const [signupPrefetchSettled, setSignupPrefetchSettled] = useState(false);
    const handleInstituteSelect = useCallback(
        (id: string) => {
            setSignupPrefetchSettled(false);
            return Promise.resolve(selectInstitute(id)).finally(() =>
                setSignupPrefetchSettled(true)
            );
        },
        [selectInstitute]
    );
    const signupSettingsReady =
        !!signupState.signupSettings ||
        (signupPrefetchSettled && !signupState.isFetchingInstituteDetails);
    
    // Use the login flow hook to get login settings - prioritize domain routing, then storage
    const effectiveInstituteId = domainRouting.instituteId || instituteIdFromStorage || "";
    const { settings: loginSettings } = useModularLoginFlow({ 
        instituteId: effectiveInstituteId
    });



    // Expose setIsOpen method to parent component
    useImperativeHandle(ref, () => ({
        setIsOpen: (open: boolean) => {
            setInternalIsOpen(open);
        }
    }), []);

    // Determine the current route context for login redirection
    const getCurrentRouteContext = () => {
        const currentPath = window.location.pathname;
        const currentSearch = window.location.search;
        
        // If type and courseId are explicitly provided, use them
        if (type && courseId) {
            return { type, courseId, instituteId: instituteIdFromStorage };
        }
        
        // Extract parameters from URL
        const urlParams = new URLSearchParams(currentSearch);
        const urlType = urlParams.get('type');
        const urlCourseId = urlParams.get('courseId');
        const urlInstituteId = urlParams.get('instituteId');
        
        // Priority: 1. URL params, 2. Local storage, 3. Fallback
        const finalInstituteId = urlInstituteId || instituteIdFromStorage;
        
        // Otherwise, determine based on current route
        if (currentPath.includes("/courses/course-details")) {
            const courseIdFromUrl = urlParams.get("courseId");
            if (courseIdFromUrl) {
                return { 
                    type: urlType || "courseDetailsPage", 
                    courseId: courseIdFromUrl,
                    instituteId: finalInstituteId
                };
            }
        } else if (currentPath.includes("/courses")) {
            return { 
                type: urlType || "courseDetailsPage", 
                courseId: urlCourseId || undefined,
                instituteId: finalInstituteId
            };
        }
        
        // Default case - use URL parameters if available
        return { 
            type: urlType || undefined, 
            courseId: urlCourseId || undefined,
            instituteId: finalInstituteId
        };
    };

    // Resolve instituteId on mount (Preferences → subdomain) and prefetch
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Only run this effect if the modal is actually open
                if (!isOpen) {
                    return;
                }
                
                // First try domain routing
                if (domainRouting.instituteId && !cancelled) {
                    setInstituteIdFromStorage(domainRouting.instituteId);
                    if (lastPrefetchedInstituteIdRef.current !== domainRouting.instituteId) {
                        lastPrefetchedInstituteIdRef.current = domainRouting.instituteId;
                        handleInstituteSelect(domainRouting.instituteId);
                    }
                    return;
                }
                
                // Fallback to local storage and subdomain lookup
                const resolved = await resolveInstituteIdFromLocalOrSubdomain();
                if (!cancelled && resolved) {
                    setInstituteIdFromStorage(resolved);
                    // Prefetch once per institute per modal open
                    if (lastPrefetchedInstituteIdRef.current !== resolved) {
                        lastPrefetchedInstituteIdRef.current = resolved;
                        handleInstituteSelect(resolved);
                    }
                }
            } catch (e) {
                console.error("AuthModal: institute resolution failed", e);
            }
        })();
        return () => { cancelled = true; };
    }, [handleInstituteSelect, domainRouting.instituteId, isOpen]);

    // If user switches to signup and details aren't ready, prefetch (guarded against duplicate)
    useEffect(() => {
        if (currentMode === 'signup' && instituteIdFromStorage && !signupState.selectedInstitute) {
            if (lastPrefetchedInstituteIdRef.current !== instituteIdFromStorage) {
                lastPrefetchedInstituteIdRef.current = instituteIdFromStorage;
                handleInstituteSelect(instituteIdFromStorage);
            }
        }
    }, [currentMode, instituteIdFromStorage, signupState.selectedInstitute, handleInstituteSelect]);

    // Listen for postMessage from OAuth tab to switch to signup modal
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Only accept messages from the same origin
            if (event.origin !== window.location.origin) return;
            
            // Removed: auto-switching to signup on OAuth failure
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [isOpen]);

    // Check for closeModal parameter and close modal if present
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const closeModal = urlParams.get('closeModal');
        
        if (closeModal === 'true' && isOpen) {
            handleClose();
            // Remove the closeModal parameter from URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('closeModal');
            window.history.replaceState({}, '', newUrl.toString());
        }
    }, [isOpen]);

    // Prevent body scroll when modal is open
    useEffect(() => {
        let scrollY = 0;
        let preventScrollHandler: ((e: Event) => boolean) | null = null;
        
        if (isOpen) {
            // Store current scroll position
            scrollY = window.scrollY;
            
            // Add classes for styling
            document.body.classList.add('modal-open');
            document.documentElement.classList.add('modal-open');
            
            // Prevent scrolling by setting overflow hidden and position fixed
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.width = '100%';
            document.body.style.height = '100%';
            
            // Also prevent scrolling on html element
            document.documentElement.style.overflow = 'hidden';
            document.documentElement.style.height = '100%';
            
            // Prevent scrolling on background elements only, allow modal scrolling
            preventScrollHandler = (e: Event) => {
                const target = e.target as Element;
                const modalContent = dialogRef.current;
                
                // Allow scrolling within the modal content
                if (modalContent && (modalContent.contains(target) || modalContent === target)) {
                    return true;
                }
                
                // Prevent scrolling on background elements
                e.preventDefault();
                e.stopPropagation();
                return false;
            };
            
            // Add event listeners to prevent scroll
            document.addEventListener('wheel', preventScrollHandler, { passive: false });
            document.addEventListener('touchmove', preventScrollHandler, { passive: false });
            
        } else {
            // Restore scrolling
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.height = '';
            document.documentElement.style.overflow = '';
            document.documentElement.style.height = '';
            
            // Restore scroll position
            window.scrollTo(0, scrollY);
            
            // Remove classes
            document.body.classList.remove('modal-open');
            document.documentElement.classList.remove('modal-open');
            
            // Remove event listeners
            if (preventScrollHandler) {
                document.removeEventListener('wheel', preventScrollHandler);
                document.removeEventListener('touchmove', preventScrollHandler);
            }
        }

        return () => {
            // Cleanup on unmount
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.height = '';
            document.documentElement.style.overflow = '';
            document.documentElement.style.height = '';
            document.body.classList.remove('modal-open');
            document.documentElement.classList.remove('modal-open');
            
            if (preventScrollHandler) {
                document.removeEventListener('wheel', preventScrollHandler);
                document.removeEventListener('touchmove', preventScrollHandler);
            }
        };
    }, [isOpen]);

    // Animation and focus management
    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
            // Focus the modal content for accessibility
            setTimeout(() => {
                dialogRef.current?.focus();
            }, 100);
        } else {
            setIsVisible(false);
        }
    }, [isOpen]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                handleClose();
            }

            // Focus trapping
            if (event.key === 'Tab' && isOpen) {
                const focusableElements = dialogRef.current?.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );

                if (focusableElements) {
                    const firstElement = focusableElements[0] as HTMLElement;
                    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                    if (event.shiftKey && document.activeElement === firstElement) {
                        event.preventDefault();
                        lastElement.focus();
                    } else if (!event.shiftKey && document.activeElement === lastElement) {
                        event.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const handleSwitchToSignup = async (email?: string, shouldAutoSendOtp: boolean = false) => {
        // Store prefilled email if provided
        if (email) {
            setPrefilledEmail(email);
            setAutoSendOtp(shouldAutoSendOtp);
        }
        
        // Resolve again (cheap if already in Preferences), then prefetch if needed
        try {
            const resolved = await resolveInstituteIdFromLocalOrSubdomain();
            if (resolved && resolved !== instituteIdFromStorage) {
                setInstituteIdFromStorage(resolved);
            }
            const effectiveId = resolved || instituteIdFromStorage;
            if (effectiveId && lastPrefetchedInstituteIdRef.current !== effectiveId) {
                lastPrefetchedInstituteIdRef.current = effectiveId;
                handleInstituteSelect(effectiveId);
            }
        } catch (error) {
            console.error("AuthModal: Error selecting institute on signup:", error);
        }
        setCurrentMode('signup');
    };

    const handleSwitchToLogin = () => {
        // Clear prefilled data when switching back to login
        setPrefilledEmail("");
        setAutoSendOtp(false);
        setCurrentMode('login');
    };

    const handleSwitchToForgotPassword = () => {
        setCurrentMode('forgot-password');
    };

    const handleLoginSuccess = () => {
        // Close the modal after successful login
        handleClose();
        // Call the callback if provided
        if (onLoginSuccess) {
            onLoginSuccess();
        }
    };

    const handleSignupSuccess = () => {
        // Close the modal after successful signup
        handleClose();
        // Call the callback if provided
        if (onSignupSuccess) {
            onSignupSuccess();
        }
    };

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(() => {
            setInternalIsOpen(false);
            // Reset to caller's initial mode (defaults to login) and clear prefilled data
            setCurrentMode(initialMode);
            setPrefilledEmail("");
            setAutoSendOtp(false);
        }, 200);
    };

    const handleBackdropClick = (event: React.MouseEvent) => {
        if (event.target === event.currentTarget) {
            handleClose();
        }
    };

    if (!isOpen) {
        return <div onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            console.group("[AuthModal] Trigger Clicked");
            console.log("Opening modal from trigger");
            console.log("Current path:", window.location.pathname);
            console.log("Type:", type);
            console.log("CourseId:", courseId);
            console.groupEnd();
            
            setInternalIsOpen(true);
            // Call the optional callback when modal opens, but delay it slightly
            if (onModalOpen) {
                setTimeout(() => {
                    onModalOpen();
                }, 0);
            }
        }}>{trigger}</div>;
    }

    const modalContent = (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 transition-all duration-200 modal-backdrop ${
                isVisible
                    ? 'bg-gray-200 bg-opacity-50'
                    : 'bg-opacity-0'
            }`}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                visibility: 'visible',
                opacity: isVisible ? 1 : 0
            }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            aria-describedby="auth-description"
            data-testid="auth-modal-backdrop"
        >
            <div
                ref={dialogRef}
                className={`relative bg-white rounded-md border border-gray-200 shadow-xl transition-all duration-200 transform ${
                    isVisible
                        ? 'scale-100 opacity-100 translate-y-0'
                        : 'scale-95 opacity-0 translate-y-4'
                } scrollbar-hide auth-modal-content w-full max-w-reg-500 mx-4 sm:mx-6`}
                style={{
                    padding: '16px',
                    maxHeight: '90vh',
                    minHeight: 'auto',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                    zIndex: 100000,
                    position: 'relative',
                    display: 'block',
                    visibility: 'visible',
                    opacity: isVisible ? 1 : 0
                }}
                onClick={(e) => e.stopPropagation()}
                data-testid="auth-modal-content"
                tabIndex={-1}
            >
                {/* Screen reader title */}
                <h1 id="auth-title" className="sr-only">
                    {currentMode === 'login'
                        ? t('modal.loginDialog')
                        : currentMode === 'signup'
                        ? t('modal.signupDialog')
                        : t('modal.forgotPasswordDialog')}
                </h1>
                <p id="auth-description" className="sr-only">
                    {currentMode === 'login'
                        ? t('modal.loginDesc')
                        : currentMode === 'signup'
                        ? t('modal.signupDesc')
                        : t('modal.forgotDesc')}
                </p>

                {/* Close Button */}
                <button
                    onClick={handleClose}
                    className="absolute text-gray-400 hover:text-gray-600 text-3xl font-light focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-full transition-colors"
                    style={{ top: '6px', right: '16px' }}
                    aria-label={t('modal.closeDialog')}
                    type="button"
                >
                    ×
                </button>

                {/* Content */}
                <div className="mt-8 w-full pb-4">
                    {currentMode === 'login' ? (
                        <ModularDynamicLoginContainer
                            key={`login-${currentMode}-${instituteIdFromStorage}`}
                            instituteId={instituteIdFromStorage || ""}
                            settings={loginSettings}
                            signupSettings={getSignupSettings()}
                            type={getCurrentRouteContext().type} 
                            courseId={getCurrentRouteContext().courseId}
                            onSwitchToSignup={handleSwitchToSignup}
                            onSwitchToForgotPassword={handleSwitchToForgotPassword}
                            onLoginSuccess={handleLoginSuccess}
                        />
                                         ) : currentMode === 'signup' ? (
                         (() => {
                             const context = getCurrentRouteContext();
                             const signupInstituteId = context.instituteId || signupState.selectedInstitute?.id;
                             // No institute at all → let the container show its own
                             // "institute required" message instead of spinning forever.
                             if (signupInstituteId && !signupSettingsReady) {
                                 return <DashboardLoader height="12rem" />;
                             }
                             return (
                                                                 <ModularDynamicSignupContainer 
                                    instituteId={signupInstituteId}
                                    settings={getSignupSettings()}
                                    instituteDetails={signupState.selectedInstitute ? { setting: signupState.selectedInstitute.setting } : undefined}
                                    onSignupSuccess={handleSignupSuccess}
                                    onBackToProviders={handleSwitchToLogin}
                                    initialEmail={prefilledEmail}
                                    autoSendOtp={autoSendOtp}
                                />
                             );
                         })()
                    ) : (
                        <ModalForgotPasswordForm 
                            onBackToLogin={handleSwitchToLogin}
                        />
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}); 