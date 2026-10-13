# 📖 My Diary - Cloud Journal

A beautiful diary/journal web application with cloud storage powered by Supabase. Write, organize, and access your diary entries from any device.

![Diary App](https://img.shields.io/badge/React-18-blue) ![Supabase](https://img.shields.io/badge/Supabase-Cloud-green) ![Tailwind](https://img.shields.io/badge/Tailwind-CSS-purple)

## ✨ Features

- 🔐 **Secure Authentication** - Email/password login with Supabase Auth
- ☁️ **Cloud Sync** - All entries stored in Supabase, accessible from any device
- 📝 **Structured Format** - Entries follow a clean, consistent format
- 📥 **Import/Export** - Import entries from JSON/text files, export as backup
- 🔍 **Search** - Find entries by content, sender, or reflection
- 📱 **Responsive Design** - Works beautifully on desktop and mobile
- 🎨 **Beautiful UI** - Warm, journal-style design with amber/orange theme

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier available)

### 1. Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd diary-app

# Install dependencies
npm install
```

### 2. Set Up Supabase

#### Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Fill in project details and wait for it to be ready (~2 minutes)

#### Configure Database

Go to **SQL Editor** in your Supabase dashboard and run this SQL:

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

**Get these values from Supabase:**
1. Go to your project dashboard
2. Navigate to **Settings > API**
3. Copy the **Project URL** and **anon/public key**

### 4. Run the App

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5. Create Your Account

1. Click "Create Account" on the login page
2. Enter your email and password (min 6 characters)
3. Check your email to verify your account (if email confirmation is enabled)
4. Log in and start writing!

## 📝 Entry Format (Heading Template)

Entries are grouped under one of 15 fixed headings. Download template files use this structure:

```
#### HEADING 1: [Topic Name]

- Message: [Date & Time] - Deep: "[Message content]"
  What I felt: [Original reflection]

- Message: [Date & Time] - 🫰🫶🏻Chota Don❣️❤️😘: "[Message content]"
  What I felt: [Original reflection]
```

### All Headings & When To Use

| Heading | When to Use |
|---------|-------------|
| 🌅 Morning & Night Greetings | For good mornings/nights |
| 💬 Daily Life & Important Updates | For daily conversations |
| 💖 Sweet Compliments & Love | For loving words |
| 👨‍👩‍👧‍👦 About Kesha (Her Sister) | ONLY if mentioned |
| 👨‍👩‍👧‍👦 About Arya (Her Brother) | ONLY if mentioned |
| 🎯 Dreams & Future Plans | For future goals |
| 🤗 Emotional Support & Care | For emotional talks |
| 😄 Fun Moments & Jokes | For funny moments |
| 🔥 Flirty Banter & Teasing | For flirty exchanges |
| 💕 Romantic Confessions | For romantic declarations |
| 💘 Attraction & Desire | For attraction talks |
| 🌙 Intimate & Passionate Talks | For intimate moments |
| 💝 Deep Chemistry & Connection | For deep connection |
| 💭 My Messages To Her (No Reply Yet) | For Deep's messages without reply |
| 💌 Her Messages To Me | For her messages without Deep's reply |

The same list is seeded into the `heading_categories` table in Supabase, shown in the app's New Entry dropdown, printed inside the Import modal, and used when exporting text backups.

## 📥 Import/Export

### Export Your Data

Click the menu (☰) button and choose:
- **Export as JSON** - Full backup with all data (recommended)
- **Export as Text** - Human-readable format

### Import Data

1. Click the menu (☰) button
2. Select "Import Entries"
3. Download a template file or use your own
4. Choose the file to import

**Supported formats:**
- `.json` - Full backup files (entries include a `heading` field)
- `.txt` / `.md` - Heading-template format (`#### HEADING N:` + `- Message:` bullets); legacy plain format still works

Templates are available for download in the import modal.

## 🔒 Security

- **Row Level Security (RLS)** - Each user can only access their own entries
- **Authentication** - Supabase Auth handles secure login
- **Data Isolation** - Entries are tied to user IDs
- **HTTPS** - All data transmitted securely

## 🛠️ Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Supabase** - Backend & database
  - Authentication
  - PostgreSQL database
  - Row Level Security

## 📁 Project Structure

```
diary-app/
├── src/
│   ├── App.tsx              # Main diary component
│   ├── components/
│   │   └── Auth.tsx         # Login/signup component
│   ├── lib/
│   │   └── supabase.ts      # Supabase client config
│   ├── index.css            # Global styles
│   ├── main.tsx             # App entry point
│   └── vite-env.d.ts        # TypeScript declarations
├── public/
│   └── templates/           # Import templates
│       ├── diary-template.json
│       └── diary-template.txt
├── .env.example             # Environment variables template
├── SUPABASE_SETUP.md        # Detailed setup guide
└── README.md                # This file
```

## 🎨 Customization

### Change Theme Colors

Edit the Tailwind classes in `src/App.tsx`. The app uses amber/orange colors by default. Look for classes like:
- `bg-amber-50`, `bg-amber-600`
- `text-amber-900`, `text-amber-700`
- `border-amber-200`

### Modify Entry Format

The entry display format is in `src/App.tsx` in the "Entry Content" section. You can customize how entries are rendered.

## 🐛 Troubleshooting

### "Failed to load entries"
- Verify `.env` file has correct Supabase URL and key
- Check that the database table was created
- Look at browser console for detailed errors

### "Cannot sign up"
- Check email confirmation settings in Supabase (Settings > Authentication)
- Look in spam folder for verification email
- Verify the anon key is correct

### Import not working
- Ensure file format matches expected structure
- Check browser console for parsing errors
- Try using the provided templates

### Build errors
- Run `npm install` to ensure all dependencies are installed
- Check that Node.js version is 18 or higher
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

## 📊 Supabase Free Tier Limits

- **Database**: 500MB
- **Storage**: 1GB
- **Bandwidth**: 5GB/month
- **Monthly Active Users**: 50,000
- **Realtime connections**: 200 concurrent

For most personal diary use cases, the free tier is more than sufficient.

## 🔄 Deployment

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Deploy to Netlify

```bash
npm run build
# Deploy the dist folder
```

Add environment variables in Netlify dashboard.

### Deploy to Other Platforms

Build the project with `npm run build` and deploy the `dist` folder. Make sure to set the environment variables on your hosting platform.

## 📝 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🙏 Acknowledgments

- [Supabase](https://supabase.com) for the amazing backend platform
- [Tailwind CSS](https://tailwindcss.com) for the utility-first CSS framework
- [React](https://reactjs.org) for the UI library

## 📧 Support

For questions or issues:
1. Check the [Supabase Setup Guide](SUPABASE_SETUP.md)
2. Review the troubleshooting section above
3. Check browser console for error messages
4. Verify your Supabase configuration

---

Made with ❤️ using React and Supabase
