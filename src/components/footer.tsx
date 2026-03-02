"use client";

export function Footer() {
    return (
        <footer className="bg-transparent py-0 mt-auto">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex flex-col items-center gap-1">
                    <img
                        src="/assets/logo-full.png"
                        alt="روقـان"
                        className="h-[300px] w-auto mt-[-52px] mb-[-52px] ml-[0px] mr-[0px] pl-[10px] pr-[10px] pt-[-2px] pb-[-2px]"
                    />
                    <p className="text-center text-xs text-gray-400">
                        روقـان | نُـزل ورفـاهية - للشاليهات والاستراحات والعقارات
                    </p>
                    <p className="text-xs text-gray-500">
                        © {new Date().getFullYear()} روقـان
                    </p>
                </div>
            </div>
        </footer>
    );
}
