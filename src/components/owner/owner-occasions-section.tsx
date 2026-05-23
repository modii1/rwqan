"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Loader2, Star } from "lucide-react";
import type { Occasion, OccasionProperty } from "@shared/schema";

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
        <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
      </div>
    );
  }

  if (occasionsData.length === 0) {
    return null; // Don't show section if no active occasions
  }

  return (
    <Card className="p-4 md:p-6 border-2 border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50/50 to-yellow-50/50 dark:from-amber-950/30 dark:to-yellow-950/30">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
          <Star className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <h2 className="font-bold text-base md:text-lg text-amber-700 dark:text-amber-400">
            عروض المناسبات
          </h2>
          <p className="text-xs text-muted-foreground">حدّث أسعارك وتوفرك لأيام المناسبة</p>
        </div>
      </div>

      {occasionsData.map(({ occasion, propertyData, isEnrolled }) => {
        if (!isEnrolled || !propertyData) {
          return (
            <div key={occasion.id} className="text-center py-4 text-sm text-muted-foreground">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>عقارك غير مسجل في {occasion.name}</p>
              <p className="text-xs">تواصل مع الإدارة للانضمام</p>
            </div>
          );
        }

        return (
          <div key={occasion.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{occasion.name}</h3>
              <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                {occasion.days?.length || 0} أيام
              </Badge>
            </div>

            {/* Availability Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {occasion.days?.map(day => (
                      <th key={day.key} className="text-center py-2 px-2 font-medium text-xs whitespace-nowrap">
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Availability Row */}
                  <tr className="border-b">
                    {occasion.days?.map(day => (
                      <td key={day.key} className="text-center py-3 px-2">
                        <button
                          onClick={() => {
                            const newAvailability = {
                              ...propertyData.availability,
                              [day.key]: !propertyData.availability[day.key],
                            };
                            updateMutation.mutate({
                              occasionId: occasion.id,
                              data: { availability: newAvailability },
                            });
                          }}
                          className={`w-8 h-8 rounded-full border-2 transition-all mx-auto ${
                            propertyData.availability[day.key]
                              ? "bg-green-500 border-green-600 shadow-sm shadow-green-200"
                              : "bg-gray-200 border-gray-300"
                          }`}
                          title={propertyData.availability[day.key] ? "متوفر - اضغط لإلغاء" : "غير متوفر - اضغط للتفعيل"}
                        />
                      </td>
                    ))}
                  </tr>
                  {/* Price Row */}
                  <tr>
                    {occasion.days?.map(day => (
                      <td key={day.key} className="text-center py-2 px-1">
                        <Input
                          type="text"
                          placeholder="السعر"
                          defaultValue={propertyData.prices[day.key] || ""}
                          onBlur={(e) => {
                            const val = e.target.value;
                            if (val !== (propertyData.prices[day.key] || "")) {
                              const newPrices = {
                                ...propertyData.prices,
                                [day.key]: val,
                              };
                              updateMutation.mutate({
                                occasionId: occasion.id,
                                data: { prices: newPrices },
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="w-16 md:w-20 text-center text-xs h-8 mx-auto"
                          dir="ltr"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>متوفر</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-gray-300" />
                <span>غير متوفر</span>
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
