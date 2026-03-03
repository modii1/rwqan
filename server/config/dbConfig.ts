import { AsyncLocalStorage } from "node:async_hooks";
import { firebaseService } from "../firebaseService";
// Google Sheets kept as fallback reference - not actively used
// import { googleSheetsService } from "./googleSheets";

// Context for per-request database selection
export const dbContext = new AsyncLocalStorage<{ dbService: any }>();

// Always use Firebase - Google Sheets proxy removed
export const dbProxy = firebaseService as any;
