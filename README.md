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

-- Security Policies
CREATE POLICY "Users can view own entries"
  ON diary_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own entries"
  ON diary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own entries"
  ON diary_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own entries"
  ON diary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

## 📝 Entry Format

Each diary entry follows this structure:

```
Message: [Date & Time] - [Sender Name]: "[Message content]"
What I felt: [Original reflection]
```

Example:
```
Message: January 15, 2026, 10:30 AM - John: "Today I had a wonderful conversation with an old friend."
What I felt: I felt grateful for the connection and reminded of the importance of friendships.
```

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
- `.json` - Full backup files
- `.txt` / `.md` - Text format files

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
