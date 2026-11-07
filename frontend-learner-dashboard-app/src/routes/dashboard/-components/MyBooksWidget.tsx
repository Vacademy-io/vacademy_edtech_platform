import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getInstituteId } from "@/constants/helper";
import { BASE_URL, urlPublicCourseDetails } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { cn } from "@/lib/utils";
import { BookOpen, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconBooks from "@/assets/cleaner-play/icon-books.webp";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

interface MyBooksWidgetProps {
    className?: string;
}

interface BookPackage {
    id?: string;
    package_name?: string;
    instructors?: { full_name?: string }[];
}

const PAGE_SIZE = 10;

export const MyBooksWidget: React.FC<MyBooksWidgetProps> = ({ className }) => {
    const { t } = useTranslation("dashboard");
    const [initialLoading, setInitialLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    const [books, setBooks] = useState<BookPackage[]>([]);
    const [activeTab, setActiveTab] = useState("purchased");
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [totalBooks, setTotalBooks] = useState(0);
    const [levelIdMap, setLevelIdMap] = useState<Record<string, string>>({});
    // Whether the learner has any books at all (across both tabs). When false
    // and settled, the widget renders nothing instead of an empty shell.
    const [hasAnyBooks, setHasAnyBooks] = useState(false);

    const fetchBooks = useCallback(
        async (levelId: string | undefined, pageNo: number): Promise<number> => {
            try {
                setLoading(true);
                const instituteId = await getInstituteId();
                const response = await authenticatedAxiosInstance.post(
                    urlPublicCourseDetails,
                    {
                        status: [],
                        level_ids: levelId ? [levelId] : [],
                        faculty_ids: [],
                        search_by_name: "",
                        tag: [],
                        package_types: ["COURSE"],
                        min_percentage_completed: 0,
                        max_percentage_completed: 0,
                        type: "PROGRESS",
                        sort_columns: { createdAt: "DESC" },
                    },
                    {
                        params: { instituteId, page: pageNo, size: PAGE_SIZE },
                    }
                );

                const total = response.data?.totalElements || 0;
                setBooks(response.data?.content || []);
                setTotalPages(response.data?.totalPages || 0);
                setTotalBooks(total);
                if (total > 0) setHasAnyBooks(true);
                return total;
            } catch {
                // Silently skip
                return 0;
            } finally {
                setLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        const init = async () => {
            try {
                const instituteId = await getInstituteId();
                const levelsResponse = await authenticatedAxiosInstance.get(
                    `${BASE_URL}/admin-core-service/level/v1/get-levels`,
                    { params: { instituteId } }
                );
                const levels: { id: string; level_name: string }[] = levelsResponse.data || [];
                const map: Record<string, string> = {};
                for (const level of levels) {
                    const name = (level.level_name || "").trim().toLowerCase();
                    if (name === "buy" || name === "rent") {
                        map[name] = level.id;
                    }
                }
                setLevelIdMap(map);
                const purchasedCount = await fetchBooks(map["buy"], 0);
                // Purchased tab is empty — probe the rented level so we only
                // hide the widget when BOTH tabs are genuinely empty.
                if (purchasedCount === 0 && map["rent"]) {
                    try {
                        const rentProbe = await authenticatedAxiosInstance.post(
                            urlPublicCourseDetails,
                            {
                                status: [],
                                level_ids: [map["rent"]],
                                faculty_ids: [],
                                search_by_name: "",
                                tag: [],
                                package_types: ["COURSE"],
                                min_percentage_completed: 0,
                                max_percentage_completed: 0,
                                type: "PROGRESS",
                                sort_columns: { createdAt: "DESC" },
                            },
                            { params: { instituteId, page: 0, size: 1 } }
                        );
                        if ((rentProbe.data?.totalElements || 0) > 0) {
                            setHasAnyBooks(true);
                        }
                    } catch {
                        // Probe failure: keep the widget hidden
                    }
                }
            } catch {
                // Silently skip — widget stays hidden when nothing loaded
            } finally {
                setInitialLoading(false);
            }
        };
        init();
    }, [fetchBooks]);

    // Reader mode: the Purchased/Rented framing (time-limited paid access)
    // reads as in-app commerce (Apple 3.1.1). The book content itself stays
    // reachable via the study library, so hide this dashboard summary.
    if (shouldHidePaidPurchaseUI()) {
        return null;
    }

    if (initialLoading) {
        return (
            <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
                <CardHeader className="p-card pb-2">
                    <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent className="p-card">
                    <Skeleton className="h-16 w-full rounded-lg" />
                </CardContent>
            </Card>
        );
    }

    // Settled and no books on either tab: render nothing instead of an empty shell
    if (!hasAnyBooks) {
        return null;
    }

    return (
        <Card className={cn("border border-border shadow-sm bg-card", "cp-card", className)}>
            <CardHeader className="p-card pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary uppercase">
                    {isPlay || isCleanerPlay ? (
                        <img
                            src={iconBooks}
                            alt=""
                            aria-hidden="true"
                            className="h-9 w-9 object-contain"
                        />
                    ) : (
                        <BookOpen className="w-5 h-5" />
                    )}
                    {t("books.title")}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-card pt-0">
                <Tabs value={activeTab} className="w-full" onValueChange={(v) => {
                    setActiveTab(v);
                    setPage(0);
                    const levelKey = v === "purchased" ? "buy" : "rent";
                    fetchBooks(levelIdMap[levelKey], 0);
                }}>
                    <TabsList className="grid w-full grid-cols-2 mb-3 bg-secondary/30 h-8 p-1">
                        <TabsTrigger value="purchased" className="text-xs py-1 h-6">
                            {t("books.tabPurchased")}
                        </TabsTrigger>
                        <TabsTrigger value="rented" className="text-xs py-1 h-6">
                            {t("books.tabRented")}
                        </TabsTrigger>
                    </TabsList>

                    <div className={cn("space-y-2 transition-all duration-300", loading && "opacity-50 pointer-events-none")}>
                        {books.length > 0 ? (
                            <div className="grid grid-cols-1 gap-2">
                                {books.map((book, idx) => (
                                    <div
                                        key={book.id || idx}
                                        className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card hover:bg-secondary/20 transition-colors shadow-sm"
                                    >
                                        <div className="w-7 h-7 rounded-md bg-primary/5 flex items-center justify-center flex-shrink-0">
                                            <BookOpen className="w-3.5 h-3.5 text-primary" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-bold text-foreground truncate leading-tight">
                                                {book.package_name}
                                            </p>
                                            {book.instructors?.[0] && (
                                                <p className="text-caption font-medium text-muted-foreground truncate leading-none mt-0.5">
                                                    {book.instructors[0].full_name}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-4 px-3 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-center bg-secondary/10">
                                <p className="text-caption text-muted-foreground italic font-medium">
                                    {activeTab === "purchased"
                                        ? t("books.emptyPurchased")
                                        : t("books.emptyRented")}
                                </p>
                            </div>
                        )}
                    </div>

                    {totalBooks > 0 && (
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                            <span className="text-caption text-muted-foreground font-black uppercase tracking-tighter">
                                {t("books.bookCount", { count: totalBooks })}
                                {totalPages > 1 &&
                                    t("books.pageIndicator", { page: page + 1, total: totalPages })}
                            </span>
                            {totalPages > 1 && (
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:bg-secondary"
                                        disabled={page === 0 || loading}
                                        onClick={() => {
                                            const newPage = page - 1;
                                            setPage(newPage);
                                            const levelKey = activeTab === "purchased" ? "buy" : "rent";
                                            fetchBooks(levelIdMap[levelKey], newPage);
                                        }}
                                    >
                                        <CaretLeft className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:bg-secondary"
                                        disabled={page === totalPages - 1 || loading}
                                        onClick={() => {
                                            const newPage = page + 1;
                                            setPage(newPage);
                                            const levelKey = activeTab === "purchased" ? "buy" : "rent";
                                            fetchBooks(levelIdMap[levelKey], newPage);
                                        }}
                                    >
                                        <CaretRight className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </Tabs>
            </CardContent>
        </Card>
    );
};
