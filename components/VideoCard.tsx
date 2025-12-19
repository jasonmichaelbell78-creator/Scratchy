import React from 'react';
import { VideoMetadata } from '../types';

interface VideoCardProps {
  video: VideoMetadata;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({ video, onClick, onDelete }) => {
  const isWeb = video.type === 'web/scrape';

  return (
    <div 
      onClick={onClick}
      className={`group relative bg-surface border rounded-xl overflow-hidden transition-all duration-300 cursor-pointer hover:shadow-lg flex flex-col h-full ${isWeb ? 'border-teal-900/50 hover:border-teal-500/50 hover:shadow-teal-500/10' : 'border-slate-700 hover:border-primary/50 hover:shadow-primary/10'}`}
    >
      <div className={`h-32 w-full flex items-center justify-center relative overflow-hidden ${isWeb ? 'bg-slate-900' : 'bg-slate-900'}`}>
         {/* Placeholder pattern */}
         <div className={`absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] ${isWeb ? 'from-teal-500 via-slate-900' : 'from-primary via-slate-900'} to-slate-900`}></div>
         
         {isWeb ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-500 group-hover:text-teal-400 transition-colors z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
         ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-500 group-hover:text-primary transition-colors z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
         )}
         
         {isWeb && (
            <div className="absolute top-2 left-2 bg-teal-900/80 backdrop-blur-sm text-teal-200 text-[10px] font-bold px-2 py-0.5 rounded border border-teal-500/30">
                WEB
            </div>
         )}
      </div>
      
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-white font-medium text-lg mb-1 truncate" title={video.title}>{video.title}</h3>
        <p className="text-slate-400 text-xs mb-3">{new Date(video.uploadDate).toLocaleDateString()}</p>
        
        <p className="text-slate-300 text-sm line-clamp-3 mb-4 flex-1">
          {video.summary || "No summary available."}
        </p>
        
        <div className="flex flex-wrap gap-1 mt-auto">
          {video.keywords.slice(0, 3).map((k, i) => (
            <span key={i} className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-md ${isWeb ? 'bg-teal-900/30 text-teal-300' : 'bg-slate-700 text-slate-300'}`}>
              {k}
            </span>
          ))}
        </div>
      </div>

      <button 
        onClick={onDelete}
        className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-500/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all z-20"
        title="Delete Item"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
};