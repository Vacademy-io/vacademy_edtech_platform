import React from "react";
import { useTranslation } from "react-i18next";
import { useCatalogStore } from "../-store/catalogStore";
import { useSuspenseQuery } from "@tanstack/react-query";
import { handleFetchInstituteDetails } from "../-services/institute-details";
import { Funnel, X } from '@phosphor-icons/react';
import { cn, toTitleCase, compareByNameNatural } from "@/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

// Internal reusable component for individual filter sections
interface FilterListProps {
    items: { id: string; name: string; count?: number }[];
    selectedItems: string[];
    handleChange: (itemId: string) => void;
    disabled?: boolean;
}

const FilterList: React.FC<FilterListProps> = ({
    items,
    selectedItems,
    handleChange,
    disabled,
}) => {
    const { t } = useTranslation("study");

    return (
        <div className="space-y-2">
            {items.length === 0 && !disabled && (
                <div className="text-sm text-muted-foreground py-2 italic">
                    {t("filters.noOptions")}
                </div>
            )}
            {disabled && (
                <div className="text-sm text-muted-foreground py-2 italic">
                    {t("filters.unavailable")}
                </div>
            )}
            {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                        <Checkbox
                            id={item.id}
                            checked={selectedItems.includes(item.id)}
                            onCheckedChange={() => handleChange(item.id)}
                            disabled={disabled}
                        />
                        <Label
                            htmlFor={item.id}
                            title={item.name}
                            className={cn(
                                "text-sm cursor-pointer leading-none truncate peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
                                selectedItems.includes(item.id) ? "font-medium text-primary [.ui-vibrant_&]:font-semibold [.ui-play_&]:font-extrabold [.ui-play_&]:text-play-success-soft-ink" : "font-normal [.ui-play_&]:font-bold"
                            )}
                        >
                            {item.name}
                        </Label>
                    </div>
                    {typeof item.count === "number" && (
                        <span className="shrink-0 text-caption font-medium text-muted-foreground tabular-nums">
                            {item.count}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
};

// Props for the entire filter panel
interface FilterPanelProps {
    selectedLevels: string[];
    onLevelChange: (levelId: string) => void;
    selectedSessions: string[];
    onSessionChange: (sessionId: string) => void;
    selectedTags: string[];
    onTagChange: (tagId: string) => void;
    selectedInstructors: string[];
    onInstructorChange: (instructorId: string) => void;
    clearAllFilters: () => void;
    onApplyFilters: () => void;
    levelsDisabled?: boolean;
    sessionsDisabled?: boolean;
    tagsDisabled?: boolean;
    instructorsDisabled?: boolean;
    isDesktopOpen?: boolean;
    onClose?: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
    selectedLevels,
    onLevelChange,
    selectedSessions,
    onSessionChange,
    selectedTags,
    onTagChange,
    selectedInstructors,
    onInstructorChange,
    clearAllFilters,
    onApplyFilters,
    levelsDisabled = false,
    sessionsDisabled = false,
    tagsDisabled = false,
    instructorsDisabled = false,
    isDesktopOpen = true,
    onClose,
}) => {
    const { t } = useTranslation("study");
    const instructor = useCatalogStore((state) => state.instructor);

    const { data: instituteData, isLoading } = useSuspenseQuery(
        handleFetchInstituteDetails()
    );

    const hasActiveFilters =
        selectedLevels.length > 0 ||
        selectedSessions.length > 0 ||
        selectedTags.length > 0 ||
        selectedInstructors.length > 0;

    const activeFiltersCount =
        selectedLevels.length + selectedSessions.length + selectedTags.length + selectedInstructors.length;

    type LevelItem = { id: string; level_name?: string };
    const levels = (instituteData?.levels || [])
        .map((level: LevelItem) => ({
            id: level.id,
            name: toTitleCase(
                level.level_name ||
                    t("filters.unnamedLevel", {
                        level: getTerminology(ContentTerms.Level, SystemTerms.Level),
                    })
            ),
        }))
        // Natural sort so levels read as Class 6, 7, 8 … then non-numeric names.
        .sort(compareByNameNatural);

    type SessionItem = { id: string; session_name?: string };
    const sessions = (instituteData?.sessions || [])
        .map((session: SessionItem) => ({
            id: session.id,
            name: toTitleCase(
                session.session_name ||
                    t("filters.unnamedSession", {
                        session: getTerminology(ContentTerms.Session, SystemTerms.Session),
                    })
            ),
        }))
        .sort(compareByNameNatural);

    const tags = React.useMemo(() => {
        const uniqueMap = new Map<string, string>();
        (instituteData?.tags || []).forEach((tag: string) => {
            const normalized = tag.toLowerCase();
            if (!uniqueMap.has(normalized)) {
                uniqueMap.set(normalized, toTitleCase(tag));
            }
        });
        return Array.from(uniqueMap.entries()).map(([id, name]) => ({
            id,
            name,
        }));
    }, [instituteData?.tags]);

    type InstructorItem = { id: string; full_name?: string; username?: string };
    const instructors = (instructor || []).map((inst: InstructorItem) => ({
        id: inst.id,
        name:
            inst.full_name ||
            inst.username ||
            t("filters.unnamedInstructor", {
                instructor: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
            }),
    }));

    if (isLoading) {
        return (
            <div className="bg-card border rounded-lg p-4 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-muted rounded animate-pulse"></div>
                    <div className="h-4 bg-muted rounded w-16 animate-pulse"></div>
                </div>
                {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                        <div className="h-4 bg-muted rounded w-20 animate-pulse"></div>
                        <div className="space-y-2">
                            {[1, 2, 3].map((j) => (
                                <div key={j} className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-muted rounded animate-pulse"></div>
                                    <div className="h-4 bg-muted rounded w-24 animate-pulse"></div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    const FilterContent = () => (
        <div className={cn(
            "bg-card border rounded-lg shadow-sm",
            // Vibrant — white panel with a tenant top-rail
            "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300",
            "[.ui-vibrant_&]:shadow-md",
            // Play Styles — deep navy panel with soft layered shadow
            "[.ui-play_&]:bg-play-navy-soft [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-border",
            "[.ui-play_&]:shadow-play-glow-navy"
        )}>
            {/* Desktop Header */}
            <div className={cn(
                "p-4 border-b flex items-center justify-between",
                // Vibrant — primary-50 wash header (color lives in headers)
                "[.ui-vibrant_&]:bg-primary-50/60 dark:[.ui-vibrant_&]:bg-primary-500/10",
                "[.ui-vibrant_&]:border-primary/10",
                // Play Styles
                "[.ui-play_&]:border-white/20"
            )}>
                <div className="flex items-center gap-2">
                    <Funnel size={18} className={cn("text-muted-foreground", "[.ui-vibrant_&]:text-primary", "[.ui-play_&]:text-play-navy-soft-ink")} />
                    <h2 className={cn("text-lg font-semibold", "[.ui-vibrant_&]:text-primary", "[.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:font-extrabold")}>{t("filters.title")}</h2>
                </div>
                <div className="flex items-center gap-1">
                    {hasActiveFilters && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAllFilters}
                            className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                        >
                            <X size={14} className="me-1" />
                            {t("filters.clearAll")}
                        </Button>
                    )}
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClose}
                            className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                        >
                            {t("filters.close")}
                        </Button>
                    )}
                </div>
            </div>

            {hasActiveFilters && (
                <div className="px-4 py-2 bg-muted/30 border-b">
                    <p className="text-xs text-primary font-medium">
                        {t("filters.appliedCount", { count: activeFiltersCount })}
                    </p>
                </div>
            )}

            <ScrollArea className="h-filter-scroll min-h-52 lg:h-filter-scroll-lg lg:min-h-60">
                <div className="p-4">
                    <Accordion type="multiple" defaultValue={[]} className="w-full">
                        <AccordionItem value="levels" className="border-b-0">
                            <AccordionTrigger className="hover:no-underline py-3">
                                <span className="text-sm font-semibold">{getTerminology(ContentTerms.Level, SystemTerms.Level)}</span>
                                {selectedLevels.length > 0 && (
                                    <Badge variant="secondary" className="ms-2 text-caption h-5 px-1.5">
                                        {selectedLevels.length}
                                    </Badge>
                                )}
                            </AccordionTrigger>
                            <AccordionContent>
                                <FilterList
                                    items={levels}
                                    selectedItems={selectedLevels}
                                    handleChange={onLevelChange}
                                    disabled={levelsDisabled || levels.length === 0}
                                />
                            </AccordionContent>
                        </AccordionItem>

                        <Separator className="my-2" />

                        <AccordionItem value="sessions" className="border-b-0">
                            <AccordionTrigger className="hover:no-underline py-3">
                                <span className="text-sm font-semibold">{getTerminology(ContentTerms.Session, SystemTerms.Session)}</span>
                                {selectedSessions.length > 0 && (
                                    <Badge variant="secondary" className="ms-2 text-caption h-5 px-1.5">
                                        {selectedSessions.length}
                                    </Badge>
                                )}
                            </AccordionTrigger>
                            <AccordionContent>
                                <FilterList
                                    items={sessions}
                                    selectedItems={selectedSessions}
                                    handleChange={onSessionChange}
                                    disabled={sessionsDisabled || sessions.length === 0}
                                />
                            </AccordionContent>
                        </AccordionItem>

                        <Separator className="my-2" />

                        <AccordionItem value="tags" className="border-b-0">
                            <AccordionTrigger className="hover:no-underline py-3">
                                <span className="text-sm font-semibold">{getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)}</span>
                                {selectedTags.length > 0 && (
                                    <Badge variant="secondary" className="ms-2 text-caption h-5 px-1.5">
                                        {selectedTags.length}
                                    </Badge>
                                )}
                            </AccordionTrigger>
                            <AccordionContent>
                                <FilterList
                                    items={tags}
                                    selectedItems={selectedTags}
                                    handleChange={onTagChange}
                                    disabled={tagsDisabled || tags.length === 0}
                                />
                            </AccordionContent>
                        </AccordionItem>

                        <Separator className="my-2" />

                        <AccordionItem value="instructors" className="border-b-0">
                            <AccordionTrigger className="hover:no-underline py-3">
                                <span className="text-sm font-semibold">{getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)}</span>
                                {selectedInstructors.length > 0 && (
                                    <Badge variant="secondary" className="ms-2 text-caption h-5 px-1.5">
                                        {selectedInstructors.length}
                                    </Badge>
                                )}
                            </AccordionTrigger>
                            <AccordionContent>
                                <FilterList
                                    items={instructors}
                                    selectedItems={selectedInstructors}
                                    handleChange={onInstructorChange}
                                    disabled={instructorsDisabled || instructors.length === 0}
                                />
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>
            </ScrollArea>

            <div className="p-4 border-t bg-muted/20">
                <Button
                    onClick={onApplyFilters}
                    disabled={!hasActiveFilters}
                    className="w-full"
                    size="sm"
                >
                    {t("filters.apply")}
                    {hasActiveFilters && (
                        <Badge variant="secondary" className="ms-2 bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border-0">
                            {activeFiltersCount}
                        </Badge>
                    )}
                </Button>
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop View — only when isDesktopOpen */}
            {isDesktopOpen && (
                <div className="hidden lg:block sticky top-4">
                    <FilterContent />
                </div>
            )}

            {/* Mobile View with Sheet */}
            <div className="lg:hidden mb-4">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "w-full justify-between bg-card",
                                // Vibrant — primary-50 wash trigger (tenant family)
                                "[.ui-vibrant_&]:border-primary-200 dark:[.ui-vibrant_&]:border-primary-500/30",
                                "[.ui-vibrant_&]:shadow-sm",
                                "[.ui-vibrant_&]:bg-primary-50/50 dark:[.ui-vibrant_&]:bg-primary-500/10",
                                // Play Styles — bright green CTA with soft colored glow
                                "[.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-play_&]:border-transparent [.ui-play_&]:rounded-full [.ui-play_&]:font-bold",
                                "[.ui-play_&]:hover:bg-play-success-soft"
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <Funnel size={16} />
                                <span>{t("filters.title")}</span>
                                {hasActiveFilters && (
                                    <Badge variant="secondary" className="h-5 px-1.5 text-caption">
                                        {activeFiltersCount}
                                    </Badge>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground me-1">{t("filters.show")}</span>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-72 sm:w-96 p-0 overflow-hidden flex flex-col">
                        <SheetHeader className="p-4 border-b">
                            <SheetTitle className="text-start flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Funnel size={18} />
                                    <span>{t("filters.title")}</span>
                                </div>
                                {hasActiveFilters && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={clearAllFilters}
                                        className="h-8 w-8 text-muted-foreground"
                                        title={t("filters.clearAll")}
                                    >
                                        <X size={16} />
                                    </Button>
                                )}
                            </SheetTitle>
                        </SheetHeader>

                        <div className="flex-1 overflow-auto p-4">
                            <Accordion type="multiple" defaultValue={[]} className="w-full">
                                <AccordionItem value="levels" className="border-b-0 mb-4 space-y-stack">
                                    <h4 className="font-semibold text-sm flex items-center justify-between">
                                        {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                                        {selectedLevels.length > 0 && (
                                            <Badge variant="secondary" className="text-caption">{selectedLevels.length}</Badge>
                                        )}
                                    </h4>
                                    <FilterList
                                        items={levels}
                                        selectedItems={selectedLevels}
                                        handleChange={onLevelChange}
                                        disabled={levelsDisabled || levels.length === 0}
                                    />
                                </AccordionItem>

                                <Separator className="my-4" />

                                <AccordionItem value="sessions" className="border-b-0 mb-4 space-y-stack">
                                    <h4 className="font-semibold text-sm flex items-center justify-between">
                                        {getTerminology(ContentTerms.Session, SystemTerms.Session)}
                                        {selectedSessions.length > 0 && (
                                            <Badge variant="secondary" className="text-caption">{selectedSessions.length}</Badge>
                                        )}
                                    </h4>
                                    <FilterList
                                        items={sessions}
                                        selectedItems={selectedSessions}
                                        handleChange={onSessionChange}
                                        disabled={sessionsDisabled || sessions.length === 0}
                                    />
                                </AccordionItem>

                                <Separator className="my-4" />

                                <AccordionItem value="tags" className="border-b-0 mb-4 space-y-stack">
                                    <h4 className="font-semibold text-sm flex items-center justify-between">
                                        {getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)}
                                        {selectedTags.length > 0 && (
                                            <Badge variant="secondary" className="text-caption">{selectedTags.length}</Badge>
                                        )}
                                    </h4>
                                    <FilterList
                                        items={tags}
                                        selectedItems={selectedTags}
                                        handleChange={onTagChange}
                                        disabled={tagsDisabled || tags.length === 0}
                                    />
                                </AccordionItem>

                                <Separator className="my-4" />

                                <AccordionItem value="instructors" className="border-b-0 space-y-stack">
                                    <h4 className="font-semibold text-sm flex items-center justify-between">
                                        {getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)}
                                        {selectedInstructors.length > 0 && (
                                            <Badge variant="secondary" className="text-caption">{selectedInstructors.length}</Badge>
                                        )}
                                    </h4>
                                    <FilterList
                                        items={instructors}
                                        selectedItems={selectedInstructors}
                                        handleChange={onInstructorChange}
                                        disabled={instructorsDisabled || instructors.length === 0}
                                    />
                                </AccordionItem>
                            </Accordion>
                        </div>

                        <div className="p-4 border-t bg-muted/20">
                            <Button
                                onClick={onApplyFilters}
                                disabled={!hasActiveFilters}
                                className="w-full"
                            >
                                {activeFiltersCount > 0
                                    ? t("filters.applyWithCount", { selected: activeFiltersCount })
                                    : t("filters.applyShort")}
                            </Button>
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
        </>
    );
};

export default FilterPanel;
