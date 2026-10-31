import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { MyButton } from "@/components/design-system/button";
import { SpinnerGap, User, Envelope, Phone, CaretRight, CheckCircle } from "@phosphor-icons/react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";
import { isValidPhoneValue } from "@/lib/phone-validation";
import {
    phoneFieldHasInput,
    usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import { getAccessToken, isTokenExpired } from "@/lib/auth/sessionUtility";
import { Preferences } from "@capacitor/preferences";
import {
    ENROLLMENT_PAYMENT_INITIATION,
    ENROLLMENT_PAYMENT_INITIATION_V2,
    ENROLLMENT_INVITE_URL,
    LIVE_SESSION_REQUEST_OTP,
    LIVE_SESSION_VERIFY_OTP,
    REQUEST_WHATSAPP_OTP,
    VERIFY_WHATSAPP_OTP,
    INSTITUTE_ID,
} from "@/constants/urls";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { getBooksPreferenceFieldId } from "../../-services/custom-fields-service";
import { toast } from "sonner";
import axios from "axios";
import { performFullAuthCycle } from "@/services/auth-cycle-service";
import { loginEnrolledUser } from "@/services/signup-api";
import { AddressForm, AddressFormHandle } from "./AddressForm";
import {
    ResolvedCharge,
    buildChargeEnrollmentEntries,
    sumChargeAmounts,
} from "../../-utils/additional-charges-util";

interface CheckoutFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    totalAmount: number;
    items: any[];
    membershipPlan?: any;
    isRentMode?: boolean;
    additionalCharges?: ResolvedCharge[];
    /** The page editor's preview: nothing is sent (no real enrolment,
     *  payment, lead or paid WhatsApp OTP from an editor trying the cart). */
    isPreviewMode?: boolean;
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({
    open,
    onOpenChange,
    instituteId,
    totalAmount,
    items,
    membershipPlan,
    isRentMode = false,
    additionalCharges = [],
    isPreviewMode = false,
}) => {
    const { t } = useTranslation("coursePlayerB");
    const { t: tPreview } = useTranslation("coursePlayerA");
    /** True (and says so) when this is the editor's preview: send nothing. */
    const heldInPreview = (): boolean => {
        if (!isPreviewMode) return false;
        toast.info(tPreview("courseCataloguePage.previewFormNotSent"));
        return true;
    };
    const [email, setEmail] = useState("");
    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState("");
    // Pre-fill source for AddressForm — only the 4 backend-indexed fields are
    // restored from StudentDetails; granular UI fields stay blank because the
    // stored addressLine is a single concatenated string we can't reliably split.
    const [initialAddressInputs, setInitialAddressInputs] = useState<{
        city?: string;
        region?: string;
        pinCode?: string;
    }>({});
    const addressFormRef = React.useRef<AddressFormHandle>(null);
    const [loading, setLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [phoneOtpSent, setPhoneOtpSent] = useState(false);
    const [isPhoneVerified, setIsPhoneVerified] = useState(false);
    const [isLoadingPhoneOtp, setIsLoadingPhoneOtp] = useState(false);
    const [isVerifyingPhoneOtp, setIsVerifyingPhoneOtp] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [showFullForm, setShowFullForm] = useState(true);

    const [emailError, setEmailError] = useState("");
    const [phoneError, setPhoneError] = useState("");

    // What this phone field starts on: the institute's configured preferred
    // countries, or — when it configured none, or the portal is on GEO_FIRST —
    // the country the visitor is opening this page from.
    //
    // A hook rather than a one-shot read: these pages are public and routinely
    // render before domain routing replies, which used to leave the field on the
    // platform fallback (+91) for every visitor. It takes the institute's answer
    // whenever it lands, and never once a number has been typed into the box.
    const { defaultCountry: defaultPhoneCountry, preferredCountries } =
        usePreferredPhoneCountries({ freeze: phoneFieldHasInput(phone) });
    const [nameError, setNameError] = useState("");

    const [paymentPlanData, setPaymentPlanData] = useState<any>(null);
    // Per-item plan data: maps enrollInviteId -> { planId, paymentOptionId }
    const [perItemPlanData, setPerItemPlanData] = useState<Record<string, { planId: string; paymentOptionId: string }>>({});
    const otpInputRef = React.useRef<HTMLInputElement>(null);

    const targetInviteId = membershipPlan?.enrollInviteId ||
        (items.length > 0 ? items[0]?.enrollInviteId : null);

    // Add validation
    useEffect(() => {
        if (!open || !targetInviteId) {
            if (open && !targetInviteId) {
                console.error("[CheckoutForm] No valid enrollInviteId found");
                toast.error(t("checkoutForm.toast.missingEnrollmentInfo"));
            }
            return;
        }
        // ... rest of fetch logic
    }, [open, targetInviteId, instituteId]);

    // Auto-focus OTP input when it appears
    useEffect(() => {
        if (phoneOtpSent && otpInputRef.current) {
            setTimeout(() => {
                otpInputRef.current?.focus();
            }, 100);
        }
    }, [phoneOtpSent]);

    // Reset state when opening/closing
    useEffect(() => {
        if (!open) {
            setPhoneOtpSent(false);
            setOtp("");
            setIsPhoneVerified(false);
            setShowFullForm(true);
        } else {
            const checkAuthAndLoadProfile = async () => {
                try {
                    const token = await getAccessToken();
                    if (token && !isTokenExpired(token)) {
                        setIsAuthenticated(true);
                        const { value } = await Preferences.get({ key: "StudentDetails" });
                        if (value) {
                            const parsedData = JSON.parse(value);
                            const studentDetails = Array.isArray(parsedData) ? parsedData[0] : parsedData;
                            if (studentDetails) {
                                setFullName(studentDetails.full_name || studentDetails.first_name || "");
                                setEmail(studentDetails.email || studentDetails.username || "");
                                const phoneNum = studentDetails.mobile_number || studentDetails.phone_number || "";
                                setPhone(phoneNum);
                                setInitialAddressInputs({
                                    city: studentDetails.city || undefined,
                                    region: studentDetails.region || undefined,
                                    pinCode: studentDetails.pin_code || undefined,
                                });
                                
                                const hasPhone = !!(phoneNum && phoneNum.replace(/\D/g, "").length >= 10);
                                if (hasPhone) {
                                    setIsPhoneVerified(true);
                                }
                                
                                setShowFullForm(!hasPhone);
                            }
                        }
                    } else {
                        setIsAuthenticated(false);
                        setShowFullForm(true);
                    }
                } catch (error) {
                    console.error(error);
                    setIsAuthenticated(false);
                    setShowFullForm(true);
                }
            };
            checkAuthAndLoadProfile();
        }
    }, [open]);

    // Fetch enrollment details for each unique enrollInviteId to get per-item plan_id and payment_option_id
    useEffect(() => {
        if (!open || isInitializing) return;

        // Collect unique enrollInviteIds from all cart items
        const inviteIds = isRentMode && targetInviteId
            ? [targetInviteId]
            : [...new Set(items.map(item => item.enrollInviteId).filter(Boolean))];

        if (inviteIds.length === 0) return;

        console.log("[CheckoutForm] Fetching enrollment details for invites:", inviteIds);
        setIsInitializing(true);

        Promise.all(
            inviteIds.map(inviteId =>
                axios.get(`${ENROLLMENT_INVITE_URL}/${instituteId}/${inviteId}`)
                    .then(response => ({ inviteId, data: response.data }))
                    .catch(err => {
                        console.error(`[CheckoutForm] Failed to fetch enrollment details for invite ${inviteId}:`, err);
                        return null;
                    })
            )
        )
            .then(results => {
                const perItemData: Record<string, { planId: string; paymentOptionId: string }> = {};
                let firstPlanData: any = null;

                for (const result of results) {
                    if (!result) continue;
                    const { inviteId, data } = result;

                    if (data.package_session_to_payment_options?.length > 0) {
                        const firstOption = data.package_session_to_payment_options[0];
                        const plans = firstOption.payment_option.payment_plans;
                        if (plans?.length > 0) {
                            perItemData[inviteId] = {
                                planId: plans[0].id,
                                paymentOptionId: firstOption.payment_option.id,
                            };

                            // Use first result as the shared paymentPlanData (for vendorId, rent mode, etc.)
                            if (!firstPlanData) {
                                firstPlanData = {
                                    planId: plans[0].id,
                                    paymentOptionId: firstOption.payment_option.id,
                                    enrollInviteId: firstOption.enroll_invite_id || data.id,
                                    vendorId: data.vendor_id || "RAZORPAY"
                                };
                            }
                        }
                    }
                }

                console.log("[CheckoutForm] Per-item plan data resolved:", perItemData);
                setPerItemPlanData(perItemData);
                if (firstPlanData) {
                    setPaymentPlanData(firstPlanData);
                }
            })
            .catch(err => {
                console.error("[CheckoutForm] Failed to fetch enrollment details:", err);
                toast.error(t("checkoutForm.toast.loadPaymentOptionsFailed"));
            })
            .finally(() => {
                setIsInitializing(false);
            });

    }, [open, targetInviteId, instituteId, items.length]);

    const validateEmail = (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // Country-aware validity for the number the user typed (dial code embedded).
    const validatePhone = (phone: string): boolean => isValidPhoneValue(phone);

    const handleSendPhoneOTP = async () => {
        if (heldInPreview()) return;
        if (!phone.trim() || !validatePhone(phone)) {
            setPhoneError(t("checkoutForm.errors.phoneRequiredOtp"));
            return;
        }

        setIsLoadingPhoneOtp(true);
        try {
            await axios.post(
                REQUEST_WHATSAPP_OTP,
                {
                    phone_number: phone.replace(/\D/g, ""),
                    institute_id: instituteId
                },
                {
                    headers: { "Content-Type": "application/json" },
                }
            );

            setPhoneOtpSent(true);
            toast.success(t("checkoutForm.toast.otpSentWhatsapp"));
        } catch (error) {
            console.error("Failed to send WhatsApp OTP:", error);
            toast.error(t("checkoutForm.toast.otpSendFailed"));
        } finally {
            setIsLoadingPhoneOtp(false);
        }
    };

    const handleVerifyPhoneOTP = async () => {
        if (heldInPreview()) return;
        if (!otp.trim()) {
            toast.error(t("checkoutForm.errors.otpRequired"));
            return;
        }

        setIsVerifyingPhoneOtp(true);
        try {
            await axios.post(
                VERIFY_WHATSAPP_OTP,
                {
                    phone_number: phone.replace(/\D/g, ""),
                    otp: otp,
                    institute_id: instituteId
                },
                {
                    headers: { "Content-Type": "application/json" },
                }
            );

            setIsPhoneVerified(true);
            setPhoneOtpSent(false);
            setOtp("");
            setPhoneError("");
            toast.success(t("checkoutForm.toast.phoneVerified"));
        } catch (error) {
            console.error("Failed to verify WhatsApp OTP:", error);
            toast.error(t("checkoutForm.toast.otpInvalid"));
        } finally {
            setIsVerifyingPhoneOtp(false);
        }
    };

    const handleCheckout = async () => {
        if (heldInPreview()) return;
        let hasErrors = false;
        setEmailError("");
        setPhoneError("");
        setNameError("");

        if (showFullForm) {
            if (!fullName.trim()) {
                setNameError(t("checkoutForm.errors.fullNameRequired"));
                hasErrors = true;
            }
            if (!email.trim() || !validateEmail(email)) {
                setEmailError(t("checkoutForm.errors.emailRequired"));
                hasErrors = true;
            }
            if (!phone.trim() || !validatePhone(phone)) {
                setPhoneError(t("checkoutForm.errors.phoneRequired"));
                hasErrors = true;
            }
        }

        if (!isPhoneVerified) {
            setPhoneError(t("checkoutForm.errors.phoneVerificationRequired"));
            hasErrors = true;
        }
        // AddressForm renders its own field-level errors when validate() runs.
        if (!addressFormRef.current?.validate()) {
            hasErrors = true;
        }

        if (hasErrors) return;

        const addressValue = addressFormRef.current!.getValue();

        setLoading(true);
        try {
            const orderId = `book_order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Store order_id in localStorage for verification on return
            localStorage.setItem("pendingOrderId", orderId);

            // Common user payload
            const userPayload = {
                full_name:
                    fullName.trim() ||
                    getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                email: email.trim() || "student@example.com",
                mobileNumber: phone,
                address_line: addressValue.addressLine,
                city: addressValue.city,
                region: addressValue.region,
                pin_code: addressValue.pinCode,
                date_of_birth: new Date().toISOString(),
                gender: null,
                password: "",
                profile_pic_file_id: "",
                roles: ["STUDENT"],
            };

            // Get the redirect URL (current page)
            const redirectUrl = window.location.href;

            let response;

            if (isRentMode) {
                // ============ RENT MODE: Use v1 API with custom_field_values ============
                console.log("[CheckoutForm] Processing RENT mode checkout");

                // Fetch the "Books Preference" custom field ID
                const booksPreferenceFieldId = await getBooksPreferenceFieldId(instituteId);

                if (!booksPreferenceFieldId) {
                    throw new Error(t("checkoutForm.errors.booksPreferenceMissing"));
                }

                // Build the books preference value - only the book names (titles)
                const bookNames = items.map(item => item.title || item.name || "Unknown Book");
                const booksPreferenceValue = bookNames.join(", ");

                console.log("[CheckoutForm] Books preference value (names only):", booksPreferenceValue);

                // Use membership plan for Rent mode
                const sessionIds = membershipPlan?.packageSessionId
                    ? [membershipPlan.packageSessionId]
                    : [];

                const rentPayload = {
                    user: {
                        ...userPayload,
                        username: email.split('@')[0],
                        mobile_number: phone,
                        root_user: true,
                    },
                    institute_id: instituteId,
                    subject_id: "",
                    vendor_id: "RAZORPAY",
                    learner_package_session_enroll: {
                        package_session_ids: sessionIds,
                        plan_id: paymentPlanData?.planId || membershipPlan?.id || items[0]?.id,
                        payment_option_id: paymentPlanData?.paymentOptionId || "default",
                        enroll_invite_id: paymentPlanData?.enrollInviteId || membershipPlan?.enrollInviteId || items[0]?.enrollInviteId || items[0]?.id,
                        payment_initiation_request: {
                            amount: totalAmount,
                            currency: "INR",
                            description: `Rent subscription for ${items.length} books`,
                            charge_automatically: true,
                            institute_id: instituteId,
                            order_id: orderId,
                            redirect_url: redirectUrl,
                            razorpay_request: {
                                redirect_url: redirectUrl
                            }
                        },
                        custom_field_values: [
                            {
                                custom_field_id: booksPreferenceFieldId,
                                value: booksPreferenceValue
                            }
                        ],
                    },
                };

                console.log("[CheckoutForm] Sending RENT Checkout Payload:", rentPayload);

                response = await axios.post(
                    ENROLLMENT_PAYMENT_INITIATION,
                    rentPayload,
                    {
                        headers: {
                            "clientId": instituteId,
                            "X-Institute-Id": instituteId
                        }
                    }
                );
            } else {
                // ============ BUY MODE: Use v2 API with learner_package_session_enrollments array ============
                console.log("[CheckoutForm] Processing BUY mode checkout");

                // Build learner_package_session_enrollments array for each item
                // Use per-item plan data resolved from each book's own enroll invite
                const bookEnrollments = items.map(item => {
                    const itemPlan = perItemPlanData[item.enrollInviteId];
                    return {
                        package_session_id: item.packageSessionId || item.id,
                        plan_id: itemPlan?.planId || paymentPlanData?.planId || item.planId || item.id,
                        payment_option_id: itemPlan?.paymentOptionId || paymentPlanData?.paymentOptionId || item.paymentOptionId || "default",
                        enroll_invite_id: item.enrollInviteId || item.id
                    };
                });

                // Append one enrollment entry per additional charge (e.g. shipping tier).
                // Backend treats each entry identically — UserPlan + PaymentLog per entry,
                // grouped under the same MP order ID. Amount is validated against the sum
                // of each entry's PaymentPlan.actualPrice.
                const chargeEnrollments = buildChargeEnrollmentEntries(additionalCharges);
                const learnerPackageSessionEnrollments = [...bookEnrollments, ...chargeEnrollments];

                const booksSubtotal = items.reduce(
                    (total, item) => total + (item.price * (item.quantity || 1)),
                    0
                );
                const calculatedTotalAmount = booksSubtotal + sumChargeAmounts(additionalCharges);

                const buyPayload = {
                    user: userPayload,
                    institute_id: instituteId,
                    vendor_id: "RAZORPAY",
                    learner_package_session_enrollments: learnerPackageSessionEnrollments,
                    payment_initiation_request: {
                        amount: calculatedTotalAmount,
                        currency: "INR",
                        merchant_id: "PGTESTPAYUAT",
                        redirect_url: redirectUrl,
                        razorpay_request: {
                            redirect_url: redirectUrl
                        }
                    }
                };

                console.log("[CheckoutForm] Sending BUY Checkout Payload:", buyPayload);

                response = await axios.post(
                    ENROLLMENT_PAYMENT_INITIATION_V2,
                    buyPayload,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "clientId": instituteId,
                            "X-Institute-Id": instituteId
                        }
                    }
                );
            }

            console.log("Checkout response data:", response.data);

            // Update local storage if backend returned a different order/transaction ID
            // Check multiple possible locations for the authoritative ID
            const backendOrderId =
                response.data?.payment_response?.order_id ||
                response.data?.payment_response?.response_data?.razorpayOrderId;

            if (backendOrderId && backendOrderId !== orderId) {
                console.log("Backend generated different Order ID. Updating localStorage:", backendOrderId);
                localStorage.setItem("pendingOrderId", backendOrderId);
            }

            // Handle automatic login BEFORE redirection or finishing
            const userUsername = response.data?.user?.username;
            const userPassword = response.data?.user?.password;

            // Check if tokens are directly in the response (most automatic flow)
            const directAccessToken = response.data?.accessToken || response.data?.token?.accessToken || response.data?.responseData?.accessToken;
            const directRefreshToken = response.data?.refreshToken || response.data?.token?.refreshToken || response.data?.responseData?.refreshToken;

            if (directAccessToken && directRefreshToken) {
                try {
                    console.log("[CheckoutForm] Found direct tokens in response, performing auth cycle");
                    await performFullAuthCycle({ accessToken: directAccessToken, refreshToken: directRefreshToken }, instituteId || INSTITUTE_ID);
                } catch (e) {
                    console.error("[CheckoutForm] Auth cycle with direct tokens failed:", e);
                }
            } else if (userUsername && userPassword) {
                try {
                    console.log("[CheckoutForm] Performing direct auto-login cycle using credentials");
                    const loginResponse = await loginEnrolledUser(userUsername, userPassword, instituteId || INSTITUTE_ID);
                    await performFullAuthCycle(loginResponse, instituteId || INSTITUTE_ID);

                    // Store as fallback for post-redirect verification in CartComponent if needed
                    localStorage.setItem("pendingUsername", userUsername);
                    localStorage.setItem("pendingUserPassword", userPassword);
                    localStorage.setItem("pendingInstituteId", instituteId || INSTITUTE_ID);
                } catch (loginError) {
                    console.error("[CheckoutForm] Pre-redirect auto-login failed:", loginError);
                }
            }

            // Use dynamic origin for redirection
            const targetDashboardUrl = new URL("/dashboard", window.location.origin).toString();

            // Store credentials and tokens BEFORE ANY REDIRECT
            if (userUsername && userPassword) {
                console.log("[CheckoutForm] Storing pending credentials for CartComponent fallback");
                localStorage.setItem("pendingUsername", userUsername);
                localStorage.setItem("pendingUserPassword", userPassword);
            }

            if (directAccessToken && directRefreshToken) {
                console.log("[CheckoutForm] Storing pending tokens for CartComponent auto-login");
                localStorage.setItem("pendingAccessToken", directAccessToken);
                localStorage.setItem("pendingRefreshToken", directRefreshToken);
                localStorage.setItem("pendingInstituteId", instituteId || INSTITUTE_ID);
            }

            // Handle Razorpay Modal flow
            const razorpayOrderId = response.data?.payment_response?.response_data?.razorpayOrderId;
            const razorpayKeyId = response.data?.payment_response?.response_data?.razorpayKeyId;

            if (razorpayOrderId && razorpayKeyId) {
                // Dynamically load Razorpay script if not already loaded
                if (!(window as any).Razorpay) {
                    await new Promise<void>((resolve, reject) => {
                        const script = document.createElement("script");
                        script.src = "https://checkout.razorpay.com/v1/checkout.js";
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error(t("checkoutForm.errors.razorpaySdkLoadFailed")));
                        document.body.appendChild(script);
                    });
                }
                const options = {
                    key: razorpayKeyId,
                    amount: response.data?.payment_response?.response_data?.amountDue || (totalAmount * 100),
                    currency: response.data?.payment_response?.response_data?.currency || "INR",
                    name: t("checkoutForm.header.title"),
                    description: t("checkoutForm.razorpayDescription", {
                        course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    }),
                    order_id: razorpayOrderId,
                    handler: async function (razorpayResponse: any) {
                        console.log("Razorpay payment success:", razorpayResponse);
                        toast.success(t("checkoutForm.toast.paymentSuccessful"));
                        
                        // Wait for a brief moment for backend to process
                        setTimeout(() => {
                            if (directAccessToken && directRefreshToken) {
                                window.location.href = `${targetDashboardUrl}?accessToken=${directAccessToken}&refreshToken=${directRefreshToken}`;
                            } else {
                                window.location.href = targetDashboardUrl;
                            }
                        }, 1000);
                    },
                    prefill: {
                        name: fullName,
                        email: email,
                        contact: phone,
                    },
                    theme: {
                        color: "#4F46E5", // design-lint-ignore: page-builder default color
                    },
                    modal: {
                        ondismiss: function() {
                            setLoading(false);
                            toast.info(t("checkoutForm.toast.paymentCancelled"));
                        }
                    }
                };

                const rzp = new (window as any).Razorpay(options);
                rzp.open();
            } else if (response.data && (response.data.responseCode === "SUCCESS" || response.data.status === "SUCCESS")) {
                toast.success(t("checkoutForm.toast.checkoutSuccessful"));
                // Clean up credentials storage as we are doing direct redirect with tokens potentially
                localStorage.removeItem("pendingUserEmail");
                localStorage.removeItem("pendingUserPassword");
                localStorage.removeItem("pendingOrderId");
                localStorage.removeItem("pendingAccessToken");
                localStorage.removeItem("pendingRefreshToken");

                if (directAccessToken && directRefreshToken) {
                    window.location.href = `${targetDashboardUrl}?accessToken=${directAccessToken}&refreshToken=${directRefreshToken}`;
                } else {
                    window.location.href = targetDashboardUrl;
                }
            } else {
                console.warn("No Razorpay order details found in response structure:", response.data);
                throw new Error("Unable to initiate Razorpay payment. Order ID missing from backend response.");
            }
        } catch (error: any) {
            console.error("Checkout failed:", error);
            const errorMessage = error.response?.data?.ex || error.response?.data?.message || error.message || t("checkoutForm.toast.checkoutFailedDefault");
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
                <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 w-pct-95 max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-catalogue-lg bg-white p-0 shadow-2xl focus:outline-none overflow-hidden flex flex-col max-h-screen-90">

                    {/* Compact Header */}
                    <div className="bg-primary-600 px-5 py-2 text-white flex justify-between items-center shrink-0">
                        <div>
                            <h2 className="text-lg font-bold">{t("checkoutForm.header.title")}</h2>
                            <p className="text-sm text-black font-medium leading-tight">{t("checkoutForm.header.subtitle")}</p>
                        </div>
                        <button
                            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                            onClick={() => onOpenChange(false)}
                        >
                            <Cross2Icon className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="p-4 space-y-4 overflow-y-auto scrollbar-hide flex-1">
                        {isInitializing ? (
                            <div className="flex flex-col items-center justify-center py-10 space-y-3">
                                <SpinnerGap className="h-8 w-8 text-primary-500 animate-spin" />
                                <p className="text-sm text-gray-500 font-medium">{t("checkoutForm.loading")}</p>
                            </div>
                        ) : (
                            <>
                                {!showFullForm && (
                                    <div className="bg-primary-50 p-3 rounded-catalogue-lg border border-primary-100 flex items-start gap-3 mb-2">
                                        <div className="bg-primary-100 p-2 rounded-full mt-0.5 shrink-0">
                                            <User className="h-4 w-4 text-primary-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate">{fullName}</p>
                                            <p className="text-xs text-gray-500 mt-0.5 truncate">{email}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">+{phone}</p>
                                        </div>
                                    </div>
                                )}

                                {showFullForm && (
                                    <>
                                        {/* Name */}
                                        <div className="space-y-1">
                                            <label className="text-caption font-bold text-gray-900 uppercase flex items-center gap-1.5">
                                                <User className="h-3 w-3" /> {t("checkoutForm.labels.fullName")}
                                            </label>
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        className={`w-full px-3 py-2 bg-gray-50 border rounded-catalogue-md transition-all focus:bg-white focus:ring-2 text-sm font-medium ${nameError ? "border-red-300 focus:ring-red-50" : "border-gray-200 focus:ring-primary-50 focus:border-primary-400"}`}
                                        placeholder={t("checkoutForm.placeholders.name")}
                                    />
                                    {nameError && <p className="text-red-500 text-caption font-semibold">{nameError}</p>}
                                </div>

                                {/* Email */}
                                <div className="space-y-1">
                                    <label className="text-caption font-bold text-gray-900 uppercase flex items-center gap-1.5">
                                        <Envelope className="h-3 w-3" /> {t("checkoutForm.labels.emailAddress")}
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className={`w-full px-3 py-2 bg-gray-50 border rounded-catalogue-md transition-all focus:bg-white focus:ring-2 text-sm font-medium ${emailError ? "border-red-300 focus:ring-red-50" : "border-gray-200 focus:ring-primary-50 focus:border-primary-400"}`}
                                        placeholder={t("checkoutForm.placeholders.email")}
                                    />
                                    {emailError && <p className="text-red-500 text-caption font-semibold">{emailError}</p>}
                                </div>

                                {/* Phone */}
                                <div className="space-y-1">
                                    <label className="text-caption font-bold text-gray-900 uppercase flex items-center gap-1.5">
                                        <Phone className="h-3 w-3" /> {t("checkoutForm.labels.phoneWhatsapp")}
                                    </label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <PhoneInput
                                                country={defaultPhoneCountry}
                                                preferredCountries={preferredCountries}
                                                enableSearch={true}
                                                value={phone}
                                                disabled={isPhoneVerified}
                                                onChange={(value) => {
                                                    setPhone(value);
                                                    if (phoneOtpSent) setPhoneOtpSent(false);
                                                }}
                                                inputClass={`!w-full !px-3 !py-2 !ps-12 !h-10 !bg-gray-50 !border ${phoneError ? "!border-red-300" : "!border-gray-200"} !rounded-catalogue-md !text-sm !font-medium focus:!bg-white focus:!ring-2 focus:!ring-primary-50 ${isPhoneVerified ? "!text-green-700 !bg-green-50/50 !border-green-200" : ""}`}
                                                containerClass="!w-full"
                                                buttonClass={`!rounded-s-catalogue-md !border-gray-200 !bg-gray-50 !w-10 ${isPhoneVerified ? "!bg-green-50/50 !border-green-200" : ""}`}
                                                dropdownClass="!rounded-catalogue-md !shadow-xl"
                                            />
                                            {isPhoneVerified && <CheckCircle className="absolute end-2.5 top-2.5 h-4 w-4 text-green-500 z-10" />}
                                        </div>
                                        {!isPhoneVerified && (
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                layoutVariant="default"
                                                className="h-10 px-3 text-xs font-bold"
                                                onClick={handleSendPhoneOTP}
                                                disabled={isLoadingPhoneOtp || !phone || phoneOtpSent}
                                            >
                                                {isLoadingPhoneOtp ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : phoneOtpSent ? t("checkoutForm.buttons.sent") : t("checkoutForm.buttons.verify")}
                                            </MyButton>
                                        )}
                                    </div>
                                    {phoneError && <p className="text-red-500 text-caption font-semibold ms-1">{phoneError}</p>}

                                    {/* OTP Input for Phone */}
                                    {phoneOtpSent && !isPhoneVerified && (
                                        <div className="flex gap-2 mt-2 animate-in slide-in-from-top-1 duration-200">
                                            <input
                                                ref={otpInputRef}
                                                type="text"
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value)}
                                                className="flex-1 px-3 py-1.5 bg-white border border-primary-300 rounded-catalogue-md text-sm font-bold tracking-wider-2 text-center focus:ring-2 focus:ring-primary-50"
                                                placeholder={t("checkoutForm.placeholders.otp")}
                                                maxLength={6}
                                                autoFocus
                                            />
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                layoutVariant="default"
                                                className="h-9 px-4 text-xs font-bold"
                                                onClick={handleVerifyPhoneOTP}
                                                disabled={isVerifyingPhoneOtp || otp.length < 4}
                                            >
                                                {isVerifyingPhoneOtp ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" /> : t("checkoutForm.buttons.verifyOtp")}
                                            </MyButton>
                                        </div>
                                    )}
                                </div>
                                </>
                                )}

                                {/* Structured address inputs — house no, area, landmark,
                                    pincode (auto-fills state/district/post office via India
                                    Post), city. Concats granular fields into addressLine for
                                    the backend on submit. */}
                                <AddressForm ref={addressFormRef} initial={initialAddressInputs} />

                                {/* Compact Summary */}
                                {additionalCharges.length > 0 ? (
                                    <div className="bg-gray-50 rounded-catalogue-lg p-3 border border-gray-100 space-y-1">
                                        <div className="flex justify-between text-xs text-gray-700">
                                            <span>{t("checkoutForm.summary.subtotalCount", { count: items.length })}</span>
                                            <span className="font-medium">₹{(totalAmount - sumChargeAmounts(additionalCharges)).toFixed(2)}</span>
                                        </div>
                                        {additionalCharges.map((charge) => (
                                            <div key={charge.key} className="flex justify-between text-xs text-gray-700">
                                                <span>{charge.label}</span>
                                                <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                                            <span className="text-caption text-gray-500 font-bold uppercase tracking-tight">{t("checkoutForm.summary.orderTotal")}</span>
                                            <span className="text-base font-black text-primary-600">₹{totalAmount.toFixed(2)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-gray-50 rounded-catalogue-lg p-3 border border-gray-100 flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-caption text-gray-500 font-bold uppercase tracking-tight">{t("checkoutForm.summary.orderTotal")}</span>
                                            <span className="text-base font-black text-primary-600">₹{totalAmount.toFixed(0)}</span>
                                        </div>
                                        <div className="text-end">
                                            <span className="text-caption text-gray-400 font-medium block">{t("checkoutForm.summary.itemsCount", { count: items.length })}</span>
                                            <span className="text-caption text-green-600 font-bold flex items-center justify-end gap-1">
                                                <span className="w-1 h-1 bg-green-500 rounded-full" /> {t("checkoutForm.summary.secure")}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Compact Footer */}
                    <div className="p-4 bg-white border-t border-gray-100 shrink-0">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            layoutVariant="default"
                            className="w-full h-11 text-base font-bold shadow-lg shadow-primary-100 active:scale-[0.98] transition-all rounded-catalogue-md flex items-center justify-center gap-2"
                            onClick={handleCheckout}
                            disabled={loading || isInitializing || !isPhoneVerified}
                        >
                            {loading ? (
                                <SpinnerGap className="animate-spin h-5 w-5" />
                            ) : (
                                <>
                                    <span>{t("checkoutForm.buttons.proceedToPayment")}</span>
                                    <CaretRight className="h-4 w-4" />
                                </>
                            )}
                        </MyButton>
                        {!isPhoneVerified && (
                            <p className="text-center text-caption text-red-400 mt-2 font-bold">{t("checkoutForm.whatsappRequired")}</p>
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};
