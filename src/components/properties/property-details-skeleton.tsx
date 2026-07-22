import { Loader2 } from "lucide-react";

const SkeletonLine = ({ className }: { className: string }) => (
    <div className={`animate-pulse rounded-md bg-[#e8e1d2] ${className}`} />
);

export function PropertyDetailsSkeleton() {
    return (
        <div className="min-h-screen bg-[#faf8f1]" dir="rtl" role="status" aria-label="جاري تحميل العقار">
            <div className="border-b border-[#e5dcc7] bg-[#fffdf8]">
                <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
                    <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-lg bg-[#eee7d9]" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <SkeletonLine className="h-2.5 w-20" />
                        <SkeletonLine className="h-4 w-28" />
                    </div>
                    <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-lg bg-[#eee7d9]" />
                    <div className="h-8 w-14 flex-shrink-0 animate-pulse rounded-lg bg-[#e0cf9d]" />
                </div>
            </div>

            <main className="mx-auto w-full max-w-7xl px-3 pb-10 pt-4 sm:px-4 sm:pt-6 md:pb-14 md:pt-8">
                <SkeletonLine className="mb-4 h-8 w-52 sm:mb-6 sm:h-10 sm:w-72" />

                <div dir="ltr" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
                    <section dir="rtl" className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
                        <div className="overflow-hidden rounded-lg border border-[#e2d6bd] bg-white">
                            <div className="relative flex aspect-[4/3] items-center justify-center bg-[#eee7d9] sm:aspect-[16/10]">
                                <div className="absolute inset-0 shimmer" />
                                <div className="relative flex h-12 w-12 items-center justify-center rounded-lg border border-white/80 bg-white/75 text-[#9a7623] shadow-sm">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                </div>
                            </div>
                            <div className="flex gap-2 border-t border-[#eee4cf] bg-[#fffdf8] p-3">
                                {[0, 1, 2, 3].map((item) => (
                                    <div key={item} className="h-14 w-[4.5rem] flex-shrink-0 animate-pulse rounded-lg bg-[#e8e1d2] sm:h-20 sm:w-24" />
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#e2d6bd]">
                            {[0, 1, 2].map((item) => (
                                <div key={item} className="min-w-0 space-y-2 bg-white p-3 sm:p-4">
                                    <div className="h-8 w-8 animate-pulse rounded-lg bg-[#eee7d9]" />
                                    <SkeletonLine className="h-2.5 w-10" />
                                    <SkeletonLine className="h-4 w-14" />
                                </div>
                            ))}
                        </div>
                    </section>

                    <aside dir="rtl" className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                        <div className="space-y-4 rounded-lg border border-[#d7dbd5] bg-[#f4f5f3] p-4 sm:p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 space-y-2">
                                    <SkeletonLine className="h-3 w-24" />
                                    <SkeletonLine className="h-6 w-44" />
                                    <SkeletonLine className="h-3 w-full max-w-60" />
                                </div>
                                <div className="h-11 w-11 animate-pulse rounded-lg bg-[#dfe3de]" />
                            </div>
                            <div className="h-12 w-full animate-pulse rounded-lg bg-[#dfe3de]" />
                        </div>

                        <div className="space-y-4 rounded-lg border border-[#e2d6bd] bg-white p-4 sm:p-5">
                            <SkeletonLine className="h-5 w-24" />
                            {[0, 1, 2, 3].map((item) => (
                                <div key={item} className="flex items-center justify-between border-t border-[#eee4cf] pt-3 first:border-0 first:pt-0">
                                    <SkeletonLine className="h-4 w-24" />
                                    <SkeletonLine className="h-5 w-16" />
                                </div>
                            ))}
                        </div>
                    </aside>

                    <section dir="rtl" className="min-w-0 rounded-lg border border-[#e2d6bd] bg-white p-4 sm:p-5 lg:col-start-1 lg:row-start-2">
                        <SkeletonLine className="mb-4 h-5 w-20" />
                        <SkeletonLine className="mb-6 h-4 w-48 max-w-full" />
                        <SkeletonLine className="mb-3 h-5 w-28" />
                        <div className="flex flex-wrap gap-2">
                            {[20, 24, 16, 28, 20, 24].map((width, item) => (
                                <div key={item} className="h-8 animate-pulse rounded-lg bg-[#eee7d9]" style={{ width: `${width * 4}px` }} />
                            ))}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
