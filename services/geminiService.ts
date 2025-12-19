import { GoogleGenAI, Type } from "@google/genai";
import { VideoMetadata } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Using gemini-3-flash-preview for efficiency in high-volume processing tasks.
const MODEL_NAME = 'gemini-3-flash-preview';

interface AnalysisResult {
  title?: string;
  transcription: string;
  summary: string;
  keywords: string[];
  scrapedData?: string;
}

export interface DiscoveredLink {
  url: string;
  title: string;
}

export const analyzeVideo = async (base64Data: string, mimeType: string): Promise<AnalysisResult> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: `Analyze this video content. 
            1. Provide a comprehensive transcription of any spoken audio. IMPORTANT: Include timestamps [MM:SS]. If there is no audio, describe the visuals in detail.
            2. Write a concise summary.
            3. Extract 5-10 relevant keywords.
            
            Return the result in JSON format.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcription: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["transcription", "summary", "keywords"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing video:", error);
    throw error;
  }
};

export const analyzeExternalVideo = async (url: string): Promise<AnalysisResult> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Analyze the following video URL: "${url}"
      Use 'googleSearch' to find the video title, description, transcript, and a content summary.
      Include social metadata (likes, views, creator) if visible in search results.
      Return JSON: {title, transcription, summary, keywords}`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            transcription: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "transcription", "summary", "keywords"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing external video:", error);
    throw error;
  }
};

export const analyzeWebContent = async (htmlContent: string, instruction: string, url: string): Promise<AnalysisResult> => {
  try {
    const prompt = `
      You are an expert web scraper. Context URL: ${url}. Extraction Goal: ${instruction || "General summary"}.
      Content: ${htmlContent.substring(0, 50000)} 
      Return JSON: {title, transcription, summary, scrapedData, keywords}
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            transcription: { type: Type.STRING },
            summary: { type: Type.STRING },
            scrapedData: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "transcription", "summary", "keywords"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing web content:", error);
    throw error;
  }
};

/**
 * Stage 1 Discovery: High-accuracy search for sub-pages.
 */
export const discoverSiteLinks = async (domainUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Perform a deep search for sub-pages of the domain "${domainUrl}".
      Queries: "site:${domainUrl}", "${domainUrl} articles", "${domainUrl} index", "${domainUrl} documentation".
      Aim to find at least 15-20 deep content pages (guides, blog posts, feature pages).
      Exclude utility pages like login, signup, privacy, or legal terms.
      Return JSON: { "links": [ {"url": "...", "title": "..."}, ... ] }`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            links: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  url: { type: Type.STRING },
                  title: { type: Type.STRING }
                },
                required: ["url", "title"]
              }
            }
          },
          required: ["links"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    const json = JSON.parse(text);
    return json.links || [];
  } catch (error) {
    console.error("Error in Search Discovery:", error);
    return [];
  }
}

/**
 * Phase 3: Hallucinate/Predict links if direct methods fail.
 */
export const predictCommonLinks = async (baseUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `The website at "${baseUrl}" is currently blocking automated crawlers.
      Based on the domain name and typical website patterns, predict the 10 most likely URLs for content pages (e.g., /blog, /docs, /about, /features, /news).
      Generate absolute URLs based on ${baseUrl}.
      Return JSON: { "links": [ {"url": "...", "title": "..."}, ... ] }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            links: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  url: { type: Type.STRING },
                  title: { type: Type.STRING }
                },
                required: ["url", "title"]
              }
            }
          },
          required: ["links"]
        }
      }
    });

    const text = response.text;
    return text ? JSON.parse(text).links : [];
  } catch {
    return [];
  }
};

/**
 * Intelligent Filter: Filters a raw list of strings/URLs into a structured discovery list.
 */
export const filterAndTitleLinks = async (links: string[], baseUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const prompt = `
      Clean and select the 15 most important content URLs from this raw list found on "${baseUrl}".
      Ignore: external sites, social media, small UI fragments (#), login, signup, or legal.
      Target: Articles, Documentation, Blog posts, Guides.
      
      URLs:
      ${links.join('\n')}
      
      Return JSON: { "links": [ {"url": "...", "title": "A short descriptive title for this page"}, ... ] }
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            links: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  url: { type: Type.STRING },
                  title: { type: Type.STRING }
                },
                required: ["url", "title"]
              }
            }
          },
          required: ["links"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    const json = JSON.parse(text);
    return json.links || [];
  } catch (error) {
    console.error("Error filtering links:", error);
    return [];
  }
};

export const askGlobalQuestion = async (query: string, videos: VideoMetadata[]) => {
  const context = videos.map(v => `
    Title: ${v.title}
    Summary: ${v.summary}
    Content Snippet: ${v.transcription.substring(0, 500)}...
  `).join('\n---\n');

  const prompt = `Answer this question based on the library context: "${query}"\n\nContext:\n${context}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    return "Error searching library context.";
  }
};

export const askVideoQuestion = async (query: string, video: VideoMetadata, fullTranscript: string) => {
    const prompt = `Analyze item "${video.title}". Content: ${fullTranscript}. Question: ${query}`;
    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
      });
      return response.text;
    } catch (error) {
      return "Error processing query.";
    }
  };