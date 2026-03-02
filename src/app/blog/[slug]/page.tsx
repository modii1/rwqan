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
    return <BlogPostClient slug={slug} />;
}
