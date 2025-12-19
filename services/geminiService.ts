import { GoogleGenAI, Type } from "@google/genai";
import { VideoMetadata } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Using gemini-3-flash-preview for efficiency and large context window.
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
      contents: `Deeply analyze the video URL: "${url}"
      Use 'googleSearch' to find title, description, and content details.
      Provide a "transcription" which is a detailed scene-by-scene description or transcript.
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
      Expert web content analyst. URL: ${url}. 
      Extraction Instruction: ${instruction || "Provide a full-text transcription and a detailed technical summary."}.
      
      CONTENT TO ANALYZE:
      ${htmlContent.substring(0, 100000)} 
      
      Return JSON with:
      - title: The page title.
      - transcription: THE FULL TEXT CONTENT of the page (articles, body, details). 
      - summary: A concise 2-sentence overview.
      - keywords: List of 5-8 relevant tags.
      - scrapedData: Specific technical data or key points.
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

export const discoverSiteLinks = async (domainUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const cleanDomain = domainUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Perform a deep audit of "${cleanDomain}". 
      I need at least 50+ deep content URLs (blog posts, individual prompt pages, articles). 
      Look for deep nesting and pagination like /prompts/1, /prompts/page/2, etc. 
      Search Queries: "site:${cleanDomain} inurl:prompts", "site:${cleanDomain} sitemap", "${cleanDomain} deep index".
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

    let links: DiscoveredLink[] = [];
    try {
        const json = JSON.parse(response.text || '{}');
        if (json.links) links = json.links;
    } catch (e) {}

    const metadata = response.candidates?.[0]?.groundingMetadata;
    const chunks = metadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
        const uri = chunk.web?.uri;
        if (uri && (uri.includes(cleanDomain))) {
            if (!links.some(l => l.url === uri)) {
                links.push({ url: uri, title: chunk.web.title || uri });
            }
        }
    });

    const seen = new Set();
    return links.filter(l => {
        const url = l.url.split('#')[0].split('?')[0];
        const isNew = !seen.has(url);
        seen.add(url);
        return isNew;
    });
  } catch (error) {
    console.error("Discovery error:", error);
    return [];
  }
}

export const predictCommonLinks = async (baseUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Predict 25 deep content URLs for site "${cleanBase}". Focus on /prompts, /blog, /articles, /documentation.
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
    return JSON.parse(response.text || '{}').links || [];
  } catch { return []; }
};

export const filterAndTitleLinks = async (links: string[], baseUrl: string): Promise<DiscoveredLink[]> => {
  try {
    const prompt = `
      Select the 40 most content-heavy pages from this list for "${baseUrl}". 
      Ignore simple layout fragments and social links.
      
      LIST:
      ${links.join('\n')}
      
      Return JSON: { "links": [ {"url": "...", "title": "..."}, ... ] }
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
    return JSON.parse(response.text || '{}').links || [];
  } catch (error) { return []; }
};

export const askGlobalQuestion = async (query: string, videos: VideoMetadata[]) => {
  const context = videos.map(v => `Title: ${v.title}\nSummary: ${v.summary}\nContent: ${v.transcription.substring(0, 500)}`).join('\n---\n');
  const prompt = `Answer based on Knowledge Base: "${query}"\n\nContext:\n${context}`;
  try {
    const response = await ai.models.generateContent({ model: MODEL_NAME, contents: prompt });
    return response.text;
  } catch { return "Query failed."; }
};

export const askVideoQuestion = async (query: string, video: VideoMetadata, fullTranscript: string) => {
    const prompt = `Analyze item "${video.title}". Content: ${fullTranscript}. Question: ${query}`;
    try {
      const response = await ai.models.generateContent({ model: MODEL_NAME, contents: prompt });
      return response.text;
    } catch { return "Node-specific search failed."; }
};