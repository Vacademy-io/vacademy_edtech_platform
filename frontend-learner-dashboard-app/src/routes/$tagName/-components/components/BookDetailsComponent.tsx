import React, { useState, useEffect } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useTranslation } from "react-i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { User, ShoppingCart, Plus, Minus, ShoppingBag, CheckCircle } from "@phosphor-icons/react";
import { useCartStore } from "../../-stores/cart-store";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { ShareButton } from "./ShareButton";
import { PriceWithMrp } from "@/components/common/price-with-mrp";

interface BookDetailsProps {
    fields?: {
        title: string;
        description: string;
        whyLearn: string;
        whoShouldLearn: string;
        duration: string;
        level: string;
        tags: string;
        previewImage: string;
        banner: string;
        rating: string;
        price: string;
        cover?: string;
    };
    showEnquiry?: boolean;
    showPayment?: boolean;
    showAddToCart?: boolean;
    courseData?: any; // The real data fetched from CourseDetailsPage
    instituteId?: string;
}

export const BookDetailsComponent: React.FC<BookDetailsProps> = ({
    courseData,
    instituteId = "",
}) => {
    // If courseData is missing, we can't do much (it usually comes from the parent page fetching it)
    if (!courseData) return null;

    const { t } = useTranslation("coursePlayerB");
    const [coverUrl, setCoverUrl] = useState("");
    const navigate = useNavigate();
    const { addItem, getItemByEnrollInviteId, updateQuantity, getCartMode, syncCart } = useCartStore();

    // Get current cart mode
    const [cartMode, setCartMode] = useState<'buy' | 'rent'>(() => getCartMode());

    // Sync cart when levelFilter changes
    useEffect(() => {
        const checkLevelFilter = () => {
            const levelFilter = sessionStorage.getItem('levelFilter') || '';
            const newMode = levelFilter.toLowerCase().includes('rent') ? 'rent' : 'buy';
            if (newMode !== cartMode) {
                setCartMode(newMode);
                syncCart();
            }
        };

        checkLevelFilter();
        const interval = setInterval(checkLevelFilter, 500);

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'levelFilter') {
                checkLevelFilter();
            }
        };
        window.addEventListener('storage', handleStorageChange);

        const handleLevelFilterChange = () => {
            checkLevelFilter();
        };
        window.addEventListener('levelFilterChanged', handleLevelFilterChange);

        return () => {
            clearInterval(interval);
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('levelFilterChanged', handleLevelFilterChange);
        };
    }, [cartMode, syncCart]);

    // Use the cover field from props if available, otherwise fall back to previewImage or thumbnail
    const coverMediaId = courseData.course_banner_media_id;

    useEffect(() => {
        let mounted = true;
        if (coverMediaId && coverMediaId.trim() !== "") {
            getPublicUrlWithoutLogin(coverMediaId)
                .then(url => {
                    if (mounted) {
                        if (url) setCoverUrl(url);
                        else setCoverUrl("/api/placeholder/300/400");
                    }
                })
                .catch(() => {
                    if (mounted) setCoverUrl("/api/placeholder/300/400");
                });
        } else {
            setCoverUrl("/api/placeholder/300/400");
        }
        return () => {
            mounted = false;
        };
    }, [coverMediaId]);

    // Helper function to extract text from HTML
    const extractTextFromHtml = (htmlString: string | undefined | null): string => {
        if (!htmlString) return "";
        return htmlString
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
    };

    // Get author name from course_html_description_html (extract text from HTML)
    const authorName = extractTextFromHtml(courseData.course_html_description_html) || t("bookDetails.unknownAuthor");

    // Get about book content from about_the_course_html
    const aboutBook = courseData.about_the_course_html || "";

    // Parse comma-separated tags from comma_separeted_tags
    const parseCommaSeparatedTags = (tagsString: string | undefined | null): string[] => {
        if (!tagsString) return [];
        return tagsString
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
    };

    // Get tags from comma_separeted_tags or fallback to tags array
    const tags = courseData.comma_separeted_tags
        ? parseCommaSeparatedTags(courseData.comma_separeted_tags)
        : (courseData.tags || []);

    return (
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 pt-20 pb-8">
            {/* Mobile-First Layout */}
            <div className="flex flex-col md:flex-row md:gap-6 lg:gap-8">
                {/* Book Image Section - Larger on Mobile */}
                <div className="w-full md:w-2/5 lg:w-1/3 mb-4 md:mb-0">
                    <div className="md:sticky md:top-24">
                        <div className="relative aspect-[9/16] w-full max-w-reg-280 mx-auto md:max-w-none rounded-catalogue-lg overflow-hidden shadow-2xl bg-gray-100 transition-transform duration-300 hover:shadow-3xl">
                            {/* Stock Indicator Overlay */}
                            {courseData.available_slots !== undefined && (
                                <div className="absolute top-2 start-2 z-20 px-3 py-1.5 rounded-catalogue-md text-xs font-bold bg-white/90 backdrop-blur-sm shadow-sm flex items-center gap-2 border border-white/20">
                                    {courseData.available_slots > 5 ? (
                                        <>
                                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-glow-live-green" />
                                            <span className="text-green-700 uppercase tracking-wider">{t("common.inStock")}</span>
                                        </>
                                    ) : courseData.available_slots > 0 ? (
                                        <>
                                            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-glow-live-orange" />
                                            <span className="text-orange-700 uppercase tracking-wider">{t("common.onlyLeft", { count: courseData.available_slots })}</span>
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-2 h-2 rounded-full bg-gray-400" />
                                            <span className="text-gray-600 uppercase tracking-wider">{t("common.outOfStock")}</span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Share Button - top-right corner */}
                            {courseData.packageSessionId && (
                                <div className="absolute top-2 end-2 z-20">
                                    <ShareButton
                                        packageSessionId={courseData.packageSessionId}
                                        destinationUrl={window.location.href}
                                        instituteId={instituteId}
                                        title={courseData.title}
                                        size="md"
                                    />
                                </div>
                            )}

                            {coverUrl ? (
                                <FitImage
                                    src={coverUrl}
                                    alt={courseData.title || t("bookDetails.bookAltFallback")}
                                    className="w-full h-full transition-transform duration-300 hover:scale-[1.02]"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">{t("bookDetails.loadingCover")}</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Details Section */}
                <div className="flex-1 space-y-4 md:space-y-5">
                    {/* Book Title with Mode Indicator */}
                    <div>
                        <div className="flex items-start gap-2 mb-3">
                            <h1 className="text-xl sm:text-2xl md:text-2xl font-semibold text-gray-900 leading-snug">
                                {courseData.title}
                            </h1>
                            <span className={`px-2 py-1 rounded-catalogue-xs text-xs font-semibold whitespace-nowrap mt-1 ${
                              cartMode === 'rent'
                                ? 'text-blue-600 bg-blue-50'
                                : 'text-green-600 bg-green-50'
                            }`}>
                              [{cartMode === 'rent' ? t("bookDetails.modeTag.rent") : t("bookDetails.modeTag.buy")}]
                            </span>
                        </div>
                    </div>

                    {/* Author Name */}
                    <div className="flex items-center gap-2 text-gray-700 pb-2 border-b border-gray-200">
                        <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
                        <span className="text-sm sm:text-base font-medium">{authorName}</span>
                    </div>

                    {/* Tags Section */}
                    {tags && tags.length > 0 && (
                        <div className="pb-3 border-b border-gray-200">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs sm:text-sm font-medium text-gray-600">{t("bookDetails.genre")}</span>
                                {tags.map((tag: string, index: number) => (
                                    <span
                                        key={index}
                                        className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-full transition-colors duration-200 cursor-default"
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Price / Add to Cart Section */}
                    <div className="p-4 sm:p-5">
                        {/* Show Price for Buy mode */}
                        {cartMode === 'buy' && (
                            <div className="mb-4 pb-3 border-b border-gray-200 space-y-1">
                                <p className="text-sm text-gray-500">{t("bookDetails.price")}</p>
                                <PriceWithMrp
                                    actual={courseData.price}
                                    elevated={courseData.elevatedPrice}
                                    currency={courseData.currency}
                                    size="xl"
                                />
                            </div>
                        )}

                        {/* Add to Cart Button or Counter */}
                        {(() => {
                            const existingItem = courseData.enrollInviteId ? getItemByEnrollInviteId(courseData.enrollInviteId) : null;
                            const isBuyMode = cartMode === 'buy';

                            // Show counter for Buy mode if item exists
                            if (isBuyMode && existingItem) {
                                return (
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1 border border-gray-200 rounded-catalogue-md bg-gray-50 shadow-sm hover:bg-gray-100 transition-colors">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 hover:bg-white active:bg-gray-200 rounded-s-catalogue-md transition-all duration-150"
                                                onClick={async () => {
                                                    if (courseData.enrollInviteId) {
                                                        await updateQuantity(courseData.enrollInviteId, existingItem.quantity - 1);
                                                        window.dispatchEvent(new CustomEvent('cartUpdated'));
                                                    }
                                                }}
                                                disabled={!courseData.enrollInviteId}
                                            >
                                                <Minus className="h-4 w-4" />
                                            </Button>
                                            <span className="w-10 text-center text-sm font-semibold text-gray-700">{existingItem.quantity}</span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 hover:bg-white active:bg-gray-200 rounded-e-catalogue-md transition-all duration-150"
                                                onClick={async () => {
                                                    if (courseData.enrollInviteId) {
                                                        await updateQuantity(courseData.enrollInviteId, existingItem.quantity + 1);
                                                        window.dispatchEvent(new CustomEvent('cartUpdated'));
                                                    }
                                                }}
                                                disabled={!courseData.enrollInviteId || courseData.available_slots === 0}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        {/* Go to Cart button */}
                                        <Button
                                            className="bg-primary-400 hover:bg-primary-500 text-white font-semibold text-sm py-2 px-4 rounded-catalogue-md shadow-md flex items-center gap-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                            onClick={() => {
                                                const pathTag = window.location.pathname.split('/').filter(Boolean)[0] || 'collections';
                                                navigate({ to: `/${pathTag}/cart` });
                                            }}
                                        >
                                            <ShoppingBag className="h-4 w-4" />
                                            {t("bookDetails.goToCart")}
                                        </Button>
                                    </div>
                                );
                            }

                            // Show "Added" + "Go to Cart" for Rent mode if item exists
                            if (!isBuyMode && existingItem) {
                                return (
                                    <div className="flex items-center gap-3">
                                        <Button
                                            disabled
                                            className="flex-1 bg-green-100 text-green-700 font-semibold text-sm py-2.5 px-6 rounded-catalogue-md border border-green-200 flex items-center justify-center gap-2 shadow-sm"
                                        >
                                            <CheckCircle className="h-4 w-4" />
                                            {t("bookDetails.added")}
                                        </Button>
                                        {/* Go to Cart button */}
                                        <Button
                                            className="bg-primary-400 hover:bg-primary-500 text-white font-semibold text-sm py-2.5 px-4 rounded-catalogue-md shadow-md flex items-center gap-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                            onClick={() => {
                                                const pathTag = window.location.pathname.split('/').filter(Boolean)[0] || 'collections';
                                                navigate({ to: `/${pathTag}/cart` });
                                            }}
                                        >
                                            <ShoppingBag className="h-4 w-4" />
                                            {t("bookDetails.goToCart")}
                                        </Button>
                                    </div>
                                );
                            }

                            // Show Add to Cart button
                            return (
                                <Button
                                    className="w-min-[40px] sm:w-auto bg-primary-400 hover:bg-primary-500 active:bg-primary-500 text-white font-semibold text-sm sm:text-base py-2.5 px-6 rounded-catalogue-md shadow-md transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                                    onClick={async () => {
                                        if (courseData.enrollInviteId) {
                                            await addItem({
                                                id: courseData.courseId || courseData.id,
                                                title: courseData.title,
                                                price: courseData.price,
                                                elevatedPrice: courseData.elevatedPrice,
                                                currency: courseData.currency,
                                                image: coverUrl,
                                                level: courseData.level_name,
                                                packageSessionId: courseData.packageSessionId,
                                                enrollInviteId: courseData.enrollInviteId,
                                                levelId: courseData.levelId,
                                                sessionId: courseData.sessionId || courseData.session_id,
                                                sessionName: courseData.sessionName || courseData.session_name,
                                                courseId: courseData.courseId
                                            });
                                            // Dispatch event to update cart count in header
                                            window.dispatchEvent(new CustomEvent('cartUpdated'));
                                            toast.success(t("bookDetails.toast.addedToCart"), { duration: 2000 });
                                        } else {
                                            toast.error(t("bookDetails.toast.missingEnrollInfo"), { duration: 2000 });
                                        }
                                    }}
                                    disabled={!courseData.enrollInviteId || courseData.available_slots === 0}
                                >
                                    <ShoppingCart className="h-4 w-4" />
                                    {courseData.available_slots === 0 ? t("common.outOfStock") : t("common.addToCart")}
                                </Button>
                            );
                        })()}
                    </div>

                    {/* About Book Section */}
                    <div className="pt-2 space-y-stack">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900 pb-2 border-b border-gray-200">
                            {t("bookDetails.aboutThisBook")}
                        </h3>
                        <div
                            className="prose prose-sm sm:prose-base max-w-none text-gray-700 leading-relaxed text-sm sm:text-base"
                            style={{
                                fontSize: '0.875rem',
                                lineHeight: '1.625rem'
                            }}
                            dangerouslySetInnerHTML={{ __html: aboutBook }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
