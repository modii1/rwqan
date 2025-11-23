import { google } from 'googleapis';

class GoogleDriveService {
  private async getDrive() {
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountKey) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment variables');
    }

    let credentials;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch (error) {
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON format');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return google.drive({ version: 'v3', auth });
  }

  async createPropertyFolder(propertyNumber: string, propertyName: string): Promise<string> {
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

      return folder.data.id!;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  async uploadImage(folderId: string, imageBuffer: Buffer, filename: string): Promise<string> {
    try {
      const { Readable } = await import('stream');
      const drive = await this.getDrive();

      const file = await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { mimeType: 'image/jpeg', body: Readable.from(imageBuffer) },
        fields: 'id',
      });

      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: { role: 'reader', type: 'anyone' },
      });

      return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  }

  async listFolderImages(folderId: string): Promise<any[]> {
    try {
      const drive = await this.getDrive();

      const response = await drive.files.list({
        q: `'${folderId}' in parents AND mimeType contains 'image/' AND trashed=false`,
        fields: 'files(id, name)',
        orderBy: 'createdTime',
        supportsAllDrives: true,
      });

      return response.data.files ?? [];
    } catch (error) {
      console.error(`Error listing images for folder ${folderId}:`, error);
      return [];
    }
  }

  async getPropertyFolderImages(propertyNumber: string): Promise<string[]> {
    try {
      const PARENT_FOLDER_ID = '169jrXmGGQ27mtjkubu-i762xwQQ3e1uE';
      const drive = await this.getDrive();

      const folderResponse = await drive.files.list({
        q: `'${PARENT_FOLDER_ID}' in parents AND mimeType='application/vnd.google-apps.folder' AND name contains '${propertyNumber}' AND trashed=false`,
        fields: 'files(id)',
        supportsAllDrives: true,
      });

      const folders = folderResponse.data.files ?? [];
      if (folders.length === 0) return [];

      const folderId = folders[0].id;

      const imagesResponse = await drive.files.list({
        q: `'${folderId}' in parents AND mimeType contains 'image/' AND trashed=false`,
        fields: 'files(id)',
        orderBy: 'createdTime',
      });

      const images = imagesResponse.data.files ?? [];

      return images.map(file => `https://lh3.googleusercontent.com/d/${file.id}`);
    } catch (error) {
      console.error(`Error getting images for property ${propertyNumber}:`, error);
      return [];
    }
  }

  async deleteImage(imageUrl: string): Promise<void> {
    try {
      const drive = await this.getDrive();

      let fileId: string | undefined;

      const match1 = imageUrl.match(/id=([^&]+)/);
      const match2 = imageUrl.match(/googleusercontent\.com\/d\/([^/?]+)/);

      if (match1) fileId = match1[1];
      else if (match2) fileId = match2[1];

      if (!fileId) throw new Error('Invalid image URL format');

      await drive.files.delete({ fileId });
    } catch (error) {
      console.error('Error deleting image:', error);
      throw error;
    }
  }

  async getFolderUrl(folderId: string): Promise<string> {
    return `https://drive.google.com/drive/folders/${folderId}`;
  }
}

export const googleDriveService = new GoogleDriveService();
