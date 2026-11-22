"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Loader2, Star } from "lucide-react";
import type { Occasion, OccasionProperty } from "@shared/schema";
import { OwnerSectionHeading, ownerPanelClass } from "./owner-page";
import { OwnerEmptyState, OwnerInput } from "./owner-ui";

interface OwnerOccasionData {
  occasion: Occasion;
  propertyData: OccasionProperty | null;
  isEnrolled: boolean;
}

export default function OwnerOccasionsSection() {
  const { toast } = useToast();

  const { data: fetchedData, isLoading, dataUpdatedAt } = useQuery<OwnerOccasionData[]>({
    queryKey: ["/api/owner/occasions"],
    staleTime: 0,
  });

  const [occasionsData, setOccasionsData] = useState<OwnerOccasionData[]>([]);
  useEffect(() => {
    if (fetchedData) {
      setOccasionsData(fetchedData);
    }
  }, [dataUpdatedAt]);

  const updateMutation = useMutation({
    mutationFn: async ({ occasionId, data }: { occasionId: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/owner/occasions/${occasionId}`, data);
      return res.json();
    },
    onMutate: ({ occasionId, data }) => {
      setOccasionsData(prev => prev.map(item =>
        item.occasion.id === occasionId && item.propertyData
          ? {
              ...item,
              propertyData: {
                ...item.propertyData,
                ...(data.availability && { availability: data.availability }),
                ...(data.prices && { prices: data.prices }),
              },
            }
          : item
      ));
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      queryClient.resetQueries({ queryKey: ["/api/owner/occasions"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-[#80621d]" />
      </div>
    );
  }

  if (occasionsData.length === 0) {
    return null; // Don't show section if no active occasions
  }

  return (
    <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
      <OwnerSectionHeading
        title="عروض المناسبات"
        description="حدّث التوفر والسعر لكل يوم"
        icon={<Star className="h-4 w-4" />}
      />

      {occasionsData.map(({ occasion, propertyData, isEnrolled }) => {
        if (!isEnrolled || !propertyData) {
          return (
            <OwnerEmptyState
              key={occasion.id}
              className="mb-3"
              icon={<Calendar className="h-5 w-5" />}
              title={`عقارك غير مسجل في ${occasion.name}`}
              description="تواصل مع الإدارة للانضمام."
            />
          );
        }

        return (
          <div key={occasion.id} className="space-y-3 border-t border-[#f0eadc] pt-4 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="truncate text-sm font-bold text-[#293129]">{occasion.name}</h3>
              <Badge variant="outline" className="flex-none rounded-lg border-[#e6ddc9] bg-[#fffdf8] text-xs text-[#80621d]">
                {occasion.days?.length || 0} أيام
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
              {occasion.days?.map(day => {
                const isAvailable = Boolean(propertyData.availability[day.key]);
                return (
                  <div key={day.key} className="rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#293129]">{day.label}</span>
                      <Switch
                        checked={isAvailable}
                        onCheckedChange={(checked) => {
                          updateMutation.mutate({
                            occasionId: occasion.id,
                            data: {
                              availability: {
                                ...propertyData.availability,
                                [day.key]: checked,
                              },
                            },
                          });
                        }}
                        aria-label={`${day.label}: ${isAvailable ? "متوفر" : "غير متوفر"}`}
                      />
                    </div>
                    <label className="mb-1.5 block text-[11px] font-medium text-[#6f685b]" htmlFor={`occasion-${occasion.id}-${day.key}`}>
                      السعر
                    </label>
                    <OwnerInput
                      id={`occasion-${occasion.id}-${day.key}`}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      defaultValue={propertyData.prices[day.key] || ""}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value !== (propertyData.prices[day.key] || "")) {
                          updateMutation.mutate({
                            occasionId: occasion.id,
                            data: {
                              prices: {
                                ...propertyData.prices,
                                [day.key]: value,
                              },
                            },
                          });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-10 text-center text-xs"
                      dir="ltr"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
