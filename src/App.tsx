import { useState, useEffect } from 'react';

interface DiaryEntry {
  id: string;
  dateTime: string;
  senderName: string;
  message: string;
  reflection: string;
}

function App() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [reflection, setReflection] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Load entries from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('diary-entries');
    if (saved) {
      setEntries(JSON.parse(saved));
    }
    const savedName = localStorage.getItem('diary-sender-name');
    if (savedName) {
      setSenderName(savedName);
    }
  }, []);

  // Save entries to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('diary-entries', JSON.stringify(entries));
  }, [entries]);

  // Save sender name
  useEffect(() => {
    if (senderName) {
      localStorage.setItem('diary-sender-name', senderName);
    }
  }, [senderName]);

  const getCurrentDateTime = () => {
    const now = new Date();
    return now.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !reflection.trim()) return;

    const newEntry: DiaryEntry = {
      id: editingId || Date.now().toString(),
      dateTime: getCurrentDateTime(),
      senderName: senderName || 'Anonymous',
      message: message.trim(),
      reflection: reflection.trim(),
    };

    if (editingId) {
      setEntries(entries.map(entry => entry.id === editingId ? newEntry : entry));
      setEditingId(null);
    } else {
      setEntries([newEntry, ...entries]);
    }

    setMessage('');
    setReflection('');
    setShowForm(false);
  };

  const handleEdit = (entry: DiaryEntry) => {
    setSenderName(entry.senderName);
    setMessage(entry.message);
    setReflection(entry.reflection);
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      setEntries(entries.filter(entry => entry.id !== id));
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setMessage('');
    setReflection('');
  };

  const filteredEntries = entries.filter(entry =>
    entry.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.reflection.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.senderName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-amber-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📖</span>
            <div>
              <h1 className="text-2xl font-bold text-amber-900 font-serif">My Diary</h1>
              <p className="text-sm text-amber-700">Journal your thoughts & reflections</p>
            </div>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); setMessage(''); setReflection(''); }}
            className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
          >
            <span className="text-lg">{showForm ? '✕' : '+'}</span>
            <span className="hidden sm:inline">{showForm ? 'Close' : 'New Entry'}</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Writing Form */}
        {showForm && (
          <div className="mb-8 bg-white rounded-2xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                ✍️ {editingId ? 'Edit Entry' : 'Write a New Entry'}
              </h2>
              <p className="text-amber-100 text-sm mt-1">
                {getCurrentDateTime()}
              </p>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Sender Name */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Enter your name..."
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
                />
              </div>

              {/* Message Content */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  Message / What happened
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write about what happened, what was said, or what you experienced..."
                  rows={4}
                  className="w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50"
                  required
                />
              </div>

              {/* Reflection */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  What I Felt (Reflection)
                </label>
                <textarea
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="How did this make you feel? What are your thoughts about it?"
                  rows={3}
                  className="w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50"
                  required
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg"
                >
                  {editingId ? '💾 Update Entry' : '📝 Save Entry'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Search Bar */}
        {entries.length > 0 && (
          <div className="mb-6">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your diary entries..."
                className="w-full pl-12 pr-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-white/80 backdrop-blur-sm"
              />
            </div>
          </div>
        )}

        {/* Entry Count */}
        {entries.length > 0 && (
          <p className="text-amber-700 text-sm mb-4">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        )}

        {/* Diary Entries */}
        <div className="space-y-5">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="bg-white rounded-2xl shadow-md border border-amber-100 overflow-hidden hover:shadow-lg transition-shadow group"
            >
              {/* Entry Header */}
              <div className="px-6 pt-5 pb-3 border-b border-amber-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <span>🕐</span>
                    <span className="font-medium">{entry.dateTime}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(entry)}
                      className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>

              {/* Entry Content */}
              <div className="px-6 py-4">
                {/* Message */}
                <div className="mb-4">
                  <p className="text-gray-800 leading-relaxed">
                    <span className="text-amber-700 font-semibold">Message:</span>{' '}
                    <span className="text-amber-900 font-medium">{entry.dateTime}</span>
                    {' - '}
                    <span className="text-amber-700 font-medium">{entry.senderName}</span>
                    : "<span className="italic">{entry.message}</span>"
                  </p>
                </div>

                {/* Reflection */}
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
                  <p className="text-gray-700 leading-relaxed">
                    <span className="text-orange-600 font-semibold">💭 What I felt:</span>{' '}
                    <span className="italic">{entry.reflection}</span>
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {entries.length === 0 && !showForm && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📔</div>
            <h3 className="text-xl font-semibold text-amber-800 mb-2">Your diary is empty</h3>
            <p className="text-amber-600 mb-6">Start writing your first entry to capture your thoughts and feelings.</p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-full font-medium transition-all shadow-md hover:shadow-lg"
            >
              ✍️ Write Your First Entry
            </button>
          </div>
        )}

        {/* No Results */}
        {entries.length > 0 && filteredEntries.length === 0 && searchQuery && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-amber-700">No entries found matching "{searchQuery}"</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-amber-600 text-sm">
        <p>Your diary entries are stored locally in your browser 🔒</p>
      </footer>
    </div>
  );
}

export default App;
