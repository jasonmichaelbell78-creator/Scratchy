export interface VideoMetadata {
  id: string;
  userId: string; // Added for user isolation
  title: string;
  fileName: string; // Acts as URL for web scrapes
  size: number;
  type: string; // 'video/mp4', 'external/url', 'web/scrape'
  uploadDate: number;
  transcription: string; // Stores the main body text/content for web scrapes
  summary: string;
  keywords: string[];
  externalUrl?: string; // For YouTube/TikTok links or Scraped URLs
  isExternal?: boolean; // Flag to identify non-local videos
  scrapedContent?: string; // Raw structured data or specific extraction results
}

export interface VideoFile extends VideoMetadata {
  // We keep the base64 data separate in memory/IDB to avoid bloating passing simple props
  base64Data?: string; 
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  relatedVideoIds?: string[]; // IDs of videos used for grounding
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  VIDEO_DETAIL = 'VIDEO_DETAIL',
  GLOBAL_CHAT = 'GLOBAL_CHAT',
}

export interface User {
  id: string;
  username: string;
}