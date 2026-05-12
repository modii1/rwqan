"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, User, BookOpen } from "lucide-react";

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
        return date.toLocaleDateString("en-US", { timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric" });
    } catch {
        return dateStr;
    }
}

export function BlogList() {
    const { data: posts, isLoading } = useQuery<BlogPost[]>({
        queryKey: ["/api/blog"],
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background" dir="rtl">
                <div className="max-w-7xl mx-auto px-4 py-12">
                    <div className="animate-pulse space-y-8">
                        <div className="h-12 bg-muted rounded-xl w-64"></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-96 bg-muted rounded-2xl"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background" dir="rtl">
            <header className="header-glass border-b border-border/50 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-primary/10">
                            <BookOpen className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-foreground">مدونة روقان</h1>
                            <p className="text-sm text-muted-foreground hidden md:block">نصائح ومعلومات عن السياحة والشاليهات</p>
                        </div>
                    </div>
                    <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-all duration-300 bg-muted/50 px-4 py-2 rounded-xl hover:bg-muted">
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm font-medium">العقارات</span>
                    </Link>
                </div>
            </header>

            <section className="bg-gradient-to-b from-primary/5 to-background py-16">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
                        أحدث المقالات
                    </h2>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        نصائح ومعلومات حول الشاليهات والعقارات في القصيم
                    </p>
                    <div className="divider-gold max-w-xs mx-auto mt-8"></div>
                </div>
            </section>

            <main className="max-w-7xl mx-auto px-4 py-12">
                {!posts || posts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-6">
                            <BookOpen className="w-12 h-12 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground mb-2">لا توجد مقالات حالياً</h3>
                        <p className="text-muted-foreground">سيتم إضافة مقالات جديدة قريباً</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {posts.map((post) => (
                            <Link key={post.id} href={`/blog/${post.slug}`} className="block group" data-testid={`card-blog-${post.slug}`}>
                                <Card className="overflow-hidden card-hover-lift h-full flex flex-col border-border/50">
                                    {post.coverImage ? (
                                        <div className="aspect-video overflow-hidden bg-muted relative">
                                            <img
                                                src={post.coverImage}
                                                alt={post.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                loading="lazy"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                        </div>
                                    ) : (
                                        <div className="aspect-video bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
                                            <BookOpen className="w-16 h-16 text-primary/40" />
                                        </div>
                                    )}

                                    <div className="p-6 flex-1 flex flex-col">
                                        <h3 className="text-lg font-bold text-foreground mb-3 line-clamp-2 group-hover:text-primary transition-colors duration-200">
                                            {post.title}
                                        </h3>

                                        {post.excerpt && (
                                            <p className="text-sm text-muted-foreground mb-4 line-clamp-3 flex-1 leading-relaxed">
                                                {post.excerpt}
                                            </p>
                                        )}

                                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto pt-4 border-t border-border/40">
                                            <span className="flex items-center gap-1.5 bg-muted/50 px-2 py-1 rounded-lg">
                                                <User className="w-3.5 h-3.5" />
                                                <span>{post.author}</span>
                                            </span>
                                            {post.publishedAt && (
                                                <span className="flex items-center gap-1.5 bg-muted/50 px-2 py-1 rounded-lg">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    <span>{formatDate(post.publishedAt)}</span>
                                                </span>
                                            )}
                                        </div>

                                        {post.keywords && post.keywords.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-4">
                                                {post.keywords.slice(0, 3).map((keyword, i) => (
                                                    <Badge key={i} variant="secondary" className="text-[11px] font-normal bg-muted/50">
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

            <footer className="bg-muted/30 border-t border-border/50 py-8">
                <div className="max-w-7xl mx-auto px-4 text-center text-sm text-muted-foreground">
                    <p>روقان - شاليهات القصيم</p>
                </div>
            </footer>
        </div>
    );
}
