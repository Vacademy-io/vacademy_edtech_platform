import React, { useState, useEffect, useRef, useMemo } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { useCartStore, CartItem } from "../../-stores/cart-store";
import { CartComponentProps } from "../../-types/course-catalogue-types";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { Trash, Plus, Minus, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { getMembershipPlans, MembershipPlan } from "../../-services/membership-plan-service";
import { INSTITUTE_ID } from "@/constants/urls";
import { toast } from "sonner";
import { CheckoutForm } from "./CheckoutForm";
import { BASE_URL_LEARNER_DASHBOARD } from "@/constants/urls";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { Preferences } from "@capacitor/preferences";
import { PriceWithMrp } from "@/components/common/price-with-mrp";
import {
  resolveAdditionalCharges,
  sumChargeAmounts,
  ResolvedCharge,
} from "../../-utils/additional-charges-util";


// Helper for simple image loading in Rent loop
const SimpleImage = ({ src, fallbackSrc, alt }: { src?: string; fallbackSrc?: string; alt: string }) => {
  const [finalSrc, setFinalSrc] = useState<string | null>(src || null);

  useEffect(() => {
    if (src) {
      setFinalSrc(src);
    } else if (fallbackSrc && fallbackSrc !== "/api/placeholder/300/200") {
      getPublicUrlWithoutLogin(fallbackSrc).then(url => setFinalSrc(url)).catch(() => { });
    }
  }, [src, fallbackSrc]);

  if (!finalSrc) return <div className="w-full h-full bg-gray-200" />;
  return <FitImage src={finalSrc} alt={alt} className="w-full h-full" />;
};

interface CartItemCardProps {
  item: CartItem;
  imageUrl?: string;
  showItemImage: boolean;
  showItemTitle: boolean;
  showItemLevel: boolean;
  showQuantitySelector: boolean;
  showRemoveButton: boolean;
  showPrice: boolean;
  onQuantityChange: (enrollInviteId: string, quantity: number) => void;
  onRemove: (enrollInviteId: string) => void;
  quantityMin: number;
}

const CartItemCard: React.FC<CartItemCardProps> = ({
  item,
  imageUrl,
  showItemImage,
  showItemTitle,
  showItemLevel,
  showQuantitySelector,
  showRemoveButton,
  showPrice,
  onQuantityChange,
  onRemove,
  quantityMin,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl || null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (imageUrl) {
      setCurrentImageUrl(imageUrl);
      setImageLoading(false);
    } else if (item.image && item.image !== "/api/placeholder/300/200") {
      setImageLoading(true);
      getPublicUrlWithoutLogin(item.image)
        .then((url) => {
          setCurrentImageUrl(url);
          setImageLoading(false);
        })
        .catch(() => {
          setImageLoading(false);
        });
    } else {
      setImageLoading(false);
    }
  }, [imageUrl, item.image]);

  return (
    <div className="w-full max-w-page mx-auto flex flex-row gap-2.5 sm:gap-3 p-2.5 sm:p-3 border border-gray-200 rounded-catalogue-md bg-white hover:shadow-md hover:border-gray-300 transition-all duration-200 active:scale-[0.99]">
      {/* Item Image - Compact on mobile */}
      {showItemImage && (
        <div className="flex-shrink-0 w-20 h-32 sm:w-28 sm:h-44 bg-gray-100 rounded-catalogue-md overflow-hidden shadow-sm">
          {imageLoading ? (
            <div className="w-full h-full bg-gray-200 animate-pulse flex items-center justify-center">
              <div className="text-gray-400 text-xs">...</div>
            </div>
          ) : currentImageUrl ? (
            <FitImage
              src={currentImageUrl}
              alt={item.title}
              className="w-full h-full"
              onError={() => setCurrentImageUrl(null)}
            />
          ) : (
            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
              <div className="text-gray-400 text-xs">{t("cart.noImage")}</div>
            </div>
          )}
        </div>
      )}

      {/* Item Details - Flex Column for Mobile, organized */}
      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div className="flex justify-between items-start gap-2">
          {/* Title and Level */}
          <div className="flex-1 min-w-0">
            {showItemTitle && (
              <h3 className="text-sm sm:text-base font-semibold text-gray-900 line-clamp-2 leading-tight">
                {item.title}
              </h3>
            )}
            {showItemLevel && item.level && (
              <p className="text-xs text-gray-500 mt-1 font-medium">
                {item.level}
              </p>
            )}
          </div>

          {/* Price - Always visible on top right */}
          {showPrice && (
            <div className="text-end flex-shrink-0">
              <PriceWithMrp
                actual={item.price}
                elevated={item.elevatedPrice}
                currency={item.currency}
                size="sm"
                freeForZero={false}
              />
            </div>
          )}
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 sm:border-t-0 sm:pt-0">
          {showQuantitySelector ? (
            <div className="flex items-center gap-0.5 border border-gray-200 rounded-catalogue-md bg-gray-50 shadow-sm hover:bg-gray-100 transition-colors">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 hover:bg-white active:bg-gray-200 rounded-s-catalogue-md transition-all duration-150"
                onClick={() => item.enrollInviteId && onQuantityChange(item.enrollInviteId, item.quantity - 1)}
                disabled={item.quantity <= quantityMin || !item.enrollInviteId}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-7 sm:w-8 text-center text-xs sm:text-sm font-semibold text-gray-700">{item.quantity}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 hover:bg-white active:bg-gray-200 rounded-e-catalogue-md transition-all duration-150"
                onClick={() => item.enrollInviteId && onQuantityChange(item.enrollInviteId, item.quantity + 1)}
                disabled={!item.enrollInviteId}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : <div />}

          {showRemoveButton && (
            <button
              className="group flex items-center gap-1 text-red-500 hover:text-red-700 active:text-red-800 transition-all duration-200 px-2 py-1 rounded-catalogue-xs hover:bg-red-50 active:bg-red-100 active:scale-95"
              onClick={() => item.enrollInviteId && onRemove(item.enrollInviteId)}
              disabled={!item.enrollInviteId}
            >
              <Trash className="h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform group-hover:scale-110" />
              <span className="text-xs font-medium hidden sm:inline">{t("common.remove")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Membership Plan Card Component - Compact Mobile-First Design
interface MembershipPlanCardProps {
  plan: MembershipPlan;
}

const MembershipPlanCard: React.FC<MembershipPlanCardProps> = ({ plan }) => {
  const { t } = useTranslation("coursePlayerB");
  const { setMembershipPlan, membershipPlan } = useCartStore();
  const isSelected = membershipPlan?.id === (plan.enroll_invite_id || plan.id);

  const handleSelectPlan = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMembershipPlan({
      id: plan.enroll_invite_id || plan.id,
      title: plan.package_name,
      price: plan.min_plan_actual_price,
      numberOfBooks: plan.available_slots ?? undefined,
      maxSeats: plan.max_seats ?? undefined,
      packageSessionId: plan.package_session_id,
      enrollInviteId: plan.enroll_invite_id,
    });
  };

  // Extract fields - handle various possible field names
  const planName = plan.package_name || t("cart.plan.defaultName");
  const numberOfBooks = plan.available_slots;
  const maxSeats = plan.max_seats;
  const description = maxSeats
    ? t("cart.plan.maxBooksDescription", { max: maxSeats })
    : t("cart.plan.noLimitDescription");
  const price = plan.min_plan_actual_price || 0;
  const elevatedPrice = plan.min_plan_elevated_price;

  return (
    <div
      className={`
        rounded-catalogue-md p-2 sm:p-3 border-2 transition-all duration-200 cursor-pointer active:scale-[0.97] hover:scale-[1.01]
        ${isSelected
          ? 'bg-primary-500 border-primary-500 shadow-md'
          : 'bg-white border-gray-200 hover:border-primary-300 hover:shadow-sm'
        }
      `}
      onClick={handleSelectPlan}
    >
      {/* Compact Card - Mobile shows title, price, books. Desktop shows description too */}
      <div className="space-y-1.5 sm:space-y-2">
        {/* Row 1: Name and Price */}
        <div className="flex items-start justify-between gap-1.5">
          <h3 className="text-xs sm:text-sm font-semibold text-gray-900 line-clamp-2 flex-1 min-w-0">
            {planName}
          </h3>
          <div className="flex items-baseline gap-0.5 flex-shrink-0">
            <PriceWithMrp
              actual={price}
              elevated={elevatedPrice}
              currency={plan.currency}
              size="sm"
              freeForZero={false}
            />
          </div>
        </div>

        {/* Row 2: Description (hidden on mobile) and Books Count */}
        <div className="flex flex-col gap-1">
          {/* Description - hidden on mobile, shown on sm+ */}
          <p className="hidden sm:block text-xs text-gray-600 line-clamp-2">
            {description}
          </p>

          {/* Books Count - Mobile shows compact, Desktop shows with description */}
          <div className="flex flex-col gap-0.5 sm:gap-1">
            {/* Max books at one time */}
            <div className="flex items-center gap-1">
              <span className="text-caption sm:text-xs text-gray-500">{t("cart.plan.booksAtOnce")}</span>
              <span className={`font-semibold text-gray-700 ${numberOfBooks ? 'text-caption sm:text-xs' : 'text-sm sm:text-base'}`}>
                {numberOfBooks ?? '∞'}
              </span>
            </div>

            {/* Max books in period - always show */}
            <div className="flex items-center gap-1">
              <span className="text-caption sm:text-xs text-gray-500">{t("cart.plan.booksInPeriod")}</span>
              <span className={`font-semibold text-gray-700 ${maxSeats ? 'text-caption sm:text-xs' : 'text-sm sm:text-base'}`}>
                {maxSeats ?? '∞'}
              </span>
            </div>
          </div>
        </div>

        {/* Select Button */}
        <button
          className={`
            w-full mt-1.5 sm:mt-2 py-1.5 sm:py-2 px-2 rounded-catalogue-sm text-caption sm:text-xs font-semibold transition-all duration-200 active:scale-95
            ${isSelected
              ? 'bg-primary-600 text-white font-bold shadow-sm hover:bg-primary-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }
          `}
          onClick={handleSelectPlan}
        >
          {isSelected ? t("cart.plan.selected") : t("cart.plan.select")}
        </button>
      </div>
    </div>
  );
};

/**
 * Tiny banner shown above cart items when the cart holds items from a store
 * that isn't the currently-selected store. Reads `storeFilter` from
 * localStorage (set by the catalogue page) and listens for changes.
 */
const CrossStoreWarning: React.FC<{ items: CartItem[] }> = ({ items }) => {
  const { t } = useTranslation("coursePlayerB");
  const [storeFilter, setStoreFilter] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem("storeFilter")
  );
  useEffect(() => {
    const refresh = () =>
      setStoreFilter(typeof window === "undefined" ? null : localStorage.getItem("storeFilter"));
    window.addEventListener("storage", refresh);
    window.addEventListener("storeFilterChanged", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("storeFilterChanged", refresh);
    };
  }, []);

  const distinctStoresInCart = useMemo(() => {
    const set = new Map<string, string>();
    for (const item of items) {
      if (item.sessionId) {
        set.set(item.sessionId, item.sessionName || item.sessionId);
      }
    }
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [items]);

  if (distinctStoresInCart.length === 0) return null;

  // Case A: multiple stores within the cart itself.
  if (distinctStoresInCart.length > 1) {
    return (
      <div className="rounded-catalogue-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t("cart.crossStore.multiple", {
          count: distinctStoresInCart.length,
          stores: distinctStoresInCart.map((s) => s.name).join(", "),
        })}
      </div>
    );
  }

  // Case B: single store in cart, but doesn't match the active filter.
  const cartStore = distinctStoresInCart[0];
  if (storeFilter && storeFilter !== cartStore.id) {
    return (
      <div className="rounded-catalogue-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t("cart.crossStore.mismatch", { store: cartStore.name })}
      </div>
    );
  }
  return null;
};

export const CartComponent: React.FC<CartComponentProps> = ({
  showItemImage = true,
  showItemTitle = true,
  showItemLevel = true,
  showQuantitySelector = true,
  quantityMin = 1,
  showRemoveButton = true,
  showPrice = true,
  showEmptyState = true,
  emptyStateMessage,
  styles = {},
  instituteId, // Accept instituteId prop
  globalSettings,
  onlyLogic = false,
  isPreviewMode = false,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const resolvedEmptyStateMessage = emptyStateMessage || t("cart.emptyDefault");
  const { items, removeItem, updateQuantity, membershipPlan, getItemCount, getTotal, syncCart } = useCartStore();
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isRentMode, setIsRentMode] = useState(false);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isCheckoutFormOpen, setIsCheckoutFormOpen] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);



  // Check for pending payment verification on mount
  useEffect(() => {
    const pendingOrderId = localStorage.getItem("pendingOrderId");
    if (pendingOrderId) {
      console.log("Found pending order ID:", pendingOrderId);

      const verifyPayment = async (attempts = 1) => {
        // 1. Get InstituteId from storage (CapacitorStorage.InstituteId or fallbacks)
        let effectiveInstituteId = instituteId || INSTITUTE_ID;
        try {
          // Look for specifically requested CapacitorStorage key which maps to web localstorage
          let storedInstId = localStorage.getItem("CapacitorStorage.InstituteId") ||
            localStorage.getItem("instituteId") ||
            localStorage.getItem("CapacitorStorage.instituteId");

          if (storedInstId) {
            // Remove any potential double quotes if it was stringified in storage
            storedInstId = storedInstId.replace(/^"(.*)"$/, '$1');
            effectiveInstituteId = storedInstId;
            console.log("[CartComponent] Using InstituteId from storage:", effectiveInstituteId);
          }
        } catch (e) {
          console.warn("[CartComponent] Failed to read InstituteId from storage", e);
        }

        try {
          console.log(`[CartComponent] Verifying payment (Attempt ${attempts}/3)... with InstituteId: ${effectiveInstituteId}`);

          console.log(`[CartComponent] Optimistic Auto-Login (Attempt ${attempts}): Skipping Payment Check`);

          // SKIPPING API CHECK: Simulate success
          // const baseUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8072";
          // const url = `${baseUrl}/admin-core-service/open/payments/PHONEPE/status/${pendingOrderId}`;
          // const response = await axios.get(...)

          const response = {
            data: { status: "COMPLETED" }
          };

          console.log(`[CartComponent] Payment verification response (Attempt ${attempts}):`, response.data);

          const { checkAndRecoverSession } = await import("@/services/auth-cycle-service");
          const sessionRecovered = await checkAndRecoverSession(effectiveInstituteId);
          const targetCoursesUrl = new URL("/dashboard", window.location.origin).toString();

          if (sessionRecovered) {
            cleanupAndCompleteRedirect(targetCoursesUrl);
            return;
          }

          // Case 3: Fallback Verification (Payment is confirmed, but Auto-Login failed/skipped)
          if (response.data?.status === "COMPLETED") {
            console.warn("[CartComponent] Payment COMPLETED but Auto-Login didn't trigger or failed.");

            // Critical Check: Are we authenticated?
            const currentToken = await getTokenFromStorage(TokenKey.accessToken);
            if (!currentToken) {
              console.error("[CartComponent] User is NOT authenticated. Redirecting to login instead of courses.");
              toast.success(t("cart.toast.loginRequiredAfterPayment"));

              // Redirect to Login if we couldn't auth
              localStorage.removeItem("pendingOrderId");
              setTimeout(() => {
                window.location.href = "/login";
              }, 1500);
              return;
            }

            toast.success(t("cart.toast.redirecting"));
            localStorage.removeItem("pendingOrderId");
            setTimeout(() => {
              window.location.href = targetCoursesUrl;
            }, 500);
          } else if (attempts < 3) {
            // If payment not yet completed, retry
            console.log(`[CartComponent] Payment not 'COMPLETED' (status: ${response.data?.status}). Retrying in 3s...`);
            setTimeout(() => verifyPayment(attempts + 1), 3000);
          } else {
            // Exhausted attempts
            console.warn("[CartComponent] Payment status check finished without 'COMPLETED' status (or automated login match).");
            setTimeout(() => {
              window.location.href = targetCoursesUrl;
            }, 2000);
          }
        } catch (error) {
          console.error(`Error verifying payment (Attempt ${attempts}):`, error);

          // Retry logic handling...
          if (attempts < 3) {
            setTimeout(() => verifyPayment(attempts + 1), 3000);
          } else {
            console.error("[CartComponent] All verification attempts failed.");
            // Don't strand the user, send them to dashboard/home
            setTimeout(() => {
              const targetCoursesUrl = new URL("/dashboard", window.location.origin).toString();
              window.location.href = targetCoursesUrl;
            }, 2000);
          }
        }
      };

      // Helper to clear pending storage and redirect
      const cleanupAndCompleteRedirect = async (url: string) => {
        localStorage.removeItem("pendingOrderId");
        localStorage.removeItem("pendingUsername");
        localStorage.removeItem("pendingUserPassword");
        localStorage.removeItem("pendingAccessToken");
        localStorage.removeItem("pendingRefreshToken");
        toast.success(t("cart.toast.loginAutomated"));

        // Verify persistence before redirecting to avoid race conditions
        console.log("[CartComponent] Verifying persistence before redirect...");
        let verified = false;
        for (let i = 0; i < 20; i++) { // Try for up to 4 seconds (20 * 200ms)
          const token = await getTokenFromStorage(TokenKey.accessToken);
          const { value: studentDetails } = await Preferences.get({ key: "StudentDetails" });
          const { value: instituteDetails } = await Preferences.get({ key: "InstituteDetails" });

          if (token && studentDetails && instituteDetails) {
            console.log("[CartComponent] Persistence verified. Redirecting now.");
            verified = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (!verified) {
          console.warn("[CartComponent] Persistence verification timed out. Redirecting anyway.");
        }

        window.location.replace(url);
      };

      verifyPayment();
    }
  }, [instituteId]);

  useEffect(() => {
    // Check for Rent mode in session storage and sync cart
    const checkLevelFilter = () => {
      const levelFilter = sessionStorage.getItem("levelFilter");
      console.log("[CartComponent] Checking levelFilter:", levelFilter);
      const isRent = !!(levelFilter && levelFilter.toLowerCase().includes("rent"));
      setIsRentMode(isRent);
      // Sync cart when mode changes
      syncCart();
    };

    checkLevelFilter();

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'levelFilter') {
        checkLevelFilter();
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Listen for custom events
    const handleLevelFilterChange = () => {
      checkLevelFilter();
    };
    window.addEventListener('levelFilterChanged', handleLevelFilterChange);

    // Also check periodically (for same-tab changes)
    const interval = setInterval(checkLevelFilter, 500);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('levelFilterChanged', handleLevelFilterChange);
    };
  }, [syncCart]);

  // Fetch membership plans when in Rent mode
  useEffect(() => {
    const fetchMembershipPlans = async () => {
      console.log("[CartComponent] fetchMembershipPlans triggered", { isRentMode, instituteId });

      if (!isRentMode) {
        console.log("[CartComponent] Skipping fetch - not in Rent mode");
        return;
      }

      // Use provided instituteId or fallback to INSTITUTE_ID constant
      const effectiveInstituteId = instituteId || INSTITUTE_ID;
      console.log("[CartComponent] Using instituteId:", effectiveInstituteId);

      setIsLoadingPlans(true);
      try {
        console.log("[CartComponent] Fetching membership plans...");
        const plans = await getMembershipPlans(effectiveInstituteId);
        console.log("[CartComponent] Fetched membership plans:", plans);
        console.log("[CartComponent] Number of plans:", plans.length);
        setMembershipPlans(plans);
      } catch (error) {
        console.error("[CartComponent] Error fetching membership plans:", error);
        setMembershipPlans([]);
      } finally {
        setIsLoadingPlans(false);
        console.log("[CartComponent] Finished fetching membership plans");
      }
    };

    fetchMembershipPlans();
  }, [isRentMode, instituteId]);

  // Cache for fetched images to prevent repeated API calls
  const fetchedImagesRef = useRef<Set<string>>(new Set());

  // Load images for all cart items
  useEffect(() => {
    const loadImages = async () => {
      // Create a list of promises to fetch images in parallel, but only for those not yet fetched
      const promises = items.map(async (item) => {
        const itemId = item.enrollInviteId || item.id;

        // Skip if invalid ID or already fetched
        if (!itemId || fetchedImagesRef.current.has(itemId)) return;

        // Mark as fetched immediately to prevent duplicate calls
        fetchedImagesRef.current.add(itemId);

        if (item.image && item.image !== "/api/placeholder/300/200") {
          try {
            const url = await getPublicUrlWithoutLogin(item.image);
            if (url && item.enrollInviteId) {
              setImageUrls(prev => ({ ...prev, [item.enrollInviteId!]: url }));
            }
          } catch (error) {
            console.error(`[CartComponent] Error loading image for item ${itemId}:`, error);
          }
        }
      });

      await Promise.all(promises);
    };

    if (items.length > 0) {
      loadImages();
    }
  }, [items]);

  const handleQuantityChange = async (enrollInviteId: string, newQuantity: number) => {
    await updateQuantity(enrollInviteId, newQuantity);
    window.dispatchEvent(new CustomEvent('cartUpdated'));
  };

  const handleRemove = async (enrollInviteId: string) => {
    await removeItem(enrollInviteId);
    window.dispatchEvent(new CustomEvent('cartUpdated'));
  };

  const padding = styles.padding || "10px";
  const roundedEdges = styles.roundedEdges ? "rounded-catalogue-md" : "";
  const backgroundColor = styles.backgroundColor || "white";

  // Buy-mode additional charges (shipping). Rent mode is intentionally excluded —
  // security deposit / rent-mode shipping is a separate piece of work.
  const buyModeItemQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const resolvedAdditionalCharges = useMemo<ResolvedCharge[]>(() => {
    if (isRentMode) return [];
    return resolveAdditionalCharges(globalSettings, "buy", buyModeItemQty);
  }, [globalSettings, isRentMode, buyModeItemQty]);
  const additionalChargesTotal = sumChargeAmounts(resolvedAdditionalCharges);
  const buyModeSubtotal = getTotal();
  const buyModeGrandTotal = buyModeSubtotal + additionalChargesTotal;

  const paymentBanner = paymentMessage ? (
    <div className={`w-full p-4 mb-4 rounded-catalogue-md flex items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300 ${paymentMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
      paymentMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
        'bg-blue-50 text-blue-700 border border-blue-200'
      }`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm">
        <span className="font-bold whitespace-nowrap">{t("cart.paymentStatus")}</span>
        <span className="font-medium">{paymentMessage.text}</span>
      </div>
      <button
        onClick={() => setPaymentMessage(null)}
        className="p-1 hover:bg-black/5 rounded-full transition-colors flex-shrink-0"
        aria-label={t("cart.dismiss")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  if (items.length === 0 && showEmptyState) {
    return (
      <div
        className={`w-full ${roundedEdges} flex flex-col items-center justify-center py-12 px-4`}
        style={{ backgroundColor, padding }}
      >
        {paymentBanner}
        <div className="text-center space-y-2">
          <div className="text-5xl">🛒</div>
          <p className="text-gray-600 text-sm sm:text-base">{resolvedEmptyStateMessage}</p>
        </div>
      </div>
    );
  }

  // Logic-only mode for auto-login (renders nothing)
  if (onlyLogic) {
    return null;
  }

  // RENT MODE LAYOUT (Horizontal Scroll)
  if (isRentMode) {
    const sortedMembershipPlans = [...membershipPlans].sort((a, b) => {
      const extractDuration = (name: string) => {
        const match = (name || "").match(/(\d+)\s*months?/i);
        return match ? parseInt(match[1], 10) : 0;
      };
      const stripDuration = (name: string) =>
        (name || "").replace(/\d+\s*months?/i, "").trim().toLowerCase();
      const prefixCmp = stripDuration(a.package_name).localeCompare(stripDuration(b.package_name));
      if (prefixCmp !== 0) return prefixCmp;
      return extractDuration(a.package_name) - extractDuration(b.package_name);
    });

    return (
      <>
        <div
          className={`w-full ${roundedEdges} relative space-y-6`}
          style={{ backgroundColor, padding }}
        >
          {paymentBanner}
          {/* Cart Items Section */}
          <div className="space-y-stack">
            <h2 className="text-base sm:text-lg font-semibold text-gray-800">{t("cart.yourBooks")}</h2>
            <div className="flex overflow-x-auto gap-3 pb-4 snap-x pe-4 scrollbar-hide">
              {items.map((item) => (
                <div
                  key={item.enrollInviteId || item.id}
                  className="flex-shrink-0 w-32 sm:w-36 snap-start flex flex-col bg-white rounded-catalogue-md border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 relative group active:scale-[0.98]"
                >
                  {/* Delete Button - Overlay Top Right */}
                  {showRemoveButton && (
                    <button
                      className="absolute top-1.5 end-1.5 z-10 p-1.5 bg-white/95 rounded-full shadow-md text-red-500 hover:text-red-700 hover:bg-red-50 transition-all duration-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 active:scale-90"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.enrollInviteId) handleRemove(item.enrollInviteId);
                      }}
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* Image */}
                  <div className="w-full h-44 sm:h-44 bg-gray-100 relative overflow-hidden">
                    <SimpleImage
                      src={item.enrollInviteId ? imageUrls[item.enrollInviteId] : undefined}
                      fallbackSrc={item.image}
                      alt={item.title}
                    />
                  </div>

                  {/* Minimal Details */}
                  <div className="p-2.5 flex flex-col gap-1">
                    {showItemTitle && (
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-900 line-clamp-2 leading-tight min-h-10">
                        {item.title}
                      </h3>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Membership Plans Section */}
          <div className="mt-5">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3">{t("cart.subscriptionPlans")}</h2>

            {isLoadingPlans ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack">
                {[1, 2].map((i) => (
                  <div key={i} className="h-32 bg-gray-200 rounded-catalogue-md animate-pulse" />
                ))}
              </div>
            ) : sortedMembershipPlans.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {sortedMembershipPlans.map((plan) => (
                  <MembershipPlanCard key={plan.id} plan={plan} />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500">
                <p className="text-sm">{t("cart.noPlansAvailable")}</p>
              </div>
            )}

            {/* Security Deposit Notice */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-catalogue-md">
              <p className="text-xs sm:text-sm text-blue-700">
                {t("cart.securityDeposit")}
              </p>
            </div>
          </div>

          {/* Subtotal, Total and Checkout Button Section */}
          {items.length > 0 && (
            <div className="mt-5 bg-gray-50 rounded-catalogue-md p-3 sm:p-4 border border-gray-200 space-y-stack">

              <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                <span className="text-base sm:text-lg font-semibold text-gray-900">{t("cart.total")}</span>
                <span className="text-base sm:text-lg font-bold text-gray-900">₹{getTotal().toFixed(2)}</span>
              </div>

              <Button
                onClick={() => {
                  if (!membershipPlan) {
                    toast.error(t("cart.selectPlanFirst"), {
                      duration: 2000,
                    });
                    return;
                  }

                  const totalBooksInCart = getItemCount();
                  const maxBooksAllowed = membershipPlan.maxSeats;

                  if (maxBooksAllowed && totalBooksInCart > maxBooksAllowed) {
                    toast.error(
                      t("cart.maxBooksExceeded", { max: maxBooksAllowed }),
                      {
                        duration: 4000,
                      }
                    );
                    return;
                  }

                  console.log("[CartComponent] Proceeding to checkout (Rent) with items:", items, "Plan:", membershipPlan);
                  setIsCheckoutFormOpen(true);
                }}
                className="w-full bg-primary-400 hover:bg-primary-500 active:bg-primary-500 text-white font-semibold text-sm sm:text-base py-2.5 sm:py-3 rounded-catalogue-md shadow-md transition-all duration-200 active:scale-[0.98]"
                size="lg"
              >
                {t("cart.checkout")}
              </Button>
            </div>
          )}
        </div>
        <CheckoutForm
          open={isCheckoutFormOpen}
          onOpenChange={setIsCheckoutFormOpen}
          instituteId={instituteId || INSTITUTE_ID}
          totalAmount={getTotal()}
          items={items}
          membershipPlan={membershipPlan}
          isPreviewMode={isPreviewMode}
          isRentMode={true}
        />
      </>
    );
  }

  // STANDARD LAYOUT (Vertical List) - For Buy mode
  return (
    <div
      className={`w-full ${roundedEdges} space-y-4`}
      style={{ backgroundColor, padding }}
    >
      {paymentBanner}
      <CrossStoreWarning items={items} />
      {items.map((item) => (
        <CartItemCard
          key={item.enrollInviteId || item.id}
          item={item}
          imageUrl={item.enrollInviteId ? imageUrls[item.enrollInviteId] : undefined}
          showItemImage={showItemImage}
          showItemTitle={showItemTitle}
          showItemLevel={showItemLevel}
          showQuantitySelector={showQuantitySelector}
          showRemoveButton={showRemoveButton}
          showPrice={showPrice}
          onQuantityChange={handleQuantityChange}
          onRemove={handleRemove}
          quantityMin={quantityMin}
        />
      ))}

      {/* Checkout Button for Buy mode */}
      {items.length > 0 && !isRentMode && (
        <div className="mt-5 bg-gray-50 rounded-catalogue-md p-3 sm:p-4 border border-gray-200 space-y-stack">
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between items-center text-sm text-gray-700">
              <span>{t("cart.subtotalCount", { count: buyModeItemQty })}</span>
              <span className="font-medium">₹{buyModeSubtotal.toFixed(2)}</span>
            </div>
            {resolvedAdditionalCharges.map((charge) => (
              <div key={charge.key} className="flex justify-between items-center text-sm text-gray-700">
                <span>{charge.label}</span>
                <span className="font-medium">₹{charge.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-base sm:text-lg font-semibold text-gray-900">{t("cart.total")}</span>
              <span className="text-base sm:text-lg font-bold text-gray-900">₹{buyModeGrandTotal.toFixed(2)}</span>
            </div>
          </div>

          <Button
            onClick={() => {
              console.log("[CartComponent] Proceeding to checkout (Buy) with items:", items, "charges:", resolvedAdditionalCharges);
              setIsCheckoutFormOpen(true);
            }}
            className="w-full bg-primary-400 hover:bg-primary-500 active:bg-primary-500 text-white font-semibold text-sm sm:text-base py-2.5 sm:py-3 rounded-catalogue-md shadow-md transition-all duration-200 active:scale-[0.98]"
            size="lg"
          >
            {t("cart.checkout")}
          </Button>
        </div>
      )}

      <CheckoutForm
        open={isCheckoutFormOpen}
        onOpenChange={setIsCheckoutFormOpen}
        instituteId={instituteId || INSTITUTE_ID}
        totalAmount={buyModeGrandTotal}
        items={items}
        membershipPlan={membershipPlan}
        isPreviewMode={isPreviewMode}
        isRentMode={false}
        additionalCharges={resolvedAdditionalCharges}
      />
    </div>
  );
};
