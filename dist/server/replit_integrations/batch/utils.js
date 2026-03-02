"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRateLimitError = isRateLimitError;
exports.batchProcess = batchProcess;
exports.batchProcessWithSSE = batchProcessWithSSE;
const p_limit_1 = __importDefault(require("p-limit"));
const p_retry_1 = __importDefault(require("p-retry"));
/**
 * Check if an error is a rate limit or quota violation.
 * Use this in custom error handling if needed.
 */
function isRateLimitError(error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return (errorMsg.includes("429") ||
        errorMsg.includes("RATELIMIT_EXCEEDED") ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate limit"));
}
/**
 * Process items in batches with rate limiting and automatic retries.
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item (write your LLM logic here)
 * @param options - Concurrency and retry settings
 * @returns Promise resolving to array of results in the same order as input
 *
 * @example
 * // Process CSV artwork data with custom categorization
 * const categorized = await batchProcess(
 *   csvRows,
 *   async (row) => {
 *     const response = await openai.chat.completions.create({
 *       model: "gpt-5.1", // the newest OpenAI model
 *       messages: [{ role: "user", content: `Categorize artwork: ${row.name}` }],
 *       response_format: { type: "json_object" },
 *     });
 *     return { ...row, category: JSON.parse(response.choices[0]?.message?.content || "{}") };
 *   }
 * );
 */
async function batchProcess(items, processor, options = {}) {
    const { concurrency = 2, retries = 7, minTimeout = 2000, maxTimeout = 128000, onProgress, } = options;
    const limit = (0, p_limit_1.default)(concurrency);
    let completed = 0;
    const promises = items.map((item, index) => limit(() => (0, p_retry_1.default)(async () => {
        try {
            const result = await processor(item, index);
            completed++;
            onProgress === null || onProgress === void 0 ? void 0 : onProgress(completed, items.length, item);
            return result;
        }
        catch (error) {
            if (isRateLimitError(error)) {
                throw error; // Rethrow to trigger p-retry
            }
            // For non-rate-limit errors, abort immediately
            throw new p_retry_1.default.AbortError(error instanceof Error ? error : new Error(String(error)));
        }
    }, { retries, minTimeout, maxTimeout, factor: 2 })));
    return Promise.all(promises);
}
/**
 * Process items sequentially with SSE progress streaming.
 * Use this when you need real-time progress updates to the client.
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param sendEvent - Function to send SSE events to the client
 * @param options - Retry settings (concurrency is always 1 for sequential)
 */
async function batchProcessWithSSE(items, processor, sendEvent, options = {}) {
    const { retries = 5, minTimeout = 1000, maxTimeout = 15000 } = options;
    sendEvent({ type: "started", total: items.length });
    const results = [];
    let errors = 0;
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        sendEvent({ type: "processing", index, item });
        try {
            const result = await (0, p_retry_1.default)(() => processor(item, index), {
                retries,
                minTimeout,
                maxTimeout,
                factor: 2,
                onFailedAttempt: (error) => {
                    if (!isRateLimitError(error)) {
                        throw new p_retry_1.default.AbortError(error instanceof Error ? error : new Error(String(error)));
                    }
                },
            });
            results.push(result);
            sendEvent({ type: "progress", index, result });
        }
        catch (error) {
            errors++;
            results.push(undefined); // Placeholder for failed items
            sendEvent({
                type: "progress",
                index,
                error: error instanceof Error ? error.message : "Processing failed",
            });
        }
    }
    sendEvent({ type: "complete", processed: items.length, errors });
    return results;
}
