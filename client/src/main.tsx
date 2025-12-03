import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";

// ✅ استيراد Google Analytics
import { initGA } from "./lib/analytics";

// ✅ تشغيل Google Analytics مرة واحدة عند تشغيل التطبيق
initGA();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
