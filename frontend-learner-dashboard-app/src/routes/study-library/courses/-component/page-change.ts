/** Reports true only when the page number differs from the last one it saw. */
export const createPageChangeDetector = (initialPage: number) => {
    let lastPage = initialPage;
    return (page: number): boolean => {
        if (page === lastPage) return false;
        lastPage = page;
        return true;
    };
};
