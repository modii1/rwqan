"use client";

import { MapPin, Phone, Mail, ExternalLink } from "lucide-react";
import { BrandMark } from "@/components/core/brand/brand-mark";

export function Footer() {
    return (
        <footer className="bg-gradient-to-b from-background to-muted/30 mt-auto relative overflow-hidden">
            {/* Decorative top line */}
            <div className="footer-line" />

            <div className="max-w-7xl mx-auto px-4 pt-16 pb-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
                    {/* Brand Column */}
                    <div className="space-y-4">
                        <BrandMark
                            className="h-16 w-auto"
                        />
                        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                            منصة روقان الأولى للشاليهات والاستراحات في منطقة القصيم. 
                            نقدم تجربة حجز سهلة ومميزة لعملائنا.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-lg text-foreground">روابط سريعة</h3>
                        <nav className="space-y-3">
                            <a href="/" className="block text-muted-foreground hover:text-primary transition-colors duration-200 text-sm">
                                الصفحة الرئيسية
                            </a>
                            <a href="/blog" className="block text-muted-foreground hover:text-primary transition-colors duration-200 text-sm">
                                المدونة
                            </a>
                            <a href="/suggest" className="block text-muted-foreground hover:text-primary transition-colors duration-200 text-sm">
                                اقترح لنا
                            </a>
                            <a href="/subscription" className="block text-muted-foreground hover:text-primary transition-colors duration-200 text-sm">
                                اشترك معنا
                            </a>
                        </nav>
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-lg text-foreground">تواصل معنا</h3>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <Phone className="w-4 h-4 text-primary" />
                                <span>0533220646</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <Mail className="w-4 h-4 text-primary" />
                                <span>info@rwqan.sa</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <MapPin className="w-4 h-4 text-primary" />
                                <span>منطقة القصيم، المملكة العربية السعودية</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="divider-gold mb-8" />

                {/* Bottom Section */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                        روقـان | نُـزل ورفـاهية - للشاليهات والاستراحات والعقارات
                    </p>
                    <p className="text-xs text-muted-foreground">
                        © {new Date().getFullYear()} روقـان
                    </p>
                </div>
            </div>
        </footer>
    );
}
