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
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleDriveService = void 0;
const googleapis_1 = require("googleapis");
class GoogleDriveService {
    async getDrive() {
        const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (!serviceAccountKey) {
            throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment variables');
        }
        let credentials;
        try {
            credentials = JSON.parse(serviceAccountKey);
        }
        catch (error) {
            throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON format');
        }
        const auth = new googleapis_1.google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive'],
        });
        return googleapis_1.google.drive({ version: 'v3', auth });
    }
    async createPropertyFolder(propertyNumber, propertyName) {
        try {
            const drive = await this.getDrive();
            const folder = await drive.files.create({
                requestBody: {
                    name: `عقار ${propertyNumber} - ${propertyName}`,
                    mimeType: 'application/vnd.google-apps.folder',
                },
                fields: 'id',
            });
            await drive.permissions.create({
                fileId: folder.data.id,
                requestBody: { role: 'reader', type: 'anyone' },
            });
            return folder.data.id;
        }
        catch (error) {
            console.error('Error creating folder:', error);
            throw error;
        }
    }
    async uploadImage(folderId, imageBuffer, filename) {
        try {
            const { Readable } = await Promise.resolve().then(() => __importStar(require('stream')));
            const drive = await this.getDrive();
            const file = await drive.files.create({
                requestBody: { name: filename, parents: [folderId] },
                media: { mimeType: 'image/jpeg', body: Readable.from(imageBuffer) },
                fields: 'id',
            });
            await drive.permissions.create({
                fileId: file.data.id,
                requestBody: { role: 'reader', type: 'anyone' },
            });
            return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
        }
        catch (error) {
            console.error('Error uploading image:', error);
            throw error;
        }
    }
    async listFolderImages(folderId) {
        try {
            const drive = await this.getDrive();
            const response = await drive.files.list({
                q: `'${folderId}' in parents AND mimeType contains 'image/' AND trashed=false`,
                fields: 'files(id, name)',
                orderBy: 'createdTime',
                supportsAllDrives: true,
            });
            return response.data.files ?? [];
        }
        catch (error) {
            console.error(`Error listing images for folder ${folderId}:`, error);
            return [];
        }
    }
    async getPropertyFolderImages(propertyNumber) {
        try {
            const PARENT_FOLDER_ID = '169jrXmGGQ27mtjkubu-i762xwQQ3e1uE';
            const drive = await this.getDrive();
            const folderResponse = await drive.files.list({
                q: `'${PARENT_FOLDER_ID}' in parents AND mimeType='application/vnd.google-apps.folder' AND name contains '${propertyNumber}' AND trashed=false`,
                fields: 'files(id)',
                supportsAllDrives: true,
            });
            const folders = folderResponse.data.files ?? [];
            if (folders.length === 0)
                return [];
            const folderId = folders[0].id;
            const imagesResponse = await drive.files.list({
                q: `'${folderId}' in parents AND mimeType contains 'image/' AND trashed=false`,
                fields: 'files(id)',
                orderBy: 'createdTime',
            });
            const images = imagesResponse.data.files ?? [];
            return images.map(file => `https://lh3.googleusercontent.com/d/${file.id}`);
        }
        catch (error) {
            console.error(`Error getting images for property ${propertyNumber}:`, error);
            return [];
        }
    }
    async deleteImage(imageUrl) {
        try {
            const drive = await this.getDrive();
            let fileId;
            const match1 = imageUrl.match(/id=([^&]+)/);
            const match2 = imageUrl.match(/googleusercontent\.com\/d\/([^/?]+)/);
            if (match1)
                fileId = match1[1];
            else if (match2)
                fileId = match2[1];
            if (!fileId)
                throw new Error('Invalid image URL format');
            await drive.files.delete({ fileId: fileId });
        }
        catch (error) {
            console.error('Error deleting image:', error);
            throw error;
        }
    }
    async getFolderUrl(folderId) {
        return `https://drive.google.com/drive/folders/${folderId}`;
    }
}
exports.googleDriveService = new GoogleDriveService();
