"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Calendar, User, BookOpen, Share2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

interface BlogPost {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    coverImage: string;
    metaTitle: string;
    metaDescription: string;
    keywords: string[];
    author: string;
    publishedAt: string;
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

export function BlogPostClient({ slug }: { slug: string }) {
    const { toast } = useToast();

    const { data: post, isLoading, isError } = useQuery<BlogPost>({
        queryKey: ["/api/blog", slug],
        queryFn: async () => {
            const res = await fetch(`/api/blog/${slug}`);
            if (!res.ok) throw new Error("Not found");
            return res.json();
        },
        enabled: !!slug,
    });

    useEffect(() => {
        if (post) {
            document.title = post.metaTitle || `${post.title} | روقان`;
        }
    }, [post]);

    const handleShare = async () => {
        const url = window.location.href;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: post?.title,
                    text: post?.excerpt,
                    url,
                });
            } catch {
            }
        } else {
            await navigator.clipboard.writeText(url);
            toast({ title: "تم نسخ الرابط" });
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background py-8 px-4" dir="rtl">
                <div className="max-w-3xl mx-auto">
                    <div className="animate-pulse space-y-6">
                        <div className="h-8 bg-muted rounded w-3/4"></div>
                        <div className="h-64 bg-muted rounded-xl"></div>
                        <div className="space-y-3">
                            <div className="h-4 bg-muted rounded"></div>
                            <div className="h-4 bg-muted rounded w-5/6"></div>
                            <div className="h-4 bg-muted rounded w-4/6"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isError || !post) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
                <Card className="p-12 text-center max-w-md">
                    <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">المقال غير موجود</h3>
                    <p className="text-muted-foreground mb-4">عذراً، لم نتمكن من العثور على هذا المقال</p>
                    <Link href="/blog">
                        <Button data-testid="button-back-to-blog" className="rounded-xl">العودة للمدونة</Button>
                    </Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background" dir="rtl">
            {/* Enhanced Header */}
            <header className="header-glass border-b border-border/50 sticky top-0 z-50">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/blog" className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-all duration-300 bg-muted/50 px-4 py-2 rounded-xl hover:bg-muted">
                        <ChevronRight className="w-4 h-4" />
                        <span className="text-sm font-medium">المدونة</span>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={handleShare} data-testid="button-share" className="rounded-xl hover:bg-primary/10 transition-colors">
                        <Share2 className="w-5 h-5 text-foreground/70" />
                    </Button>
                </div>
            </header>

            <article className="max-w-3xl mx-auto px-4 py-8">
                {post.coverImage && (
                    <div className="relative rounded-2xl overflow-hidden mb-8 bg-muted group">
                        <img
                            src={post.coverImage}
                            alt={post.title}
                            className="w-full h-auto max-h-[500px] object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"></div>
                        <div className="absolute bottom-0 right-0 left-0 p-6">
                            <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 drop-shadow-lg">{post.title}</h1>
                        </div>
                    </div>
                )}

                {!post.coverImage && (
                    <h1 className="text-3xl font-bold text-foreground mb-6">{post.title}</h1>
                )}

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                    <span className="flex items-center gap-1.5 bg-muted/50 px-3 py-1.5 rounded-lg">
                        <User className="w-4 h-4" />
                        {post.author}
                    </span>
                    {post.publishedAt && (
                        <span className="flex items-center gap-1.5 bg-muted/50 px-3 py-1.5 rounded-lg">
                            <Calendar className="w-4 h-4" />
                            {formatDate(post.publishedAt)}
                        </span>
                    )}
                </div>

                {post.keywords && post.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-8">
                        {post.keywords.map((keyword, i) => (
                            <Badge key={i} variant="secondary" className="bg-primary/5 text-primary border-none hover:bg-primary/10 transition-colors rounded-full px-4 py-1">
                                {keyword}
                            </Badge>
                        ))}
                    </div>
                )}

                <div
                    className="prose prose-lg dark:prose-invert max-w-none blog-content"
                    dangerouslySetInnerHTML={{ __html: post.content }}
                />
            </article>

            <footer className="bg-muted/30 border-t border-border/50 py-8 mt-12">
                <div className="max-w-3xl mx-auto px-4 text-center">
                    <Link href="/blog">
                        <Button variant="outline" data-testid="button-more-articles" className="rounded-xl border-border/50 hover:bg-muted/50 transition-all duration-300">
                            المزيد من المقالات
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    </Link>
                </div>
            </footer>
        </div>
    );
}
