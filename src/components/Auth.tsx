import { useState } from 'react';
import { FIXED_USER_ID, verifyHardcodedPassword } from '../lib/hardcodedAuth';
import { createLocalSession } from '../lib/localSession';

interface AuthProps {
  onAuthSuccess: () => void;
}

export default function Auth({ onAuthSuccess }: AuthProps) {
  // The user ID is hardcoded and pre-filled — it can never be edited.
  const userId = FIXED_USER_ID;
  // Password column starts EMPTY — the user must type the fixed password.
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Double-check on submit that the (locked) ID really is the fixed one.
    if (userId !== FIXED_USER_ID) {
      setError('Invalid user ID.');
      return;
    }

    setLoading(true);
    try {
      // Small delay purely for UX so the button state is visible.
      await new Promise((r) => setTimeout(r, 400));
      if (!verifyHardcodedPassword(password)) {
        setError('Incorrect password. Please try again.');
        setLoading(false);
        return;
      }
      await createLocalSession();
      onAuthSuccess();
    } catch (err: any) {
      setError(err?.message || 'Login failed');
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

        {/* Login Form */}
        <form onSubmit={handleLogin} className="p-8 space-y-5">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-amber-900">Welcome Back</h2>
            <p className="text-sm text-amber-700 mt-1">Log in to access your diary</p>
          </div>

          {/* User ID — pre-filled with the hardcoded id and locked read-only */}
          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1.5">
              User ID
            </label>
            <input
              type="text"
              value={userId}
              readOnly
              disabled
              aria-readonly="true"
              className="w-full px-4 py-2.5 border border-amber-200 rounded-xl outline-none bg-amber-100/70 text-amber-900 font-medium cursor-not-allowed select-none"
            />
            <p className="text-xs text-amber-500 mt-1">🔒 Fixed account — cannot be changed</p>
          </div>

          {/* Password — intentionally starts empty; user must enter it */}
          <div>
            <label className="block text-sm font-medium text-amber-800 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password..."
                autoFocus
                autoComplete="off"
                className="w-full px-4 py-2.5 pr-11 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 hover:text-amber-700 text-lg"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              ❌ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '⏳ Please wait...' : '🔓 Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
