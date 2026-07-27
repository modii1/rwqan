"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, SlidersHorizontal } from "lucide-react";

interface FilterModalProps {
    showFilters: boolean;
    setShowFilters: (v: boolean) => void;
    selectedDirection: string;
    setSelectedDirection: (v: string) => void;
    selectedType: string;
    setSelectedType: (v: string) => void;
    maxPrice: number;
    maxPriceValue: number;
    setMaxPrice: (v: number) => void;
    selectedFacilities: string[];
    toggleFacility: (f: string) => void;
    clearFilters: () => void;
    hasActiveFilters: boolean;
    DIRECTIONS: string[];
    TYPES: string[];
    FACILITIES: string[];
}

export function FilterModal({
    showFilters,
    setShowFilters,
    selectedDirection,
    setSelectedDirection,
    selectedType,
    setSelectedType,
    maxPrice,
    maxPriceValue,
    setMaxPrice,
    selectedFacilities,
    toggleFacility,
    clearFilters,
    hasActiveFilters,
    DIRECTIONS,
    TYPES,
    FACILITIES,
}: FilterModalProps) {
    if (!showFilters) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black/50 z-50"
                onClick={() => setShowFilters(false)}
            />
            <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-2xl mx-auto z-50 bg-white rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
                <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                    <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-5 h-5 text-[#b88d2b]" />
                        <h3 className="text-lg font-bold text-[#1a1a1a]">تصفية العقارات</h3>
                    </div>
                    <button
                        onClick={() => setShowFilters(false)}
                        className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-[#6b6b6b] mb-2 block">الاتجاه</label>
                            <Select
                                value={selectedDirection || "all"}
                                onValueChange={(value) => setSelectedDirection(value === "all" ? "" : value)}
                            >
                                <SelectTrigger className="h-10 rounded-lg text-sm">
                                    <SelectValue placeholder="الاتجاه" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">الكل</SelectItem>
                                    {DIRECTIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-[#6b6b6b] mb-2 block">النوع</label>
                            <Select
                                value={selectedType || "all"}
                                onValueChange={(value) => setSelectedType(value === "all" ? "" : value)}
                            >
                                <SelectTrigger className="h-10 rounded-lg text-sm">
                                    <SelectValue placeholder="النوع" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">الكل</SelectItem>
                                    {TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-[#6b6b6b] mb-2 block">
                            السعر الأقصى: {maxPrice >= maxPriceValue ? "الكل" : `حتى ${maxPrice} ر.س`}
                        </label>
                        <div className="space-y-2 mt-2">
                            <input
                                type="range"
                                min={0}
                                max={maxPriceValue}
                                step={1}
                                value={maxPrice}
                                onChange={(e) => setMaxPrice(Number(e.target.value))}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#b88d2b]
                                    [&::-webkit-slider-thumb]:appearance-none
                                    [&::-webkit-slider-thumb]:w-5
                                    [&::-webkit-slider-thumb]:h-5
                                    [&::-webkit-slider-thumb]:rounded-full
                                    [&::-webkit-slider-thumb]:bg-[#b88d2b]
                                    [&::-webkit-slider-thumb]:border-2
                                    [&::-webkit-slider-thumb]:border-white
                                    [&::-webkit-slider-thumb]:shadow-md
                                    [&::-webkit-slider-thumb]:cursor-pointer
                                    [&::-webkit-slider-thumb]:transition-transform
                                    hover:[&::-webkit-slider-thumb]:scale-110
                                    active:[&::-webkit-slider-thumb]:scale-95
                                    [&::-moz-range-thumb]:w-5
                                    [&::-moz-range-thumb]:h-5
                                    [&::-moz-range-thumb]:rounded-full
                                    [&::-moz-range-thumb]:bg-[#b88d2b]
                                    [&::-moz-range-thumb]:border-2
                                    [&::-moz-range-thumb]:border-white
                                    [&::-moz-range-thumb]:shadow-md
                                    [&::-moz-range-thumb]:cursor-pointer"
                            />
                            <div className="flex justify-between text-xs text-[#9ca3af]">
                                <span>0</span>
                                <span>{maxPriceValue} ر.س</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-[#6b6b6b] mb-2 block">المرافق</label>
                        <div className="flex flex-wrap gap-2">
                            {FACILITIES.map(f => (
                                <button
                                    key={f}
                                    onClick={() => toggleFacility(f)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                        selectedFacilities.includes(f)
                                            ? "bg-[#b88d2b] text-white"
                                            : "bg-gray-100 text-[#6b6b6b] hover:bg-gray-200"
                                    }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-gray-100">
                        {hasActiveFilters && (
                            <Button
                                variant="outline"
                                onClick={clearFilters}
                                className="flex-1 rounded-full border-red-300 text-red-500 hover:bg-red-50"
                            >
                                مسح الفلاتر
                            </Button>
                        )}
                        <Button
                            onClick={() => setShowFilters(false)}
                            className="flex-1 rounded-full bg-[#b88d2b] hover:bg-[#9a7623] text-white"
                        >
                            تطبيق
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
