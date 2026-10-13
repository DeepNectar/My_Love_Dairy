# 📖 My Diary - Cloud Journal with Supabase

A beautiful diary/journal web app with cloud storage powered by Supabase. Write entries in a structured format, import/export your data, and access your diary from any device.

## ✨ Features

- 🔐 **Secure Authentication** - Email/password login with Supabase Auth
- ☁️ **Cloud Sync** - All entries stored in Supabase, accessible from any device
- 📝 **Structured Format** - Entries follow a clean format:
  ```
  Message: [Date & Time] - [Sender Name]: "[Message content]"
  What I felt: [Original reflection]
  ```
- 📥 **Import/Export** - Import entries from JSON or text files, export as backup
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
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create diary_entries table
CREATE TABLE diary_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date_time TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  reflection TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_diary_entries_user_id ON diary_entries(user_id);
CREATE INDEX idx_diary_entries_created_at ON diary_entries(created_at DESC);

-- Enable Row Level Security
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own entries
CREATE POLICY "Users can view own entries"
  ON diary_entries FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own entries
CREATE POLICY "Users can insert own entries"
  ON diary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own entries
CREATE POLICY "Users can update own entries"
  ON diary_entries FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own entries
CREATE POLICY "Users can delete own entries"
  ON diary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
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
