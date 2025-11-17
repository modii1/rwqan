import { google } from 'googleapis';

class GoogleDriveService {
  private async getDrive() {
    // Use Service Account for Drive access
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
      const folderMetadata = {
        name: `عقار ${propertyNumber} - ${propertyName}`,
        mimeType: 'application/vnd.google-apps.folder',
      };

      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id',
      });

      // Make folder publicly readable
      await drive.permissions.create({
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
      const drive = await this.getDrive();
      const fileMetadata = {
        name: filename,
        parents: [folderId],
      };

      const media = {
        mimeType: 'image/jpeg',
        body: imageBuffer,
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink',
      });

      // Make file publicly readable
      await drive.permissions.create({
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
      const drive = await this.getDrive();
      
      // First, check if we can access the folder itself
      try {
        const folderCheck = await drive.files.get({
          fileId: folderId,
          fields: 'id, name, permissions',
          supportsAllDrives: true,
        });
        console.log(`Folder ${folderId} accessible: ${folderCheck.data.name}`);
      } catch (err) {
        console.error(`Cannot access folder ${folderId}:`, err);
        return [];
      }
      
      const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: 'files(id, name, mimeType)',
        orderBy: 'createdTime',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = response.data.files || [];
      if (files.length > 0) {
        console.log(`Folder ${folderId}: Found ${files.length} images`);
      }
      return files.map((file: any) => `https://drive.google.com/uc?export=view&id=${file.id}`);
    } catch (error) {
      console.error('Error listing images for folder', folderId, ':', error);
      return [];
    }
  }

  async getPropertyFolderImages(propertyNumber: string): Promise<string[]> {
    try {
      const PARENT_FOLDER_ID = '169jrXmGGQ27mtjkubu-i762xwQQ3e1uE';
      const drive = await this.getDrive();
      
      // Find the subfolder for this property
      const folderResponse = await drive.files.list({
        q: `'${PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${propertyNumber}' and trashed=false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const folders = folderResponse.data.files || [];
      console.log(`Property ${propertyNumber}: Found ${folders.length} matching folders:`, folders.map((f: any) => f.name));
      
      if (folders.length === 0) {
        return [];
      }

      // Use the first matching folder
      const propertyFolderId = folders[0].id;
      
      // Now get images from that folder
      const imagesResponse = await drive.files.list({
        q: `'${propertyFolderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: 'files(id, name)',
        orderBy: 'createdTime',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const images = imagesResponse.data.files || [];
      console.log(`Property ${propertyNumber}: Found ${images.length} images in folder ${folders[0].name}`);
      
      // Make all images publicly accessible
      await Promise.all(
        images.map(async (file: any) => {
          try {
            await drive.permissions.create({
              fileId: file.id,
              requestBody: {
                role: 'reader',
                type: 'anyone',
              },
            });
          } catch (err) {
            // Ignore if already public
            console.log(`Image ${file.id} already public or error:`, err.message);
          }
        })
      );
      
      return images.map((file: any) => `https://drive.google.com/uc?export=view&id=${file.id}`);
    } catch (error) {
      console.error(`Error getting images for property ${propertyNumber}:`, error);
      return [];
    }
  }

  async deleteImage(imageUrl: string): Promise<void> {
    try {
      const drive = await this.getDrive();
      // Extract file ID from URL
      const fileId = imageUrl.match(/id=([^&]+)/)?.[1];
      if (!fileId) {
        throw new Error('Invalid image URL');
      }

      await drive.files.delete({
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
