"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Calendar, User, BookOpen, Share2 } from "lucide-react";
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
            // document.title handled by generateMetadata in page.tsx theoretically,
            // but since we fetch client side, we can update it here too.
            document.title = post.metaTitle || `${post.title} | روقان`;

            // ... (Rest of meta tag injection logic omitted as Next.js should handle it via generateMetadata if we moved fetch to server, but for now client side is fine)

            const script = document.createElement("script");
            script.type = "application/ld+json";
            script.id = "blog-schema";
            script.textContent = JSON.stringify({
                "@context": "https://schema.org",
                "@type": "BlogPosting",
                "headline": post.title,
                "description": post.metaDescription || post.excerpt,
                "image": post.coverImage || "",
                "author": {
                    "@type": "Person",
                    "name": post.author
                },
                "publisher": {
                    "@type": "Organization",
                    "name": "روقان",
                    "logo": {
                        "@type": "ImageObject",
                        "url": `${window.location.origin}/logo.png`
                    }
                },
                "datePublished": post.publishedAt,
                "mainEntityOfPage": {
                    "@type": "WebPage",
                    "@id": window.location.href
                }
            });

            const oldScript = document.getElementById("blog-schema");
            if (oldScript) oldScript.remove();
            document.head.appendChild(script);

            return () => {
                const s = document.getElementById("blog-schema");
                if (s) s.remove();
            };
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
                        <div className="h-64 bg-muted rounded"></div>
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
                        <Button data-testid="button-back-to-blog">العودة للمدونة</Button>
                    </Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background" dir="rtl">
            <header className="bg-card border-b border-border sticky top-0 z-50">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/blog" legacyBehavior>
                        <a className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition" data-testid="link-back-blog">
                            <ArrowRight className="w-4 h-4" />
                            <span>المدونة</span>
                        </a>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={handleShare} data-testid="button-share">
                        <Share2 className="w-5 h-5" />
                    </Button>
                </div>
            </header>

            <article className="max-w-3xl mx-auto px-4 py-8">
                {post.coverImage && (
                    <div className="aspect-video rounded-lg overflow-hidden mb-6">
                        <img
                            src={post.coverImage}
                            alt={post.title}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}

                <h1 className="text-3xl font-bold text-foreground mb-4">{post.title}</h1>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                    <span className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        {post.author}
                    </span>
                    {post.publishedAt && (
                        <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {formatDate(post.publishedAt)}
                        </span>
                    )}
                </div>

                {post.keywords && post.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-6">
                        {post.keywords.map((keyword, i) => (
                            <Badge key={i} variant="secondary">
                                {keyword}
                            </Badge>
                        ))}
                    </div>
                )}

                <div
                    className="prose prose-lg dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: post.content }}
                />
            </article>

            <footer className="bg-card border-t border-border py-6 mt-12">
                <div className="max-w-3xl mx-auto px-4 text-center">
                    <Link href="/blog">
                        <Button variant="outline" data-testid="button-more-articles">
                            المزيد من المقالات
                        </Button>
                    </Link>
                </div>
            </footer>
        </div>
    );
}
