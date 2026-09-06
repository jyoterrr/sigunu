# Deploying Sigunu to Render

Sigunu deploys as **one Docker web service** (the server also serves the built web app,
so there's a single public URL) plus a **managed Postgres** database. The `render.yaml`
blueprint in this repo sets both up for you.

## 1. Push the repo to GitHub

From the project folder:

```bash
git remote add origin https://github.com/<your-username>/sigunu.git
git push -u origin main
```

(Create an empty repo named `sigunu` on github.com first — no README/license, so the
push isn't rejected. If your branch is `master`, use `git push -u origin master`.)

> Your `.env` is git-ignored, so your LiveKit secret is **not** pushed. You'll set the
> secrets in Render's dashboard instead.

## 2. Create the services on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
2. Click **New +  →  Blueprint**.
3. Pick your `sigunu` repo. Render reads `render.yaml` and shows a web service
   (`sigunu`) + a Postgres database (`sigunu-db`).
4. It will prompt for the env vars marked secret. Enter:
   - `LIVEKIT_URL` = `wss://sigunu-rr4139hr.livekit.cloud`
   - `LIVEKIT_API_KEY` = `APIzEfFBEViNsSG`
   - `LIVEKIT_API_SECRET` = *(your secret)*
   - `ANTHROPIC_API_KEY` = *(only if you want the PDF-import feature; can leave blank)*
5. Click **Apply**. Render builds the Docker image, provisions Postgres, applies the
   schema (`prisma db push` runs on start), and boots the app.

## 3. Share the link

When the service is live, Render gives you a URL like
`https://sigunu.onrender.com`. That's the link to send your friends:

- **You**: open it, go to **Host → Create a new session**, then open the **host
  console** and share the **join code** it shows.
- **Friends**: open the same link, **Join a quiz**, enter the code + a name, pick a
  team or play solo. Camera/mic work because the link is HTTPS; video/audio flow
  through LiveKit Cloud, independent of anyone's network.

## Things to know (free tier)

- **Cold starts**: Render's free web service sleeps after ~15 min idle; the first visit
  after that takes ~30–60s to wake. Fine for a casual game; upgrade to avoid it.
- **Uploaded media is ephemeral**: images/videos/audio you attach to questions live on
  the instance's disk, which is wiped on each redeploy/restart. The quiz text, options,
  scores, and everything in Postgres persist. For permanent media, add object storage
  (S3/Cloudflare R2) later, or attach a Render persistent disk (paid).
- **Free Postgres expires** after ~30 days on Render — fine for a demo; create a fresh
  one (or upgrade) for anything ongoing.
- **Scale/cost**: a real ~100-participant session will exceed the LiveKit free tier
  (metered) and wants a paid Render instance. The code is built for 100 in one room;
  the free tiers are for testing.

## Redeploying after code changes

```bash
git push
```

Render auto-deploys on push to the connected branch.
