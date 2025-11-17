import { google } from 'googleapis';

// Helper to get access token from Replit connection
async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error('X_REPLIT_TOKEN or hostname not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch connection settings: ${response.statusText}`);
  }

  const data = await response.json();
  const connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings) {
    throw new Error('Google Sheet not connected or settings missing');
  }

  const accessToken = 
    connectionSettings.settings.access_token || 
    connectionSettings.settings.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error('Access token not found in connection settings');
  }

  return accessToken;
}

class GoogleDriveService {
  private async getDrive() {
    const accessToken = await getAccessToken();
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: accessToken
    });
    return google.drive({ version: 'v3', auth: oauth2Client });
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
      const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: 'files(id, name, mimeType)',
        orderBy: 'createdTime',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = response.data.files || [];
      console.log(`Folder ${folderId}: Found ${files.length} files:`, files.map((f: any) => f.name));
      return files.map((file: any) => `https://drive.google.com/uc?export=view&id=${file.id}`);
    } catch (error) {
      console.error('Error listing images for folder', folderId, ':', error);
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
