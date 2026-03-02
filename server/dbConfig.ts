import { AsyncLocalStorage } from "node:async_hooks";
import { googleSheetsService } from "./googleSheets";
import { firebaseService } from "./firebaseService";

// Context for per-request database selection
// We use 'any' for dbService to allow both GoogleSheetsService and FirebaseService
export const dbContext = new AsyncLocalStorage<{ dbService: any }>();

// Proxy to switch between Google Sheets and Firebase for the service layer
export const dbProxy = new Proxy(firebaseService as any, {
    get(target, prop, receiver) {
        const context = dbContext.getStore();
        const service = context?.dbService || firebaseService;
        return Reflect.get(service, prop, receiver);
    }
});
