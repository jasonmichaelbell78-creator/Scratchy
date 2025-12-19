import React, { useCallback, useState, useEffect } from 'react';
import { analyzeVideo, analyzeExternalVideo, analyzeWebContent, discoverSiteLinks, filterAndTitleLinks, predictCommonLinks, DiscoveredLink } from '../services/geminiService';
import { saveVideoToDB } from '../services/idbService';
import { VideoMetadata } from '../types';

const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

interface UploaderProps {
  userId: string;
  onUploadComplete: () => void;
  initialUrl?: string | null;
}

export const Uploader: React.FC<UploaderProps> = ({ userId, onUploadComplete, initialUrl }) => {
  const [mode, setMode] = useState<'upload' | 'url' | 'scrape'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [scrapeInstruction, setScrapeInstruction] = useState('');
  
  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Discovery Mode States
  const [discoveryMode, setDiscoveryMode] = useState(false);
  const [discoveredLinks, setDiscoveredLinks] = useState<DiscoveredLink[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialUrl) {
      setMode('url');
      setUrlInput(initialUrl);
    }
  }, [initialUrl]);

  const fetchWithProxy = async (url: string) => {
    const proxyStrategies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      `https://thingproxy.freeboard.io/fetch/${url}`,
      `https://proxy.cors.sh/${url}` // Added another popular proxy
    ];

    for (const proxy of proxyStrategies) {
      try {
        const res = await fetch(proxy);
        if (res.ok) {
          const text = await res.text();
          // Check for meaningful content, some proxies return error HTML even with 200 OK
          if (text.length > 500 && !text.toLowerCase().includes("access denied") && !text.toLowerCase().includes("please enable javascript")) {
            return text;
          }
        }
      } catch (e) { console.debug(`Proxy attempt failed: ${proxy}`); }
    }
    return null;
  };

  const cleanHtml = (html: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Aggressive cleaning for AI context tokens
    doc.querySelectorAll('script, style, svg, noscript, iframe, link, meta, head, nav, footer, button, select, aside, .ad, .social').forEach(el => el.remove());
    return doc.body.innerText || doc.body.textContent || "";
  };

  const performAnalysisAndSave = async (base64Data: string, type: string, name: string, size: number) => {
      setProgressStep('Analyzing Intelligence...');
      const analysis = await analyzeVideo(base64Data, type);
      const newVideo: VideoMetadata = {
        id: generateId(),
        userId,
        title: name,
        fileName: name,
        size: size,
        type: type,
        uploadDate: Date.now(),
        transcription: analysis.transcription,
        summary: analysis.summary,
        keywords: analysis.keywords,
        isExternal: false
      };
      await saveVideoToDB(newVideo, base64Data);
      onUploadComplete();
  };

  const processSocialUrl = async (url: string) => {
    setProgressStep('Mapping External DNA...');
    setProgress(30);
    try {
      const analysis = await analyzeExternalVideo(url);
      const newVideo: VideoMetadata = {
        id: generateId(),
        userId,
        title: analysis.title || "External Content",
        fileName: url,
        size: 0,
        type: 'external/url',
        uploadDate: Date.now(),
        transcription: analysis.transcription,
        summary: analysis.summary,
        keywords: analysis.keywords,
        externalUrl: url,
        isExternal: true
      };
      await saveVideoToDB(newVideo);
      onUploadComplete();
      setUrlInput('');
    } catch (err) {
      setError("Failed to ground remote media. Ensure the URL is public.");
    }
  };

  const processWebScrape = async (url: string, instruction: string = '') => {
    const rawHtml = await fetchWithProxy(url);
    if (!rawHtml) throw new Error("Crawl blocked by server.");
    const textContent = cleanHtml(rawHtml);
    const analysis = await analyzeWebContent(textContent, instruction, url);
    const newEntry: VideoMetadata = {
      id: generateId(),
      userId,
      title: analysis.title || "Web Node",
      fileName: url,
      size: textContent.length,
      type: 'web/scrape',
      uploadDate: Date.now(),
      transcription: analysis.transcription,
      summary: analysis.summary,
      keywords: analysis.keywords,
      externalUrl: url,
      isExternal: true,
      scrapedContent: analysis.scrapedData
    };
    await saveVideoToDB(newEntry);
  };

  const handleScanSite = async () => {
    if (!urlInput.trim()) return;
    setIsProcessing(true);
    setProgress(10);
    setProgressStep("Phase 1: Search Grounding...");
    setError(null);
    setDiscoveredLinks([]);
    setSelectedLinks(new Set());

    try {
      // Step 1: Broad Search Discovery
      let links = await discoverSiteLinks(urlInput);
      
      // Step 2: Homepage Crawl Fallback
      if (links.length === 0) {
        setProgress(40);
        setProgressStep("Phase 2: Deep DOM Extraction...");
        const rawHtml = await fetchWithProxy(urlInput);
        if (rawHtml) {
            const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
            const anchors = Array.from(doc.querySelectorAll('a'));
            const domain = new URL(urlInput).hostname.replace('www.', '');
            
            const rawUrls = anchors
                .map(a => {
                    try {
                        const href = a.getAttribute('href') || '';
                        // Relative to Absolute
                        return new URL(href, urlInput).href;
                    } catch { return ''; }
                })
                .filter(u => {
                    try {
                        const uObj = new URL(u);
                        // Stay on same domain, ignore hashes/queries that don't change path
                        return uObj.hostname.includes(domain) && !u.includes('#') && uObj.pathname.length > 1;
                    } catch { return false; }
                });
            
            const uniqueRaw = Array.from(new Set(rawUrls)).slice(0, 80);
            
            if (uniqueRaw.length > 0) {
                setProgressStep("Phase 2: Refining Content Paths...");
                links = await filterAndTitleLinks(uniqueRaw, urlInput);
            }
        }
      }

      // Step 3: Pattern Hallucination (Prediction)
      if (links.length === 0) {
        setProgress(80);
        setProgressStep("Phase 3: Predicting Content Structure...");
        links = await predictCommonLinks(urlInput);
      }

      if (links.length === 0) {
        setError("Zero paths found. Domain may be strictly protected.");
      } else {
        setDiscoveredLinks(links);
        setSelectedLinks(new Set(links.map(l => l.url)));
      }
    } catch (e: any) {
      setError("Discovery Fault: " + e.message);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleBatchScrape = async () => {
    if (selectedLinks.size === 0) return;
    setIsProcessing(true);
    const urls = Array.from(selectedLinks) as string[];
    let count = 0;
    for (const url of urls) {
      setProgressStep(`Ingesting: ${count + 1}/${urls.length}...`);
      try { await processWebScrape(url, scrapeInstruction); } catch {}
      count++;
      setProgress(Math.round((count / urls.length) * 100));
    }
    setIsProcessing(false);
    onUploadComplete();
    setDiscoveredLinks([]);
    setUrlInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);
    try {
      if (mode === 'scrape') {
        setProgressStep('Ingesting Page...');
        await processWebScrape(urlInput, scrapeInstruction);
        onUploadComplete();
        setUrlInput('');
      } else {
        const isSocial = /(youtube|youtu\.be|tiktok|instagram|vimeo|facebook|x\.com|twitter|linkedin)/i.test(urlInput);
        if (isSocial) {
            await processSocialUrl(urlInput);
        } else {
             setProgressStep('Downloading Binary...');
             const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(urlInput)}`);
             if (!res.ok) throw new Error("Direct download blocked.");
             const blob = await res.blob();
             if (blob.type.includes('html')) {
                 setMode('scrape');
                 setError("URL redirected to webpage. Use Scraper.");
                 setIsProcessing(false);
                 return;
             }
             const b64 = await new Promise<string>((resolve) => {
                 const r = new FileReader(); r.onload = () => resolve((r.result as string).split(',')[1]); r.readAsDataURL(blob);
             });
             await performAnalysisAndSave(b64, blob.type, "Imported", blob.size);
             setUrlInput('');
        }
      }
    } catch (err: any) {
        setError(err.message || "Operation failed.");
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className="w-full">
      {!isProcessing && (
        <div className="flex mb-8 bg-slate-800/80 backdrop-blur-md p-1.5 rounded-2xl w-fit mx-auto gap-2 shadow-2xl border border-slate-700">
            {['upload', 'url', 'scrape'].map((m: any) => (
                <button 
                  key={m} 
                  onClick={() => { setMode(m); setError(null); }} 
                  className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${mode === m ? 'bg-primary text-white shadow-[0_0_20px_rgba(99,102,241,0.4)]' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    {m}
                </button>
            ))}
        </div>
      )}

      {isProcessing ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-[2rem] p-16 text-center shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-8 shadow-[0_0_30px_rgba(99,102,241,0.2)]"></div>
          <p className="text-white font-black uppercase tracking-[0.3em] text-[10px] animate-pulse mb-8">{progressStep}</p>
          <div className="max-w-sm mx-auto bg-slate-800 h-2 rounded-full overflow-hidden shadow-inner">
             <div className="bg-gradient-to-r from-primary to-secondary h-full transition-all duration-1000 ease-out" style={{width: `${progress || 15}%`}}></div>
          </div>
        </div>
      ) : (
        <div className="w-full animate-fade-in">
            {mode === 'upload' && (
                <div 
                  onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && handleSubmit(e as any); }} 
                  onDragOver={(e) => e.preventDefault()} 
                  className="border-2 border-dashed border-slate-700 rounded-[2rem] p-16 text-center hover:bg-slate-800/40 hover:border-primary/50 transition-all duration-500 group cursor-pointer"
                >
                    <div className="w-24 h-24 bg-slate-800 rounded-3xl flex items-center justify-center mx-auto mb-8 text-primary group-hover:scale-110 group-hover:rotate-3 transition-all shadow-2xl group-hover:shadow-primary/20">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                    </div>
                    <label className="bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-[0.2em] text-[10px] py-5 px-12 rounded-2xl cursor-pointer shadow-[0_10px_30px_rgba(99,102,241,0.3)] inline-block transition-all transform hover:-translate-y-1 active:scale-95">
                        SELECT BINARY
                        <input type="file" className="hidden" accept="video/*" onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                const reader = new FileReader();
                                reader.onload = async () => {
                                    setIsProcessing(true);
                                    const b64 = (reader.result as string).split(',')[1];
                                    await performAnalysisAndSave(b64, e.target.files![0].type, e.target.files![0].name.split('.')[0], e.target.files![0].size);
                                    setIsProcessing(false);
                                };
                                reader.readAsDataURL(e.target.files[0]);
                            }
                        }} />
                    </label>
                    <p className="mt-6 text-slate-500 text-[10px] font-bold uppercase tracking-widest opacity-40">Drag & Drop Supported</p>
                </div>
            )}

            {mode === 'url' && (
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-[2rem] p-14 text-center shadow-2xl">
                    <h3 className="text-sm font-black mb-8 uppercase tracking-[0.4em] text-slate-500">Remote Media Pipeline</h3>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-md mx-auto">
                        <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="YouTube, TikTok, or MP4..." className="bg-slate-900/80 border border-slate-700 rounded-2xl px-8 py-5 text-white focus:outline-none focus:border-primary transition-all placeholder:text-slate-700 font-medium text-sm shadow-inner" required />
                        <button type="submit" className="bg-primary py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-[0_15px_40px_rgba(99,102,241,0.3)] transition-all hover:bg-primary/80 transform hover:-translate-y-1">Initialize Stream</button>
                    </form>
                </div>
            )}

            {mode === 'scrape' && (
                <div className="bg-teal-900/5 border border-teal-500/10 rounded-[2.5rem] p-10 text-center w-full max-w-2xl mx-auto shadow-[0_30px_60px_rgba(0,0,0,0.4)]">
                    {!discoveryMode && discoveredLinks.length === 0 ? (
                      <div className="max-w-md mx-auto text-left flex flex-col gap-8">
                        <div className="text-center">
                            <h3 className="text-3xl font-black text-teal-400 uppercase tracking-tighter mb-2">Web Hive</h3>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest opacity-60">Autonomous knowledge ingestion.</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-6">Target Domain</label>
                            <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://docs.example.com" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-8 py-5 text-white focus:border-teal-500 focus:outline-none transition-all shadow-inner" required />
                        </div>
                        <label className="flex items-center gap-5 text-sm text-slate-400 bg-slate-950/40 p-6 rounded-2xl cursor-pointer hover:bg-slate-900/60 transition-all border border-transparent hover:border-teal-500/30 group">
                            <input type="checkbox" checked={discoveryMode} onChange={(e) => setDiscoveryMode(e.target.checked)} className="w-6 h-6 rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500" />
                            <div className="flex-1">
                                <span className="block font-black uppercase text-[10px] tracking-widest text-slate-300 group-hover:text-teal-400 transition-colors">Recursive Scan</span>
                                <span className="text-[9px] opacity-40 font-bold uppercase tracking-tighter">Auto-discover content nodes across domain.</span>
                            </div>
                        </label>
                        {!discoveryMode && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-6">Extraction Logic</label>
                                <textarea value={scrapeInstruction} onChange={(e) => setScrapeInstruction(e.target.value)} placeholder="Summarize key features..." className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-8 py-5 text-sm text-white h-28 focus:border-teal-500 focus:outline-none transition-all resize-none shadow-inner" />
                            </div>
                        )}
                        <button onClick={discoveryMode ? handleScanSite : handleSubmit} className="w-full bg-teal-600 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-[0_20px_50px_rgba(20,184,166,0.2)] hover:bg-teal-500 transition-all transform hover:-translate-y-1">
                            {discoveryMode ? 'Engage Mapping' : 'Execute Extraction'}
                        </button>
                      </div>
                    ) : (
                        <div className="text-left animate-fade-in">
                            <div className="flex justify-between items-center mb-8 px-2">
                                <div>
                                    <h4 className="font-black text-teal-400 uppercase tracking-widest text-xs">Knowledge Nodes</h4>
                                    <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">{discoveredLinks.length} paths identified</p>
                                </div>
                                <button onClick={() => { setDiscoveredLinks([]); setDiscoveryMode(false); }} className="text-[9px] text-slate-700 hover:text-red-400 uppercase font-black tracking-widest transition-colors border border-slate-800 px-4 py-2 rounded-full">Reset</button>
                            </div>
                            <div className="bg-slate-950/80 border border-slate-800 rounded-3xl overflow-hidden mb-8 max-h-96 overflow-y-auto custom-scrollbar shadow-inner">
                                {discoveredLinks.map((link, i) => (
                                    <div key={i} className="flex items-center gap-5 p-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/40 transition-colors group">
                                        <input type="checkbox" checked={selectedLinks.has(link.url)} onChange={() => {
                                            const n = new Set(selectedLinks);
                                            n.has(link.url) ? n.delete(link.url) : n.add(link.url);
                                            setSelectedLinks(n);
                                        }} className="w-6 h-6 rounded border-slate-800 bg-slate-950 text-teal-500 focus:ring-teal-500 cursor-pointer" />
                                        <div className="flex-1 truncate">
                                            <p className="text-xs font-black text-slate-200 group-hover:text-teal-400 transition-colors truncate uppercase tracking-tight">{link.title}</p>
                                            <p className="text-[9px] text-slate-700 truncate font-mono mt-1">{link.url}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleBatchScrape} disabled={selectedLinks.size === 0} className="w-full bg-teal-600 py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-[10px] shadow-[0_25px_60px_rgba(20,184,166,0.3)] transition-all hover:bg-teal-500 disabled:bg-slate-900 disabled:text-slate-700 disabled:shadow-none">
                                Ingest {selectedLinks.size} Nodes
                            </button>
                        </div>
                    )}
                </div>
            )}
            {error && <div className="mt-8 p-6 bg-red-500/5 border border-red-500/10 rounded-3xl text-red-500 text-[9px] text-center font-black uppercase tracking-[0.3em] shadow-2xl animate-pulse">{error}</div>}
        </div>
      )}
    </div>
  );
};