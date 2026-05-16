import { BlogList } from "@/components/blog/blog-list"; // I'll create this component
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "المدونة | روقان",
    description: "مقالات وأخبار حول السياحة والشاليهات في القصيم",
};

export default function BlogPage() {
    return <BlogList />;
}
