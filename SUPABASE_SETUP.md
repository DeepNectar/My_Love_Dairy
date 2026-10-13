# 📖 My Diary - Cloud Journal with Supabase

A beautiful diary/journal web app with cloud storage powered by Supabase. Write entries in a structured format, import/export your data, and access your diary from any device.

## ✨ Features

- 🔐 **Secure Authentication** - Email/password login with Supabase Auth
- ☁️ **Cloud Sync** - All entries stored in Supabase, accessible from any device
- 📝 **Structured Format** - Entries are grouped under one of 15 fixed headings:
  ```
  #### HEADING 1: [Topic Name]

  - Message: [Date & Time] - Deep: "[Message content]"
    What I felt: [Original reflection]

  - Message: [Date & Time] - 🫰🫶🏻Chota Don❣️❤️😘: "[Message content]"
    What I felt: [Original reflection]
  ```
- 📥 **Import/Export** - Import entries from JSON or heading-template text files, export as backup
- 🔍 **Search** - Find entries by content, sender, or reflection
- 📱 **Responsive** - Works beautifully on desktop and mobile

## 🚀 Quick Start

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project" and create a project
3. Wait for the project to be ready (takes ~2 minutes)

### 2. Set Up the Database

Go to **SQL Editor** in your Supabase dashboard and run:

```sql
-- ============================================================
-- 📖 My Diary — Supabase SQL (run in SQL Editor to go live)
-- Format:  #### HEADING N: [Topic Name]
--          - Message: [Date & Time] - [Sender]: "[Message]"
--            What I felt: [Reflection]
-- ============================================================

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2) Heading categories reference table (the 15 allowed headings)
CREATE TABLE IF NOT EXISTS heading_categories (
  id SERIAL PRIMARY KEY,
  emoji TEXT NOT NULL,
  title TEXT NOT NULL UNIQUE,
  when_to_use TEXT NOT NULL,
  only_if_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);

-- Full heading text = emoji || ' ' || title  e.g. '🌅 Morning & Night Greetings'
INSERT INTO heading_categories (emoji, title, when_to_use, only_if_mentioned, sort_order) VALUES
  ('🌅', 'Morning & Night Greetings',        'For good mornings/nights',               FALSE, 1),
  ('💬', 'Daily Life & Important Updates',   'For daily conversations',                FALSE, 2),
  ('💖', 'Sweet Compliments & Love',         'For loving words',                       FALSE, 3),
  ('👨‍👩‍👧‍👦', 'About Kesha (Her Sister)',       'ONLY if mentioned',                      TRUE,  4),
  ('👨‍👩‍👧‍👦', 'About Arya (Her Brother)',       'ONLY if mentioned',                      TRUE,  5),
  ('🎯', 'Dreams & Future Plans',            'For future goals',                       FALSE, 6),
  ('🤗', 'Emotional Support & Care',         'For emotional talks',                    FALSE, 7),
  ('😄', 'Fun Moments & Jokes',              'For funny moments',                      FALSE, 8),
  ('🔥', 'Flirty Banter & Teasing',          'For flirty exchanges',                   FALSE, 9),
  ('💕', 'Romantic Confessions',             'For romantic declarations',              FALSE, 10),
  ('💘', 'Attraction & Desire',              'For attraction talks',                   FALSE, 11),
  ('🌙', 'Intimate & Passionate Talks',      'For intimate moments',                   FALSE, 12),
  ('💝', 'Deep Chemistry & Connection',      'For deep connection',                    FALSE, 13),
  ('💭', 'My Messages To Her (No Reply Yet)','For Deep''s messages without reply',     FALSE, 14),
  ('💌', 'Her Messages To Me',               'For her messages without Deep''s reply', FALSE, 15)
ON CONFLICT (title) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  when_to_use = EXCLUDED.when_to_use,
  only_if_mentioned = EXCLUDED.only_if_mentioned,
  sort_order = EXCLUDED.sort_order;

-- Everyone (signed-in users) can read the heading list; only service role can modify it
ALTER TABLE heading_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Headings are readable by authenticated users" ON heading_categories;
CREATE POLICY "Headings are readable by authenticated users"
  ON heading_categories FOR SELECT
  TO authenticated
  USING (TRUE);

-- 3) Diary entries table (adds the heading column)
CREATE TABLE IF NOT EXISTS diary_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  heading TEXT NOT NULL DEFAULT '💬 Daily Life & Important Updates',
  date_time TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  reflection TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If you already have the OLD diary_entries table (without heading), run this instead:
-- ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS heading TEXT NOT NULL DEFAULT '💬 Daily Life & Important Updates';

CREATE INDEX IF NOT EXISTS idx_diary_entries_user_id ON diary_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_created_at ON diary_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diary_entries_heading ON diary_entries(user_id, heading);

-- 4) Row Level Security on diary_entries
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own entries" ON diary_entries;
CREATE POLICY "Users can view own entries"
  ON diary_entries FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own entries" ON diary_entries;
CREATE POLICY "Users can insert own entries"
  ON diary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entries" ON diary_entries;
CREATE POLICY "Users can update own entries"
  ON diary_entries FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entries" ON diary_entries;
CREATE POLICY "Users can delete own entries"
  ON diary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- 5) Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_diary_entries_updated_at ON diary_entries;
CREATE TRIGGER update_diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Done ✅ — the app's dropdown/export/import templates use exactly these 15 headings.
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Get these values from **Settings > API** in your Supabase dashboard.

### 4. Install Dependencies & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5. Create Your Account

1. Click "Create Account" on the login page
2. Enter your email and password
3. Check your email to verify your account (if email confirmation is enabled)
4. Log in and start writing!

## 📁 Project Structure

```
src/
├── App.tsx              # Main diary app component
├── components/
│   └── Auth.tsx         # Login/signup component
├── lib/
│   └── supabase.ts      # Supabase client configuration
├── index.css            # Global styles
└── main.tsx             # App entry point

public/
└── templates/           # Import templates
    ├── diary-template.json
    └── diary-template.txt
```

## 🔒 Security

- **Row Level Security (RLS)** - Each user can only access their own entries
- **Authentication** - Supabase Auth handles secure email/password login
- **Data Isolation** - Entries are tied to user IDs, preventing cross-user access

## 📥 Import/Export

### Export Formats

- **JSON** - Full backup with all data (recommended for backups)
- **Text** - Human-readable format

### Import Formats

- **JSON** - Restore from a previous backup
- **Text (.txt/.md)** - Import entries in diary format

Templates are available for download in the import modal.

## 🛠️ Customization

### Change Theme Colors

Edit the Tailwind classes in `src/App.tsx`. The app uses amber/orange colors by default.

### Modify Entry Format

The entry format is defined in the display section of `App.tsx`. You can customize how entries are shown.

## 📝 Notes

- Entries are automatically synced to the cloud when saved
- You can access your diary from any device by logging in
- Export regularly to keep local backups
- The app uses Supabase's free tier (500MB database, 50,000 monthly active users)

## 🐛 Troubleshooting

**"Failed to load entries"**
- Check that your `.env` file has the correct Supabase URL and key
- Verify the database table was created successfully
- Check browser console for detailed error messages

**"Cannot sign up"**
- Make sure email confirmation is configured in Supabase (Settings > Authentication)
- Check spam folder for verification email

**Import not working**
- Ensure the file format matches the expected structure
- Check the browser console for parsing errors

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🙏 Credits

Built with React, Vite, Tailwind CSS, and Supabase.
