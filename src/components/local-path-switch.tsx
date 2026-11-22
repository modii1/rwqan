"use client";

/**
 * LOCAL-only OLD / NEW path switch.
 *
 * This is a thin client for the standalone switch service in
 * `C:\Users\zerof\Desktop\rwqan-switch` (127.0.0.1:5050). The browser never
 * runs Windows commands and never receives a path or a command: it can only
 * ask for one of the two fixed targets. The panel validates the request
 * origin, stops the previous server, starts the requested folder on its own
 * port, confirms an HTTP response, and only then reports success.
 *
 * Production safety:
 *  - `NODE_ENV === "production"` is replaced at build time, so this component
 *    renders nothing in TEST/LIVE bundles (fail closed).
 *  - The panel only accepts browser origins on localhost/127.0.0.1 ports
 *    5001/5002/5050, so a production page cannot call it even if it tried.
 *
 * Deploy bar and deploy services are NOT touched or imported here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, CircleAlert, Loader2, Server } from "lucide-react";

const PANEL_ORIGIN = "http://127.0.0.1:5050";
const PANEL_HINT = "start-panel.cmd";

const VERSIONS = {
    OLD: { key: "OLD", label: "OLD", title: "التصميم القديم", port: "5001", url: "http://localhost:5001" },
    NEW: { key: "NEW", label: "NEW", title: "التصميم الجديد 2027", port: "5002", url: "http://localhost:5002" },
} as const;

type VersionKey = keyof typeof VERSIONS;

type PanelTarget = {
    key: VersionKey;
    title: string;
    dir: string;
    port: number;
    url: string;
    expectedBranch: string;
    dirExists: boolean;
};

type PanelState = {
    active: VersionKey | null;
    status: "stopped" | "starting" | "running" | "stopping" | "error";
    pid: number | null;
    port: number | null;
    dir: string | null;
    branch: string | null;
    head: string | null;
    lastSwitchAt: string | null;
    startedAt: string | null;
    lastResult: { ok: boolean; message: string; at: string } | null;
    pendingTarget: VersionKey | null;
    busy: boolean;
    targets?: Record<string, PanelTarget>;
};

type Notice = { kind: "ok" | "err" | "info"; text: string } | null;

const STATUS_LABELS: Record<PanelState["status"], string> = {
    stopped: "متوقف",
    starting: "جارٍ التشغيل",
    running: "يعمل",
    stopping: "جارٍ الإيقاف",
    error: "خطأ",
};

function isLocalRuntime(): boolean {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    const port = window.location.port;
    const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    return localHost && (port === "5001" || port === "5002");
}

function currentVersionFromLocation(): VersionKey | null {
    if (typeof window === "undefined") return null;
    const port = window.location.port;
    if (port === "5001") return "OLD";
    if (port === "5002") return "NEW";
    return null;
}

async function fetchPanelStatus(timeoutMs = 3000): Promise<PanelState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${PANEL_ORIGIN}/api/status`, {
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { ok?: boolean; state?: PanelState; message?: string };
        if (!body.ok || !body.state) throw new Error(body.message || "unavailable");
        return body.state;
    } finally {
        clearTimeout(timer);
    }
}

function LocalPathSwitchInner() {
    const [mounted, setMounted] = useState(false);
    const [allowed, setAllowed] = useState(false);
    const [current, setCurrent] = useState<VersionKey | null>(null);
    const [panelState, setPanelState] = useState<PanelState | null>(null);
    const [panelDown, setPanelDown] = useState(false);
    const [switching, setSwitching] = useState<VersionKey | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const switchingRef = useRef<VersionKey | null>(null);

    useEffect(() => {
        setMounted(true);
        setAllowed(isLocalRuntime());
        setCurrent(currentVersionFromLocation());
    }, []);

    useEffect(() => {
        if (!allowed) return;
        let cancelled = false;

        const tick = async () => {
            try {
                const next = await fetchPanelStatus();
                if (cancelled) return;
                setPanelState(next);
                setPanelDown(false);
            } catch {
                if (cancelled) return;
                setPanelDown(true);
            }
        };

        void tick();
        const interval = window.setInterval(() => void tick(), 2500);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [allowed]);

    // Confirm the switch only from the panel's own state, never from the click.
    useEffect(() => {
        const target = switchingRef.current;
        if (!target || !panelState) return;
        if (panelState.status === "running" && panelState.active === target) {
            switchingRef.current = null;
            setSwitching(null);
            setNotice({ kind: "ok", text: `تم تأكيد تشغيل ${target} على ${VERSIONS[target].url}.` });
        } else if (panelState.status === "error" && !panelState.busy) {
            switchingRef.current = null;
            setSwitching(null);
            setNotice({ kind: "err", text: panelState.lastResult?.message || `فشل تشغيل ${target}.` });
        }
    }, [panelState]);

    const handleSwitch = useCallback(
        async (target: VersionKey) => {
            if (switchingRef.current) return;
            if (target === current) {
                setNotice({ kind: "info", text: `أنت الآن على ${target}.` });
                return;
            }

            // Open the follow-up tab synchronously (user gesture) so the page
            // that is about to be stopped is not responsible for the result.
            let tab: Window | null = null;
            try {
                tab = window.open("about:blank", "_blank");
            } catch {
                tab = null;
            }

            switchingRef.current = target;
            setSwitching(target);
            setNotice({
                kind: "info",
                text: `جارٍ التبديل إلى ${target}… ستُفتح نافذة متابعة تُظهر النتيجة.`,
            });

            try {
                await fetchPanelStatus(3000);
                const url = `${PANEL_ORIGIN}/switch?target=${target}`;
                if (tab && !tab.closed) {
                    tab.location.href = url;
                } else {
                    // Popup blocked: navigate this tab instead. It may be
                    // stopped by the switch; the panel page survives.
                    window.location.href = url;
                }
            } catch {
                if (tab && !tab.closed) tab.close();
                switchingRef.current = null;
                setSwitching(null);
                setNotice({
                    kind: "err",
                    text: `خدمة التبديل غير متاحة على ${PANEL_ORIGIN}. شغّلها بالأمر: ${PANEL_HINT}`,
                });
            }
        },
        [current],
    );

    if (!mounted || !allowed) return null;

    const panelStatus = panelState?.status ?? null;
    const activeKey = panelState?.active ?? null;
    const busy = Boolean(panelState?.busy) || Boolean(switching);
    const pending = switching ?? panelState?.pendingTarget ?? null;

    const badgeTone =
        panelDown
            ? "border-red-300 bg-red-50 text-red-700"
            : panelStatus === "running"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : panelStatus === "error"
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-amber-300 bg-amber-50 text-amber-800";

    return (
        <div
            dir="rtl"
            data-testid="local-path-switch"
            className="fixed bottom-3 right-3 z-[90] w-[290px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-stone-300 bg-white/95 p-3 text-stone-900 shadow-lg backdrop-blur"
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600">
                    <Server className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>المسار المحلي</span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-extrabold text-stone-500">
                        LOCAL
                    </span>
                </div>
                <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeTone}`}
                >
                    {panelDown ? (
                        <>
                            <CircleAlert className="h-3 w-3" aria-hidden="true" />
                            الخدمة غير متاحة
                        </>
                    ) : panelStatus === "running" ? (
                        <>
                            <Check className="h-3 w-3" aria-hidden="true" />
                            {activeKey ?? "—"} يعمل
                        </>
                    ) : (
                        <>{panelStatus ? STATUS_LABELS[panelStatus] : "…"}</>
                    )}
                </span>
            </div>

            <div className="mb-2 text-[11px] leading-5 text-stone-600">
                النسخة الحالية:{" "}
                <span className="font-extrabold text-stone-900">{current ?? "—"}</span>
                {panelState?.port ? (
                    <span className="text-stone-500"> · المنفذ {panelState.port}</span>
                ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
                {(Object.keys(VERSIONS) as VersionKey[]).map((key) => {
                    const isCurrent = current === key;
                    const isActive = activeKey === key && panelStatus === "running";
                    const isPending = pending === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            data-testid={`local-switch-${key}`}
                            disabled={busy || isCurrent}
                            onClick={() => void handleSwitch(key)}
                            className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-right transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                key === "NEW"
                                    ? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                                    : "border-amber-300 bg-amber-50 hover:bg-amber-100"
                            } ${isActive ? "ring-2 ring-emerald-500" : ""}`}
                        >
                            <span className="flex items-center gap-1 text-xs font-extrabold">
                                {isPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : isCurrent ? (
                                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                ) : (
                                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                {VERSIONS[key].label}
                            </span>
                            <span className="text-[10px] text-stone-600">{VERSIONS[key].title}</span>
                            <span className="text-[10px] text-stone-500">المنفذ {VERSIONS[key].port}</span>
                        </button>
                    );
                })}
            </div>

            {notice ? (
                <div
                    data-testid="local-switch-notice"
                    aria-live="polite"
                    className={`mt-2 rounded-md px-2 py-1.5 text-[11px] leading-5 ${
                        notice.kind === "ok"
                            ? "bg-emerald-50 text-emerald-800"
                            : notice.kind === "err"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-800"
                    }`}
                >
                    {notice.text}
                </div>
            ) : panelDown ? (
                <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-800">
                    شغّل خدمة التبديل بالأمر: <code className="font-mono">{PANEL_HINT}</code>
                </div>
            ) : null}

            {switching ? (
                <div className="mt-1 text-[10px] text-stone-500">
                    لا تُغلق نافذة المتابعة — الصفحة الحالية ستُغلق عند إيقاف خادمها.
                </div>
            ) : null}
        </div>
    );
}

export function LocalPathSwitch() {
    // Build-time gate: production bundles get `if ("production" === "production")`.
    if (process.env.NODE_ENV === "production") return null;
    return <LocalPathSwitchInner />;
}
