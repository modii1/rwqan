"use client";

import { Building2, ShieldCheck, UserRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AuthRole } from "@/lib/auth-role";

const roles: Array<{
  id: AuthRole;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "customer", label: "العميل", icon: UserRound },
  { id: "owner", label: "مالك العقار", icon: Building2 },
  { id: "admin", label: "المسؤول", icon: ShieldCheck },
];

interface AuthGatewayProps {
  activeRole: AuthRole;
  contextLabel: string;
  heading: string;
  description: string;
  onRoleChange: (role: AuthRole) => void;
  children: React.ReactNode;
  disabled?: boolean;
  titleTestId?: string;
}

export function AuthGateway({
  activeRole,
  contextLabel,
  heading,
  description,
  onRoleChange,
  children,
  disabled = false,
  titleTestId,
}: AuthGatewayProps) {
  return (
    <div className="relative min-h-[calc(100vh-70px)] min-h-[calc(100svh-70px)] overflow-hidden bg-[#f2efe6] px-3 py-5 sm:px-6 sm:py-10" dir="rtl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#d8caa9]" aria-hidden="true" />
      <div className="relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-[#d9cfb8] bg-[#fffdf8] shadow-[0_24px_70px_rgba(53,49,39,0.12)] lg:min-h-[610px] lg:grid-cols-[minmax(290px,0.82fr)_minmax(0,1.18fr)]">
        <h1 className="sr-only" data-testid={titleTestId}>{heading}</h1>
        <aside className="relative hidden overflow-hidden bg-[#29372f] p-10 text-[#fffdf8] lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -left-24 top-24 h-96 w-72 rounded-t-full border border-[#ccb46f]/25" aria-hidden="true" />
          <div className="pointer-events-none absolute -left-10 top-36 h-80 w-56 rounded-t-full border border-[#ccb46f]/15" aria-hidden="true" />
          <img src="/assets/logo-icon.png" alt="روقان" className="relative h-20 w-20 object-contain" />
          <div className="relative max-w-xs">
            <p className="text-sm font-bold text-[#d8bf76]">{contextLabel}</p>
            <p className="mt-3 text-3xl font-bold leading-[1.45]" aria-hidden="true">
              {heading}
            </p>
            <p className="mt-4 text-sm leading-7 text-[#e7e3d8]">{description}</p>
          </div>
          <div className="relative flex items-center gap-3 border-t border-white/15 pt-5 text-xs text-[#c8cfc9]">
            <span className="h-2 w-2 rounded-full bg-[#d2b766]" aria-hidden="true" />
            <span>أدخل بيانات حسابك للمتابعة</span>
          </div>
        </aside>

        <Tabs
          value={activeRole}
          onValueChange={(value) => onRoleChange(value as AuthRole)}
          dir="rtl"
          className="min-w-0 bg-[#fffdf8] px-4 py-5 sm:px-8 sm:py-8 lg:px-10 lg:py-10"
        >
          <div className="mb-6 flex items-center gap-3 border-b border-[#e9dfca] pb-5 lg:hidden">
            <img src="/assets/logo-icon.png" alt="روقان" className="h-12 w-12 flex-none object-contain" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#8b6b25]">{contextLabel}</p>
              <p className="mt-1 truncate text-xl font-bold text-[#293129]" aria-hidden="true">
                {heading}
              </p>
            </div>
          </div>

          <TabsList
            aria-label="اختيار نوع الحساب"
            className="grid h-auto w-full grid-cols-3 gap-1 rounded-2xl border border-[#ded5c2] bg-[#f0ede5] p-1.5"
          >
            {roles.map((role) => {
              const Icon = role.icon;
              const selected = activeRole === role.id;
              return (
                <TabsTrigger
                  key={role.id}
                  value={role.id}
                  disabled={disabled}
                  data-testid={`auth-role-${role.id}`}
                  className={`flex min-h-12 min-w-0 whitespace-normal rounded-xl px-1.5 py-2 text-[11px] font-bold shadow-none transition-colors focus-visible:ring-[#9a7623] sm:gap-2 sm:px-3 sm:text-sm data-[state=active]:bg-[#29372f] data-[state=active]:text-white data-[state=active]:shadow-sm ${
                    selected
                      ? "bg-[#29372f] text-white shadow-sm"
                      : "text-[#625c4f] hover:bg-white hover:text-[#29372f]"
                  }`}
                >
                  <Icon className={`hidden h-4 w-4 flex-none min-[380px]:block ${selected ? "text-[#d8bf76]" : "text-[#8b7140]"}`} aria-hidden="true" />
                  <span className="whitespace-normal text-center leading-4">{role.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="mt-7 lg:hidden">
            <p className="text-sm leading-7 text-[#6f685b]">{description}</p>
          </div>

          <TabsContent value={activeRole} className="mt-7 min-w-0">
            {children}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
