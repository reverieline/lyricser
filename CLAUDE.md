# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

This is a small Node.js/Express app for managing lyric text files and generating PowerPoint presentations from a playlist of songs. The app has three main parts:

- a server that exposes song-management and PPTX-generation APIs
- a browser UI served from `public/index.html`
- a `lyrics/` directory of plain UTF-8 `.txt` files that act as the content source

There is no frontend build step; the client logic lives inline in the HTML file.

## Architecture and flow

- `index.js` and `app.js` currently contain the same server implementation. `Dockerfile` starts `index.js`, while `package.json` points `main` at `app.js`. If you change server behavior, keep both files in sync or consolidate them first.
- The Express app mounts a router under `BASE_PATH` (`/` by default) and serves static files from `public/`.
- The browser UI talks to relative endpoints such as `./api/songs`, so changes to `BASE_PATH` need to stay compatible with those relative requests.
- Song files are listed, read, created, and updated through the API, but the source of truth is still the files in `lyrics/`.
- PPTX generation uses `pptxgenjs` to build a temporary presentation in `temp/`, downloads it to the client, and then deletes the temp file.
- The generator uses a single black slide master with a shared body placeholder and a watermark image from `public/logo.png`. Blank lines inside a lyric file split that file into separate slides; empty slides are inserted before each song and once at the end.
- The UI is a single-page editor/playlist builder with an inline script: song list, song editor, playlist ordering, and a generate button all live in `public/index.html`.

## Common commands

```bash
npm install
npm start
npm run dev
```

- `npm start` runs the server with Node.
- `npm run dev` runs the same app through `nodemon` for local iteration.
- There is no build script in `package.json`; the app runs directly from source.
- There is no test script or automated test suite configured yet, so there is no standard single-test command at the moment.
- For containerized development, use `docker compose up --build` from the repo root.

## Runtime configuration

- `PORT` controls the HTTP port; it defaults to `3000`.
- `BASE_PATH` controls the mount path for the router; Docker Compose sets it to `/lyricser`.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` enable basic auth for song editing and creation. If `ADMIN_USERNAME` is empty, editing is unrestricted.

## Repo-specific things to keep in mind

- The repository is content-heavy: most of the interesting data is in `lyrics/`, not in code.
- Filenames in `lyrics/` are user-facing song titles and may contain spaces, punctuation, and non-ASCII characters.
- `public/index.html` is intentionally self-contained; avoid introducing a separate frontend build unless you are restructuring the app on purpose.
- The temporary PPTX output path is created on demand and cleaned up after download, so `temp/` is a generated working directory rather than source content.
