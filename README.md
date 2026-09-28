# Nova Studio — Open When Multi-Client

This is the simplified Nova Studio customer platform.

## What it does
- One Nova Studio owner/admin account.
- Owner creates unlimited customer accounts.
- Each customer has a private editor.
- Customers can add unlimited letters.
- Customers can add multiple photos to each letter.
- Customers can upload a home photo.
- Customers can choose a theme.
- Customers can upload an audio song or provide an audio URL.
- Each customer gets a public `/open/<slug>` page.
- SQLite stores customer data; uploads are stored on the same persistent volume.

## Important hosting note
This app needs persistent storage because it uses SQLite and stores uploaded photos/audio on disk.
For a cloud deployment, mount a persistent volume at `/app/storage` and set:
- `DATA_DIR=/app/storage/data`
- `UPLOAD_DIR=/app/storage/uploads`
- `NODE_ENV=production`
- `SESSION_SECRET=<long-random-secret>`

## Railway
The repository includes `Dockerfile` and `railway.json` for a simple Railway deployment.
Create a persistent volume mounted at `/app/storage` so customer data and uploads survive restarts/deploys.

## Local
```bash
npm install
npm start
```
Open `http://localhost:3000/setup` on first run to create the Nova Studio admin account.
