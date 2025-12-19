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
  const [targetSelector, setTargetSelector] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [discoveryMode, setDiscoveryMode] = useState(false);
  const [discoveredLinks, setDiscoveredLinks] = useState<DiscoveredLink[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialUrl) {
      setMode('url');
      setUrlInput(initialUrl);
    }
  }, [initialUrl]);

  const normalizeUrl = (u: string) => {
    let target = u.trim();
    if (!target) return '';
    if (!target.startsWith('http')) target = 'https://' + target;
    try { return new URL(target).href; } catch { return target; }
  };

  const PROXY_LIST = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&_=${Date.now()}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
    (url: string) => `https://proxy.cors.sh/${url}`
  ];

  const fetchWithRotation = async (url: string) => {
    for (let i = 0; i < PROXY_LIST.length; i++) {
      const proxyUrl = PROXY_LIST[i](url);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const text = await res.text();
          if (text.length > 500 && !text.toLowerCase().includes("access denied") && !text.toLowerCase().includes("bot check")) {
            return text;
          }
        }
      } catch (e) { console.debug(`Proxy ${i} failed for ${url}`); }
    }
    return null;
  };

  const cleanHtml = (html: string, selector?: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const killers = 'script, style, svg, noscript, iframe, link, meta, head, nav, footer, button, select, aside, .ad, .social';
    doc.querySelectorAll(killers).forEach(el => el.remove());
    
    if (selector) {
      const targeted = Array.from(doc.querySelectorAll(selector)).map(el => (el as HTMLElement).innerText || el.textContent || "").join('\n\n');
      if (targeted.trim()) return targeted;
    }

    const mainContent = doc.querySelector('main, article, .content, .post-body, .prompt-details, .main-container');
    if (mainContent) return (mainContent as HTMLElement).innerText || mainContent.textContent || "";
    
    return (doc.body as HTMLElement)?.innerText || doc.body?.textContent || "";
  };

  const performAnalysisAndSave = async (base64Data: string, type: string, name: string, size: number) => {
      setProgressStep('Analyzing Knowledge...');
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
    setProgressStep('Grounding Media...');
    setProgress(30);
    try {
      const analysis = await analyzeExternalVideo(url);
      const newVideo: VideoMetadata = {
        id: generateId(),
        userId,
        title: analysis.title || "External Feed",
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
    } catch (err) { setError("Grounding failed. Node is likely protected."); }
  };

  const processWebScrape = async (url: string, instruction: string = '', selector?: string) => {
    const normalized = normalizeUrl(url);
    const rawHtml = await fetchWithRotation(normalized);
    if (!rawHtml) throw new Error("Blocked: Server rejected all proxies.");
    
    const textContent = cleanHtml(rawHtml, selector);
    if (textContent.length < 100) throw new Error("Empty scrape: No readable text found.");

    const analysis = await analyzeWebContent(textContent, instruction, normalized);
    const newEntry: VideoMetadata = {
      id: generateId(),
      userId,
      title: analysis.title || "Knowledge Node",
      fileName: normalized,
      size: textContent.length,
      type: 'web/scrape',
      uploadDate: Date.now(),
      transcription: analysis.transcription,
      summary: analysis.summary,
      keywords: analysis.keywords,
      externalUrl: normalized,
      isExternal: true,
      scrapedContent: analysis.scrapedData
    };
    await saveVideoToDB(newEntry);
    return true;
  };

  const handleScanSite = async () => {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) return;
    setIsProcessing(true);
    setProgress(10);
    setProgressStep("Phase 1: Recursive Search Mapping...");
    setError(null);
    setDiscoveredLinks([]);
    setSelectedLinks(new Set());

    try {
      let links = await discoverSiteLinks(normalized);
      
      if (links.length < 5) {
        setProgress(50);
        setProgressStep("Phase 2: Deep Link Extraction...");
        const rawHtml = await fetchWithRotation(normalized);
        if (rawHtml) {
            const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
            const anchors = Array.from(doc.querySelectorAll('a'));
            const domain = new URL(normalized).hostname.replace('www.', '');
            const rawUrls = anchors.map(a => {
                try { return new URL(a.getAttribute('href') || '', normalized).href; } catch { return ''; }
            }).filter(u => {
                try { return new URL(u).hostname.includes(domain) && !u.includes('#') && u.length > normalized.length + 2; } catch { return false; }
            });
            
            const uniqueRaw = Array.from(new Set(rawUrls)).slice(0, 200);
            if (uniqueRaw.length > 0) {
                const refined = await filterAndTitleLinks(uniqueRaw, normalized);
                links = [...links, ...refined];
            }
        }
      }

      if (links.length === 0) links = await predictCommonLinks(normalized);

      if (links.length === 0) {
        setError("Zero paths identified. Domain might be heavily shielded.");
      } else {
        const unique = Array.from(new Map(links.map(item => [item.url, item])).values());
        setDiscoveredLinks(unique);
        setSelectedLinks(new Set(unique.map(l => l.url)));
      }
    } catch (e: any) { setError("Discovery Error: " + e.message); }
    finally { setIsProcessing(false); setProgress(0); }
  };

  const handleBatchScrape = async () => {
    if (selectedLinks.size === 0) return;
    setIsProcessing(true);
    const urls = Array.from(selectedLinks) as string[];
    let success = 0, fail = 0;

    for (const url of urls) {
      setProgressStep(`Ingesting Node ${success + fail + 1}/${urls.length}...`);
      try { 
        await processWebScrape(url, scrapeInstruction, targetSelector); 
        success++;
      } catch (e) { fail++; }
      setProgress(Math.round(((success + fail) / urls.length) * 100));
    }

    setIsProcessing(false);
    if (success === 0) setError(`Batch failed. All ${urls.length} nodes were blocked by target host.`);
    else {
        onUploadComplete();
        setDiscoveredLinks([]);
        if (fail > 0) setError(`Partial Ingest: ${success} saved, ${fail} blocked.`);
    }
  };

  return (
    <div className="w-full">
      {!isProcessing && (
        <div className="flex mb-10 bg-slate-800/80 backdrop-blur-3xl p-2 rounded-[1.5rem] w-fit mx-auto gap-2 shadow-2xl border border-slate-700/50">
            {['upload', 'url', 'scrape'].map((m: any) => (
                <button 
                  key={m} 
                  onClick={() => { setMode(m); setError(null); setDiscoveredLinks([]); }} 
                  className={`px-10 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.4em] transition-all duration-700 ${mode === m ? 'bg-primary text-white shadow-[0_15px_40px_rgba(99,102,241,0.5)] scale-105' : 'text-slate-500 hover:text-slate-100'}`}
                >
                    {m}
                </button>
            ))}
        </div>
      )}

      {isProcessing ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-[4rem] p-24 text-center shadow-[0_100px_200px_rgba(0,0,0,0.8)] relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/15 via-transparent to-secondary/15 animate-pulse"></div>
          <div className="w-32 h-32 border-[8px] border-primary border-t-transparent rounded-full animate-spin mx-auto mb-14 shadow-[0_0_60px_rgba(99,102,241,0.5)]"></div>
          <p className="text-white font-black uppercase tracking-[0.6em] text-[13px] animate-pulse mb-14">{progressStep}</p>
          <div className="max-w-md mx-auto bg-slate-800 h-4 rounded-full overflow-hidden shadow-inner p-1">
             <div className="bg-gradient-to-r from-primary via-indigo-400 to-secondary h-full transition-all duration-1000 ease-out rounded-full shadow-[0_0_15px_rgba(99,102,241,0.6)]" style={{width: `${progress || 20}%`}}></div>
          </div>
        </div>
      ) : (
        <div className="w-full animate-fade-in">
            {mode === 'scrape' && (
                <div className="bg-teal-900/5 border border-teal-500/10 rounded-[5rem] p-20 text-center w-full max-w-4xl mx-auto shadow-[0_80px_160px_rgba(0,0,0,0.7)] backdrop-blur-3xl">
                    {discoveredLinks.length === 0 ? (
                      <div className="max-w-xl mx-auto text-left flex flex-col gap-12">
                        <div className="text-center">
                            <h1 className="text-7xl font-black text-teal-400 uppercase tracking-tighter mb-4">Web Hive</h1>
                            <p className="text-slate-500 text-[13px] font-black uppercase tracking-[0.6em] opacity-60">Deep Autonomous Extraction</p>
                        </div>
                        <div className="space-y-4">
                            <label className="text-[12px] font-black text-slate-700 uppercase tracking-[0.6em] ml-12">Target URL / Domain</label>
                            <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://example.com/items" className="w-full bg-slate-950 border border-slate-800 rounded-[3rem] px-14 py-8 text-white focus:border-teal-500 focus:outline-none transition-all text-center font-black text-xl" required />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <label className="text-[12px] font-black text-slate-700 uppercase tracking-[0.6em] ml-12">CSS Element Target (Optional)</label>
                                <input type="text" value={targetSelector} onChange={(e) => setTargetSelector(e.target.value)} placeholder=".article-body, #main" className="w-full bg-slate-950 border border-slate-800 rounded-[2rem] px-10 py-5 text-white focus:border-teal-500 focus:outline-none transition-all text-sm font-bold" />
                            </div>
                            <div className="space-y-4">
                                <label className="text-[12px] font-black text-slate-700 uppercase tracking-[0.6em] ml-12">Custom Logic</label>
                                <input type="text" value={scrapeInstruction} onChange={(e) => setScrapeInstruction(e.target.value)} placeholder="Extract technical details..." className="w-full bg-slate-950 border border-slate-800 rounded-[2rem] px-10 py-5 text-white focus:border-teal-500 focus:outline-none transition-all text-sm font-bold" />
                            </div>
                        </div>

                        <label className="flex items-center gap-10 text-sm text-slate-400 bg-slate-950/60 p-12 rounded-[3.5rem] cursor-pointer hover:bg-slate-900 transition-all border border-transparent hover:border-teal-500/50 group shadow-3xl">
                            <input type="checkbox" checked={discoveryMode} onChange={(e) => setDiscoveryMode(e.target.checked)} className="w-10 h-10 rounded-[1rem] border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500" />
                            <div className="flex-1">
                                <span className="block font-black uppercase text-[14px] tracking-[0.4em] text-slate-200 group-hover:text-teal-400 transition-colors">Recursive Discovery</span>
                                <span className="text-[11px] opacity-40 font-bold uppercase tracking-[0.3em] mt-3 block leading-relaxed">Map all deep content across the domain.</span>
                            </div>
                        </label>
                        
                        <div className="flex flex-col gap-6">
                            <button onClick={discoveryMode ? handleScanSite : (e) => processWebScrape(urlInput, scrapeInstruction, targetSelector).then(() => onUploadComplete())} className="w-full bg-teal-600 py-8 rounded-[3rem] font-black uppercase tracking-[0.5em] text-[13px] shadow-[0_40px_100px_rgba(20,184,166,0.4)] hover:bg-teal-500 transition-all transform hover:-translate-y-3 active:scale-95">
                                {discoveryMode ? 'Engage Mapping' : 'Execute Hive Ingest'}
                            </button>
                        </div>
                      </div>
                    ) : (
                        <div className="text-left animate-fade-in px-8">
                            <div className="flex justify-between items-center mb-14">
                                <div>
                                    <h4 className="font-black text-teal-400 uppercase tracking-[0.5em] text-lg">Discovered Nodes</h4>
                                    <p className="text-[12px] text-slate-600 font-black uppercase tracking-[0.4em] mt-4">{discoveredLinks.length} items identified</p>
                                </div>
                                <button onClick={() => { setDiscoveredLinks([]); setDiscoveryMode(false); }} className="text-[12px] text-slate-700 hover:text-red-500 uppercase font-black tracking-[0.5em] transition-all border border-slate-800/80 px-10 py-5 rounded-full hover:border-red-500/60">Abort</button>
                            </div>
                            <div className="bg-slate-950 border border-slate-800/80 rounded-[4rem] overflow-hidden mb-14 max-h-[45rem] overflow-y-auto custom-scrollbar shadow-inner">
                                {discoveredLinks.map((link, i) => (
                                    <div key={i} className="flex items-center gap-10 p-12 border-b border-slate-900/50 last:border-0 hover:bg-slate-900/80 transition-all group cursor-pointer" onClick={() => {
                                        const n = new Set(selectedLinks);
                                        n.has(link.url) ? n.delete(link.url) : n.add(link.url);
                                        setSelectedLinks(n);
                                    }}>
                                        <input type="checkbox" checked={selectedLinks.has(link.url)} readOnly className="w-10 h-10 rounded-[1rem] border-slate-800 bg-slate-950 text-teal-500 focus:ring-teal-500 pointer-events-none" />
                                        <div className="flex-1 truncate">
                                            <p className="text-lg font-black text-slate-200 group-hover:text-teal-400 transition-colors truncate uppercase tracking-tight">{link.title}</p>
                                            <p className="text-[12px] text-slate-700 truncate font-mono mt-4 opacity-70 tracking-tighter">{link.url}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleBatchScrape} disabled={selectedLinks.size === 0} className="w-full bg-teal-600 py-10 rounded-[4rem] font-black uppercase tracking-[0.5em] text-[13px] shadow-[0_60px_120px_rgba(20,184,166,0.6)] transition-all hover:bg-teal-500 disabled:bg-slate-900 transform hover:-translate-y-3 active:scale-95">
                                Ingest {selectedLinks.size} Nodes into Hive
                            </button>
                        </div>
                    )}
                </div>
            )}
            
            {mode === 'upload' && (
                <div onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && performAnalysisAndSave('', '', '', 0); }} onDragOver={(e) => e.preventDefault()} className="border-2 border-dashed border-slate-700/60 rounded-[4rem] p-28 text-center hover:bg-slate-800/40 transition-all duration-1000 group cursor-pointer">
                    <div className="w-36 h-36 bg-slate-800 rounded-[3rem] flex items-center justify-center mx-auto mb-12 text-primary group-hover:scale-110 transition-all">
                        <svg className="w-18 h-18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                    </div>
                    <label className="bg-primary text-white font-black uppercase tracking-[0.5em] text-[13px] py-8 px-24 rounded-[2.5rem] cursor-pointer shadow-lg inline-block transition-all transform hover:-translate-y-3">
                        SELECT BINARY
                        <input type="file" className="hidden" accept="video/*" onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                const file = e.target.files[0];
                                const reader = new FileReader();
                                reader.onload = async () => {
                                    setIsProcessing(true);
                                    const b64 = (reader.result as string).split(',')[1];
                                    await performAnalysisAndSave(b64, file.type, file.name.split('.')[0], file.size);
                                    setIsProcessing(false);
                                };
                                reader.readAsDataURL(file);
                            }
                        }} />
                    </label>
                </div>
            )}

            {mode === 'url' && (
                <div className="bg-slate-800/20 border border-slate-700/40 rounded-[4rem] p-24 text-center backdrop-blur-2xl shadow-4xl">
                    <h3 className="text-[13px] font-black mb-14 uppercase tracking-[0.7em] text-slate-500">Stream Ingress</h3>
                    <form onSubmit={(e) => { e.preventDefault(); processSocialUrl(urlInput); }} className="flex flex-col gap-12 max-w-xl mx-auto">
                        <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="YouTube, TikTok, Instagram..." className="bg-slate-950 border border-slate-700/60 rounded-[2.5rem] px-14 py-8 text-white focus:border-primary focus:outline-none transition-all text-center font-black text-lg" required />
                        <button type="submit" className="bg-primary py-8 rounded-[2.5rem] font-black uppercase tracking-[0.5em] text-[13px] transition-all transform hover:-translate-y-3">Map Link</button>
                    </form>
                </div>
            )}
            
            {error && <div className="mt-14 p-12 bg-red-500/5 border border-red-500/15 rounded-[4rem] text-red-500 text-[12px] text-center font-black uppercase tracking-[0.6em] animate-pulse">{error}</div>}
        </div>
      )}
    </div>
  );
};