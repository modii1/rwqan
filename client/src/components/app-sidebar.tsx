import { Home, LogIn, LogOut, LayoutDashboard, CreditCard, ImagePlus, Lightbulb, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

const protectedOwnerItems = [
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
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  // Check login status
  const { data: session } = useQuery<{ isLoggedIn: boolean; propertyNumber?: string }>({
    queryKey: ['/api/owner/session'],
  });

  const isLoggedIn = session?.isLoggedIn || false;

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/owner/logout');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/owner/session'] });
      toast({
        title: "تم تسجيل الخروج",
        description: "تم تسجيل الخروج بنجاح",
      });
      setLocation('/');
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <Sidebar side="right" collapsible="offcanvas">
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
                  >
                    <Link 
                      href={item.url} 
                      data-testid={`sidebar-link-${item.url}`}
                      onClick={() => {
                        // إلغاء الفلاتر عند الضغط على الصفحة الرئيسية
                        if (item.url === "/") {
                          sessionStorage.removeItem("propertyFilters");
                          sessionStorage.removeItem("visibleCount");
                        }
                      }}
                    >
                      <item.icon className="mr-2" />
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
              {/* Login/Logout Button */}
              {!isLoggedIn ? (
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === '/owner/login'}
                  >
                    <Link href="/owner/login" data-testid="sidebar-link-owner-login">
                      <LogIn className="mr-2" />
                      <span>تسجيل الدخول</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    onClick={handleLogout}
                    disabled={logoutMutation.isPending}
                    data-testid="sidebar-button-logout"
                  >
                    <LogOut className="mr-2" />
                    <span>تسجيل الخروج</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Protected Pages - Only show when logged in */}
              {isLoggedIn && protectedOwnerItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`sidebar-link-${item.url}`}>
                      <item.icon className="mr-2" />
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
