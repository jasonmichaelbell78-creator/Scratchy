import React, { useState, useEffect } from 'react';
import { AppView, VideoMetadata, User } from './types';
import { Uploader } from './components/Uploader';
import { VideoCard } from './components/VideoCard';
import { ChatInterface } from './components/ChatInterface';
import { Auth } from './components/Auth';
import { getAllVideosMetadata, deleteVideoFromDB, getVideoData } from './services/idbService';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedVideoBlob, setSelectedVideoBlob] = useState<string | null>(null);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  
  // Restore session
  useEffect(() => {
    const savedUser = localStorage.getItem('videomind_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }

    // Check for shared content via PWA parameters
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('url') || params.get('text') || params.get('title');
    
    // Sometimes text contains a URL (e.g. "Check this out https://...")
    if (shared) {
       // Simple regex to extract URL if it exists in the text
       const urlMatch = shared.match(/https?:\/\/[^\s]+/);
       if (urlMatch) {
         setSharedUrl(urlMatch[0]);
       } else if (shared.startsWith('http')) {
         setSharedUrl(shared);
       }
       // Clean URL
       window.history.replaceState({}, document.title, window.location.pathname);
    }

  }, []);

  // Load videos when user changes
  const loadVideos = async () => {
    if (!user) return;
    try {
      const vids = await getAllVideosMetadata(user.id);
      const sorted = vids.sort((a, b) => b.uploadDate - a.uploadDate);
      setVideos(sorted);
      setFilteredVideos(sorted);
    } catch (e) {
      console.error("Failed to load library", e);
    }
  };

  useEffect(() => {
    if (user) {
      loadVideos();
    } else {
      setVideos([]);
    }
  }, [user]);

  // Handle Search Logic
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredVideos(videos);
      return;
    }

    const lowerQ = searchQuery.toLowerCase();
    const filtered = videos.filter(v => {
      // 1. Keyword search
      if (v.keywords.some(k => k.toLowerCase().includes(lowerQ))) return true;
      // 2. Title search
      if (v.title.toLowerCase().includes(lowerQ)) return true;
      // 3. Transcript/Content search
      if (v.transcription.toLowerCase().includes(lowerQ)) return true;
      return false;
    });
    setFilteredVideos(filtered);
  }, [searchQuery, videos]);


  const handleLogin = (u: User) => {
    setUser(u);
    localStorage.setItem('videomind_user', JSON.stringify(u));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('videomind_user');
    setVideos([]);
    setView(AppView.DASHBOARD);
  };

  const handleVideoSelect = async (id: string) => {
    setSelectedVideoId(id);
    const data = await getVideoData(id);
    if (data && data.base64Data) {
        setSelectedVideoBlob(`data:${data.metadata.type};base64,${data.base64Data}`);
    } else {
        setSelectedVideoBlob(null); // External video or Web Scrape
    }
    setView(AppView.VIDEO_DETAIL);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this item?")) {
      await deleteVideoFromDB(id);
      await loadVideos();
      if (selectedVideoId === id) {
        setView(AppView.DASHBOARD);
        setSelectedVideoId(null);
        setSelectedVideoBlob(null);
      }
    }
  };

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  const renderDashboard = () => (
    <div className="space-y-8 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          <header className="mb-6">
             <h1 className="text-3xl font-bold text-white mb-2">Welcome, {user.username}</h1>
             <p className="text-slate-400">Manage your videos and web knowledge base.</p>
          </header>
          
          {/* Pass sharedUrl to Uploader to pre-fill content */}
          <Uploader userId={user.id} onUploadComplete={loadVideos} initialUrl={sharedUrl} />

          <div className="mt-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
               <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                 </svg>
                 Library
               </h2>
               
               {/* Search Bar */}
               <div className="relative w-full sm:w-64">
                 <input 
                   type="text" 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   placeholder="Search library..."
                   className="w-full bg-slate-800 border border-slate-700 rounded-full pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                 />
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                 </svg>
               </div>
            </div>

            {filteredVideos.length === 0 ? (
               <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-dashed border-slate-700">
                  <p className="text-slate-500">
                    {searchQuery ? "No items found matching your search." : "Library empty. Upload a video or scrape a website."}
                  </p>
               </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredVideos.map(video => (
                  <VideoCard 
                    key={video.id} 
                    video={video} 
                    onClick={() => handleVideoSelect(video.id)}
                    onDelete={(e) => handleDelete(e, video.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Global Chat Section */}
        <div className="lg:col-span-1 h-[600px] lg:h-auto">
          <ChatInterface scope="global" allVideos={filteredVideos} />
        </div>
      </div>
    </div>
  );

  // Helper to render media based on type
  const renderMediaPlayer = (video: VideoMetadata) => {
    // 1. Web Scrape Render
    if (video.type === 'web/scrape') {
      return (
        <div className="w-full h-full bg-slate-900 flex flex-col p-6 overflow-hidden">
           <div className="flex items-center gap-3 mb-4 border-b border-teal-500/30 pb-4">
              <div className="p-2 bg-teal-500/20 rounded-lg text-teal-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                 <h2 className="text-white font-bold truncate">{video.title}</h2>
                 <a href={video.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-teal-400 hover:text-teal-300 truncate block">
                    {video.externalUrl}
                 </a>
              </div>
           </div>

           <div className="flex-1 overflow-y-auto pr-2 space-y-4">
               {video.scrapedContent && (
                   <div className="bg-teal-900/10 border border-teal-500/20 rounded-lg p-4">
                       <h3 className="text-teal-400 text-xs font-bold uppercase tracking-wider mb-2">Extracted Insights</h3>
                       <p className="text-slate-200 text-sm whitespace-pre-wrap">{video.scrapedContent}</p>
                   </div>
               )}
               
               <div>
                   <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Page Content</h3>
                   <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-serif">
                       {video.transcription}
                   </div>
               </div>
           </div>
        </div>
      );
    }

    // 2. External Video (YouTube)
    if (video.isExternal && video.externalUrl) {
      if (video.externalUrl.includes('youtube.com') || video.externalUrl.includes('youtu.be')) {
        let videoId = '';
        if (video.externalUrl.includes('v=')) {
          videoId = video.externalUrl.split('v=')[1]?.split('&')[0];
        } else if (video.externalUrl.includes('youtu.be/')) {
          videoId = video.externalUrl.split('youtu.be/')[1];
        }

        if (videoId) {
          return (
            <iframe 
              className="w-full h-full"
              src={`https://www.youtube.com/embed/${videoId}`}
              title={video.title}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          );
        }
      }

      // Fallback for TikTok/Others
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-center p-4">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-slate-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
           </svg>
           <h3 className="text-xl font-semibold text-white mb-2">External Video</h3>
           <p className="text-slate-400 mb-6">This video is hosted on an external platform.</p>
           <a 
             href={video.externalUrl} 
             target="_blank" 
             rel="noopener noreferrer"
             className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-full font-medium transition-colors flex items-center gap-2"
           >
             Watch on {video.externalUrl.includes('tiktok') ? 'TikTok' : 'External Site'}
             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
             </svg>
           </a>
        </div>
      );
    }

    // 3. Local Video
    if (selectedVideoBlob) {
      return <video controls className="w-full h-full" src={selectedVideoBlob} />;
    }

    return <div className="w-full h-full flex items-center justify-center text-slate-500">Loading Video...</div>;
  };

  const renderDetail = () => {
    const video = videos.find(v => v.id === selectedVideoId);
    if (!video) return <div>Item not found</div>;

    const isWeb = video.type === 'web/scrape';

    return (
      <div className="animate-fade-in h-full flex flex-col">
        <button 
          onClick={() => {
            setView(AppView.DASHBOARD);
            setSelectedVideoBlob(null);
            setSearchQuery('');
          }}
          className="mb-4 flex items-center text-slate-400 hover:text-white transition-colors w-fit"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Library
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-6 overflow-y-auto pr-2 pb-10">
             {/* Content Viewer (Video Player or Web Reader) */}
             <div className="bg-black rounded-xl overflow-hidden aspect-video shadow-2xl relative">
                {renderMediaPlayer(video)}
             </div>

             {/* Analysis Data */}
             <div className={`bg-surface border rounded-xl p-6 ${isWeb ? 'border-teal-500/20' : 'border-slate-700'}`}>
                <div className="flex justify-between items-start">
                  <h1 className="text-2xl font-bold text-white mb-2">{video.title}</h1>
                  {video.isExternal && !isWeb && (
                    <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded border border-blue-500/30">
                       External Link
                    </span>
                  )}
                  {isWeb && (
                    <span className="bg-teal-500/20 text-teal-300 text-xs px-2 py-1 rounded border border-teal-500/30">
                       Web Knowledge
                    </span>
                  )}
                </div>
                
                <div className="flex gap-2 mb-6">
                   {video.keywords.map(k => (
                     <span key={k} className={`px-2 py-0.5 rounded text-xs border ${isWeb ? 'bg-teal-900/30 text-teal-300 border-teal-500/30' : 'bg-secondary/20 text-secondary border-secondary/30'}`}>
                        {k}
                     </span>
                   ))}
                </div>

                <div className="mb-6">
                   <h3 className="text-sm uppercase tracking-wide text-slate-400 font-semibold mb-2">Summary</h3>
                   <p className="text-slate-200 leading-relaxed">{video.summary}</p>
                </div>

                {!isWeb && (
                    <div>
                    <h3 className="text-sm uppercase tracking-wide text-slate-400 font-semibold mb-2">Transcription / Description</h3>
                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 max-h-60 overflow-y-auto text-sm text-slate-300 whitespace-pre-wrap font-mono">
                        {video.transcription}
                    </div>
                    </div>
                )}
             </div>
          </div>

          <div className="lg:col-span-1 h-[600px] lg:h-auto">
            <ChatInterface scope="single" contextVideo={video} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-dark text-slate-200 p-4 md:p-8 font-sans selection:bg-primary/30 selection:text-white">
      <div className="max-w-7xl mx-auto h-full">
         {/* Navbar */}
         <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
               </div>
               <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                 VideoMind
               </span>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-sm text-slate-500 hidden sm:block">
                 {videos.length} items indexed
              </div>
              <button 
                onClick={handleLogout}
                className="text-sm bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors border border-slate-700"
              >
                Log Out
              </button>
            </div>
         </div>

         {/* Content */}
         <main className="h-[calc(100vh-140px)]">
           {view === AppView.DASHBOARD ? renderDashboard() : renderDetail()}
         </main>
      </div>
    </div>
  );
}