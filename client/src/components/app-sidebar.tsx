import { Home, LogIn, LayoutDashboard, CreditCard, ImagePlus, Lightbulb, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";

const publicItems = [
  {
    title: "الصفحة الرئيسية",
    url: "/",
    icon: Home,
  },
  {
    title: "اقترح لنا",
    url: "/suggest",
    icon: Lightbulb,
  },
  {
    title: "اشترك معنا",
    url: "/register",
    icon: UserPlus,
  },
];

const ownerItems = [
  {
    title: "تسجيل الدخول",
    url: "/owner/login",
    icon: LogIn,
  },
  {
    title: "لوحة التحكم",
    url: "/owner/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "الاشتراك",
    url: "/owner/subscription",
    icon: CreditCard,
  },
  {
    title: "إدارة الصور",
    url: "/owner/images",
    icon: ImagePlus,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="text-3xl">🏡</div>
          <div>
            <h2 className="text-lg font-bold text-sidebar-primary">مودي الذكي</h2>
            <p className="text-xs text-sidebar-foreground/70">إدارة العقارات</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>القائمة الرئيسية</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {publicItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`sidebar-link-${item.url}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="ml-2" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>قسم الملاك</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ownerItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`sidebar-link-${item.url}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="ml-2" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
