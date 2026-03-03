/**
 * ContentService
 * Blog post management and property SEO data.
 */

import { firebaseService } from "../firebaseService";

export class ContentService {
  // ─── Blog Posts ──────────────────────────────────────────────────────────────

  async getAllPosts(onlyPublished = false) {
    return firebaseService.getBlogPosts(onlyPublished);
  }

  async getPostBySlug(slug: string) {
    return firebaseService.getBlogPostBySlug(slug);
  }

  async getPostById(id: string) {
    return firebaseService.getBlogPostById(id);
  }

  async createPost(data: any): Promise<string> {
    return firebaseService.createBlogPost(data);
  }

  async updatePost(id: string, updates: any): Promise<boolean> {
    return firebaseService.updateBlogPost(id, updates);
  }

  async deletePost(id: string): Promise<boolean> {
    return firebaseService.deleteBlogPost(id);
  }

  // ─── Property SEO ──────────────────────────────────────────────────────────

  async getPropertySeo(propertyNumber: string) {
    return firebaseService.getPropertySeo(propertyNumber);
  }

  async updatePropertySeo(propertyNumber: string, seoData: any) {
    return firebaseService.updatePropertySeo(propertyNumber, seoData);
  }
}

export const contentService = new ContentService();
