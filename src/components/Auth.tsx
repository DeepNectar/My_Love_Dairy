import { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthProps {
  onAuthSuccess: () => void;
}

export default function Auth({ onAuthSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (isLogin) {
        // Login
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          // Friendlier message for the common "signed up but never confirmed email" case
          if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
            throw new Error('Please confirm your email address first (check your inbox), then log in.');
          }
          throw error;
        }
        setMessage('Logged in successfully!');
        setTimeout(() => onAuthSuccess(), 500);
      } else {
        // Sign up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation is disabled — user is logged in immediately
          setMessage('Account created! Redirecting...');
          setTimeout(() => onAuthSuccess(), 500);
        } else {
          setMessage('Account created! Please check your email to verify your account, then log in.');
          setIsLogin(true);
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-6 text-center">
          <div className="text-5xl mb-3">📖</div>
          <h1 className="text-2xl font-bold text-white font-serif">My Diary</h1>
          <p className="text-amber-100 text-sm mt-1">Your private cloud journal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleAuth} className="p-8 space-y-5">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-amber-900">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-sm text-amber-700 mt-1">
              {isLogin ? 'Log in to access your diary' : 'Start your journaling journey'}
            </p>
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-amber-800 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name..."
                className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
                required={!isLogin}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              ❌ {error}
            </div>
          )}

          {message && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
              ✅ {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '⏳ Please wait...' : isLogin ? '🔓 Log In' : '✨ Create Account'}
          </button>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
                setMessage('');
              }}
              className="text-amber-600 hover:text-amber-800 text-sm font-medium"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
