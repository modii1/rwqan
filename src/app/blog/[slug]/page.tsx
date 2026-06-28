import { BlogPostClient } from "@/components/blog/blog-post-client";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "مقال | مدونة روقان",
};

interface PageProps {
    params: Promise<{
        slug: string;
    }>;
}

export default async function BlogPostPage({ params }: PageProps) {
    const { slug } = await params;
    return (
        <>
            <style>{`
                .blog-content h1 {
                    font-size: 2rem;
                    font-weight: 700;
                    margin-top: 1.5rem;
                    margin-bottom: 1rem;
                    color: var(--foreground);
                    line-height: 1.3;
                }
                .blog-content h2 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    color: var(--foreground);
                    line-height: 1.3;
                    border-bottom: 2px solid var(--border);
                    padding-bottom: 0.5rem;
                }
                .blog-content h3 {
                    font-size: 1.25rem;
                    font-weight: 600;
                    margin-top: 1.25rem;
                    margin-bottom: 0.5rem;
                    color: var(--foreground);
                    line-height: 1.4;
                }
                .blog-content h4 {
                    font-size: 1.1rem;
                    font-weight: 600;
                    margin-top: 1rem;
                    margin-bottom: 0.5rem;
                    color: var(--foreground);
                }
                .blog-content p {
                    margin-bottom: 1rem;
                    line-height: 1.8;
                    color: var(--foreground);
                }
                .blog-content ul, .blog-content ol {
                    margin-bottom: 1rem;
                    padding-right: 1.5rem;
                }
                .blog-content li {
                    margin-bottom: 0.5rem;
                    line-height: 1.6;
                }
                .blog-content blockquote {
                    border-right: 4px solid var(--primary);
                    padding-right: 1rem;
                    margin: 1.5rem 0;
                    font-style: italic;
                    color: var(--muted-foreground);
                }
                .blog-content a {
                    color: var(--primary);
                    text-decoration: underline;
                }
                .blog-content a:hover {
                    opacity: 0.8;
                }
                .blog-content img {
                    max-width: 100%;
                    height: auto;
                    aspect-ratio: unset;
                    border-radius: 0.5rem;
                    margin: 1.5rem 0;
                }
                .blog-content table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1.5rem 0;
                }
                .blog-content th, .blog-content td {
                    border: 1px solid var(--border);
                    padding: 0.75rem;
                    text-align: right;
                }
                .blog-content th {
                    background-color: var(--muted);
                    font-weight: 600;
                }
                .blog-content strong {
                    font-weight: 700;
                    color: var(--foreground);
                }
                .blog-content em {
                    font-style: italic;
                }
            `}</style>
            <BlogPostClient slug={slug} />
        </>
    );
}
