"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, User, BookOpen } from "lucide-react";
import { useEffect } from "react";

interface BlogPost {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    coverImage: string;
    author: string;
    publishedAt: string;
    keywords: string[];
}

function formatDate(dateStr: string): string {
    if (!dateStr) return "";
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString("ar-SA", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    } catch {
        return dateStr;
    }
}

export function BlogList() {
    const { data: posts, isLoading } = useQuery<BlogPost[]>({
        queryKey: ["/api/blog"],
    });

    useEffect(() => {
        // Client-side title (metadata handled by page.tsx in Next.js, but keeping for compatibility)
        // document.title...
    }, []);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background py-8 px-4" dir="rtl">
                <div className="max-w-6xl mx-auto">
                    <div className="animate-pulse space-y-6">
                        <div className="h-10 bg-muted rounded w-48"></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-80 bg-muted rounded-lg"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background" dir="rtl">
            <header className="bg-card border-b border-border sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <BookOpen className="w-6 h-6 text-primary" />
                        <h1 className="text-xl font-bold text-foreground">مدونة روقان</h1>
                    </div>
                    <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition">
                        <span>العقارات</span>
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-8">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-foreground mb-2">أحدث المقالات</h2>
                    <p className="text-muted-foreground">نصائح ومعلومات حول الشاليهات والعقارات في القصيم</p>
                </div>

                {!posts || posts.length === 0 ? (
                    <Card className="p-12 text-center">
                        <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">لا توجد مقالات حالياً</h3>
                        <p className="text-muted-foreground">سيتم إضافة مقالات جديدة قريباً</p>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {posts.map((post) => (
                            <Link key={post.id} href={`/blog/${post.slug}`} className="block group" data-testid={`card-blog-${post.slug}`}>
                                <Card className="overflow-hidden hover-elevate transition-all h-full flex flex-col">
                                    {post.coverImage ? (
                                        <div className="aspect-video overflow-hidden">
                                            <img
                                                src={post.coverImage}
                                                alt={post.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                        </div>
                                    ) : (
                                        <div className="aspect-video bg-muted flex items-center justify-center">
                                            <BookOpen className="w-12 h-12 text-muted-foreground" />
                                        </div>
                                    )}

                                    <div className="p-4 flex-1 flex flex-col">
                                        <h3 className="text-lg font-bold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition">
                                            {post.title}
                                        </h3>

                                        {post.excerpt && (
                                            <p className="text-sm text-muted-foreground mb-4 line-clamp-3 flex-1">
                                                {post.excerpt}
                                            </p>
                                        )}

                                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto">
                                            <span className="flex items-center gap-1">
                                                <User className="w-3 h-3" />
                                                {post.author}
                                            </span>
                                            {post.publishedAt && (
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {formatDate(post.publishedAt)}
                                                </span>
                                            )}
                                        </div>

                                        {post.keywords && post.keywords.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-3">
                                                {post.keywords.slice(0, 3).map((keyword, i) => (
                                                    <Badge key={i} variant="secondary" className="text-[10px]">
                                                        {keyword}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            </Link>
                        ))}
                    </div>
                )}
            </main>

            <footer className="bg-card border-t border-border py-6 mt-12">
                <div className="max-w-6xl mx-auto px-4 text-center text-sm text-muted-foreground">
                    <p>روقان - شاليهات القصيم</p>
                </div>
            </footer>
        </div>
    );
}
