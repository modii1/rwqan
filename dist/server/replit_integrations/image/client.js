"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openai = void 0;
exports.generateImageBuffer = generateImageBuffer;
exports.editImages = editImages;
const node_fs_1 = __importDefault(require("node:fs"));
const openai_1 = __importStar(require("openai"));
const node_buffer_1 = require("node:buffer");
exports.openai = new openai_1.default({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
/**
 * Generate an image and return as Buffer.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
async function generateImageBuffer(prompt, size = "1024x1024") {
    var _a, _b;
    const response = await exports.openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size,
    });
    const base64 = (_b = (_a = response.data[0]) === null || _a === void 0 ? void 0 : _a.b64_json) !== null && _b !== void 0 ? _b : "";
    return node_buffer_1.Buffer.from(base64, "base64");
}
/**
 * Edit/combine multiple images into a composite.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
async function editImages(imageFiles, prompt, outputPath) {
    var _a, _b;
    const images = await Promise.all(imageFiles.map((file) => (0, openai_1.toFile)(node_fs_1.default.createReadStream(file), file, {
        type: "image/png",
    })));
    const response = await exports.openai.images.edit({
        model: "gpt-image-1",
        image: images,
        prompt,
    });
    const imageBase64 = (_b = (_a = response.data[0]) === null || _a === void 0 ? void 0 : _a.b64_json) !== null && _b !== void 0 ? _b : "";
    const imageBytes = node_buffer_1.Buffer.from(imageBase64, "base64");
    if (outputPath) {
        node_fs_1.default.writeFileSync(outputPath, imageBytes);
    }
    return imageBytes;
}
