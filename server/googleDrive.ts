import { google } from 'googleapis';

class GoogleDriveService {
  private drive: any;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    
    this.drive = google.drive({ version: 'v3', auth });
  }

  async createPropertyFolder(propertyNumber: string, propertyName: string): Promise<string> {
    try {
      const folderMetadata = {
        name: `عقار ${propertyNumber} - ${propertyName}`,
        mimeType: 'application/vnd.google-apps.folder',
      };

      const folder = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id',
      });

      // Make folder publicly readable
      await this.drive.permissions.create({
        fileId: folder.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      return folder.data.id;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  async uploadImage(folderId: string, imageBuffer: Buffer, filename: string): Promise<string> {
    try {
      const fileMetadata = {
        name: filename,
        parents: [folderId],
      };

      const media = {
        mimeType: 'image/jpeg',
        body: imageBuffer,
      };

      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink',
      });

      // Make file publicly readable
      await this.drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      // Return direct image URL
      return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  }

  async listFolderImages(folderId: string): Promise<string[]> {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: 'files(id, name)',
        orderBy: 'createdTime',
      });

      const files = response.data.files || [];
      return files.map((file: any) => `https://drive.google.com/uc?export=view&id=${file.id}`);
    } catch (error) {
      console.error('Error listing images:', error);
      return [];
    }
  }

  async deleteImage(imageUrl: string): Promise<void> {
    try {
      // Extract file ID from URL
      const fileId = imageUrl.match(/id=([^&]+)/)?.[1];
      if (!fileId) {
        throw new Error('Invalid image URL');
      }

      await this.drive.files.delete({
        fileId: fileId,
      });
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
