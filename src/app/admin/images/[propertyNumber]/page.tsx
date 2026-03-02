import AdminImagesPage from "@/components/admin/admin-images";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "إدارة الصور | لوحة التحكم",
};

export default function ImagesPage() {
    return <AdminImagesPage />;
}
