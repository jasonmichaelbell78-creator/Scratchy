import React, { useState } from 'react';
import { User } from '../types';

interface AuthProps {
  onLogin: (user: User) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError("Username is required");
      return;
    }

    if (username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    // Determine ID based on username for persistence simulation
    // In a real app, this would come from a backend DB
    const userId = btoa(username.toLowerCase());
    
    // Simulate auth
    const user: User = {
      id: userId,
      username: username
    };

    // In a real app we would check password here. 
    // For this local-first demo, we just log them in.
    onLogin(user);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark p-4">
      <div className="max-w-md w-full bg-surface border border-slate-700 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
           <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-xl flex items-center justify-center text-white mx-auto mb-4 shadow-lg shadow-primary/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
           </div>
           <h1 className="text-3xl font-bold text-white mb-2">VideoMind</h1>
           <p className="text-slate-400">
             {isSignUp ? "Create your personal video library" : "Sign in to access your library"}
           </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="Enter your username"
            />
          </div>

          {error && <div className="text-red-400 text-sm text-center bg-red-500/10 p-2 rounded-lg">{error}</div>}

          <button 
            type="submit" 
            className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 transform hover:-translate-y-0.5"
          >
            {isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="text-slate-400 hover:text-white text-sm font-medium transition-colors"
          >
            {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
};
