# Double.net — deployment guide

This turns your site into a real, live website with its own address, using two free services:
**Supabase** (accounts, chat data, photo storage) and **Vercel** (hosting). No credit card needed for either.

---

## Step 1 — Create your Supabase project

1. Go to https://supabase.com and click **Start your project**. Sign up with GitHub, Google, or email — no card required.
2. Click **New project**. Give it any name (e.g. "double-net"), set a database password (save it somewhere, you probably won't need it again), pick the region closest to you, and click **Create new project**. Wait about a minute while it spins up.
3. Once it's ready, in the left sidebar click the **SQL Editor** icon.
4. Click **New query**, then open the `supabase/schema.sql` file from this project, copy *all* of it, and paste it into the editor.
5. Click **Run**. You should see "Success. No rows returned." This creates all the tables, security rules, and photo storage bucket in one go.
6. In the left sidebar, go to **Authentication → Providers → Email**, and turn **off** "Confirm email." (This lets people start using the site right after signing up, instead of waiting on a confirmation email — you can turn it back on later if you want that extra step.)
7. In the left sidebar, go to **Project Settings → API**. You'll need two values from this page in Step 3:
   - **Project URL**
   - **anon public** key (a long string under "Project API keys")

---

## Step 2 — Put your Supabase keys into the project

1. In this project folder, find the file called `.env.example`.
2. Make a copy of it and rename the copy to `.env`.
3. Open `.env` and paste in your values from Step 1.7:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-long-anon-key
   ```
4. Save the file.

---

## Step 3 — Put the project on GitHub

Vercel deploys straight from GitHub, so the code needs to live there first.

1. Go to https://github.com and create a free account if you don't have one.
2. Click the **+** in the top right → **New repository**. Name it `double-net`, keep it Public or Private (either works), and click **Create repository**.
3. On the new repo's page, click **uploading an existing file**, then drag in every file and folder from this project (keeping the folder structure: `src/`, `supabase/`, `package.json`, etc. — everything except `node_modules` if you have it, and don't upload your `.env` file, since it has your keys in it).
4. Click **Commit changes**.

---

## Step 4 — Deploy on Vercel

1. Go to https://vercel.com and sign up — choose **Continue with GitHub** so it can see your repos. No card required for the free Hobby plan.
2. Click **Add New… → Project**, then find and **Import** your `double-net` repo.
3. Before deploying, open **Environment Variables** and add the same two values from your `.env` file:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. In about a minute, Vercel gives you a live link like `double-net.vercel.app` — that's your real website.

---

## Step 5 — Try it

Open your new link. Since no admin account exists yet, it'll prompt you to **Set up your account** — that first account you create becomes the site's creator/admin, exactly like before. Everything else (Chats, People, Profile, Controls) works the same as what you've been using.

---

## What's different from before, and why

- **Real accounts**: Supabase Auth now handles passwords properly (industry-standard hashing, secure sessions) instead of the simplified hashing used in the Claude-artifact version.
- **Stays logged in for real**: sessions are stored by the browser and refresh automatically — no more re-entering your password every visit.
- **Photos**: uploaded to real file storage instead of being squeezed into a database as text, so the size limit is now 5MB per photo instead of ~900KB.
- **Renaming your username** no longer needs to rewrite old messages — the database links messages to your account directly, so your name just updates everywhere automatically.
- **The profanity filter still runs in your browser, not on the server.** That means it stops normal use of the chat box, but a technically determined person could bypass it by talking to Supabase directly. If that ever matters to you, the fix is a Supabase "Edge Function" that re-checks messages server-side — let me know if you want that added later.

## Costs going forward

Both services stay free under normal hobby-project use:
- **Supabase free tier**: 500MB database, 1GB file storage, 50,000 monthly users
- **Vercel free tier**: 100GB bandwidth/month, unlimited personal projects

If the site ever outgrows those limits, that's a good problem to have — it means people are actually using it.
