/** Placeholder cards. Small and free of the class logic, so Home can show it immediately. */
export function TodaySkeleton() {
    return (
        <div className="flex space-x-4 p-1" aria-hidden>
            {[0, 1, 2].map((index) => (
                <div
                    key={index}
                    className="h-48 w-96 shrink-0 animate-pulse rounded-lg border border-border bg-neutral-100"
                />
            ))}
        </div>
    );
}
