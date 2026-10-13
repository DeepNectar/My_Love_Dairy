import { useState, useEffect, useRef } from 'react';

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-dismiss import status
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => setImportStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [importStatus]);

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

  // --- Import/Export Functions ---

  const handleExportJSON = () => {
    const data = JSON.stringify(entries, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-entries-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: 'success', message: `Exported ${entries.length} entries successfully!` });
  };

  const handleExportText = () => {
    const text = entries.map(entry =>
      `Message: ${entry.dateTime} - ${entry.senderName}: "${entry.message}"\nWhat I felt: ${entry.reflection}\n\n---\n`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-entries-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: 'success', message: `Exported ${entries.length} entries as text!` });
  };

  const parseTextEntries = (text: string): DiaryEntry[] => {
    const parsed: DiaryEntry[] = [];
    // Split by the separator "---" or double newlines between entries
    const blocks = text.split(/\n---\n|\n\n(?=Message:)/);

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Try to match the format: Message: [DateTime] - [Sender]: "[Content]"
      const messageRegex = /Message:\s*(.+?)\s*-\s*(.+?):\s*"(.+?)"/s;
      const messageMatch = trimmed.match(messageRegex);

      if (messageMatch) {
        const dateTime = messageMatch[1].trim();
        const senderName = messageMatch[2].trim();
        const messageContent = messageMatch[3].trim();

        // Try to match reflection
        const reflectionRegex = /What I felt:\s*(.+)/s;
        const reflectionMatch = trimmed.match(reflectionRegex);
        const reflectionContent = reflectionMatch ? reflectionMatch[1].trim() : '';

        if (messageContent) {
          parsed.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            dateTime,
            senderName,
            message: messageContent,
            reflection: reflectionContent,
          });
        }
      }
    }
    return parsed;
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        let imported: DiaryEntry[] = [];

        if (file.name.endsWith('.json')) {
          // Parse JSON format
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            imported = data.map((item: any) => ({
              id: item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
              dateTime: item.dateTime || 'Unknown date',
              senderName: item.senderName || 'Anonymous',
              message: item.message || '',
              reflection: item.reflection || '',
            }));
          } else {
            throw new Error('Invalid JSON format. Expected an array of entries.');
          }
        } else if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
          // Parse text format
          imported = parseTextEntries(content);
          if (imported.length === 0) {
            throw new Error('Could not parse any entries from this text file. Make sure it follows the format:\n\nMessage: [Date & Time] - [Sender Name]: "[Message content]"\nWhat I felt: [Original reflection]');
          }
        } else {
          throw new Error('Unsupported file format. Please use .json or .txt files.');
        }

        if (imported.length === 0) {
          throw new Error('No valid entries found in the file.');
        }

        setEntries([...imported, ...entries]);
        setShowImportModal(false);
        setImportStatus({ type: 'success', message: `Successfully imported ${imported.length} ${imported.length === 1 ? 'entry' : 'entries'}!` });
      } catch (err: any) {
        setImportStatus({ type: 'error', message: err.message || 'Failed to import file.' });
      }
    };
    reader.onerror = () => {
      setImportStatus({ type: 'error', message: 'Failed to read the file.' });
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportClick = () => {
    setShowMenu(false);
    setShowImportModal(true);
  };

  const filteredEntries = entries.filter(entry =>
    entry.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.reflection.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.senderName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50">
      {/* Import Status Toast */}
      {importStatus && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-white font-medium flex items-center gap-2 animate-fade-in ${
          importStatus.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          <span>{importStatus.type === 'success' ? '✅' : '❌'}</span>
          <span>{importStatus.message}</span>
          <button onClick={() => setImportStatus(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

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
          <div className="flex items-center gap-2">
            {/* Menu Button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 p-2.5 rounded-full transition-all shadow-sm hover:shadow-md"
                title="More options"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {showMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in z-20">
                  <button
                    onClick={handleImportClick}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors"
                  >
                    <span className="text-lg">📥</span>
                    <div>
                      <p className="font-medium text-gray-800">Import Entries</p>
                      <p className="text-xs text-gray-500">From JSON or text file</p>
                    </div>
                  </button>
                  <div className="border-t border-amber-100"></div>
                  <button
                    onClick={handleExportJSON}
                    disabled={entries.length === 0}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg">📤</span>
                    <div>
                      <p className="font-medium text-gray-800">Export as JSON</p>
                      <p className="text-xs text-gray-500">Full backup with all data</p>
                    </div>
                  </button>
                  <button
                    onClick={handleExportText}
                    disabled={entries.length === 0}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg">📄</span>
                    <div>
                      <p className="font-medium text-gray-800">Export as Text</p>
                      <p className="text-xs text-gray-500">Readable diary format</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* New Entry Button */}
            <button
              onClick={() => { setShowForm(!showForm); setEditingId(null); setMessage(''); setReflection(''); }}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <span className="text-lg">{showForm ? '✕' : '+'}</span>
              <span className="hidden sm:inline">{showForm ? 'Close' : 'New Entry'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                📥 Import Diary Entries
              </h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-white/80 hover:text-white text-xl transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-gray-600 text-sm">
                Import your diary entries from a previously exported file. Supported formats:
              </p>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <span className="text-xl">📋</span>
                  <div>
                    <p className="font-medium text-amber-900">JSON Format</p>
                    <p className="text-sm text-amber-700">Full backup files with all entry data including IDs and timestamps.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                  <span className="text-xl">📝</span>
                  <div>
                    <p className="font-medium text-orange-900">Text Format (.txt / .md)</p>
                    <p className="text-sm text-orange-700">Entries in the diary format:</p>
                    <code className="text-xs bg-orange-100 px-2 py-1 rounded mt-1 block text-orange-800">
                      Message: [Date] - [Name]: "content"<br/>
                      What I felt: [reflection]
                    </code>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <p className="text-sm text-yellow-800">
                  ⚠️ <strong>Note:</strong> Imported entries will be added to your existing entries (not replace them).
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <label className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg text-center cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.md"
                    onChange={handleFileImport}
                    className="hidden"
                  />
                  📂 Choose File to Import
                </label>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <p className="text-amber-600 mb-6">Start writing your first entry or import existing ones.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => setShowForm(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-full font-medium transition-all shadow-md hover:shadow-lg"
              >
                ✍️ Write Your First Entry
              </button>
              <button
                onClick={handleImportClick}
                className="border-2 border-amber-400 text-amber-700 hover:bg-amber-50 px-8 py-3 rounded-full font-medium transition-all"
              >
                📥 Import Entries
              </button>
            </div>
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
