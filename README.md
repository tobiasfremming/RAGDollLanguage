# RAGdoll Language

RAGdoll Language is a separate external frontend for practicing a target language with a configured RAGdoll agent.

It is intended for students learning Spanish first, but the UI supports the current backend TTS languages:

- English
- Norwegian
- Spanish

The app talks to the RAGdoll backend with an agent access key and role. Agents, prompts, documents, model keys, and roles are still configured in the RAGdoll config application.

## Features

- Mobile and desktop chat interface.
- Type or record microphone input.
- Uses `/api/chat/askWithSpeech` for typed prompts.
- Uses `/api/chat/askTranscribeWithSpeech` for microphone prompts.
- Plays local Piper TTS audio returned from the backend.
- Tap words in an agent response to request an English translation.
- Translate a full agent response.
- Translation is handled by the RAGdoll backend through local LibreTranslate.
- Translation is on-demand and cached for repeated words/phrases.

## Local Development

Create `.env` from the example:

```powershell
Copy-Item .env.example .env
```

Install dependencies:

```powershell
npm install
```

Run the app:

```powershell
npm run dev
```

Open:

```text
http://localhost:3010
```

The default local backend is:

```text
http://localhost:8000
```

## Docker

Build and run:

```powershell
docker compose up -d --build
```

Open:

```text
http://localhost:3010
```

Override the port:

```powershell
$env:LANGUAGE_APP_PORT=4010
docker compose up -d --build
```

## Required RAGdoll Backend Setup

The backend must have:

- A configured agent.
- An agent access key.
- A role name.
- STT available for microphone input.
- TTS voices installed for the selected language.

For Piper TTS voice setup, see:

```text
../RAGdoll/docs/manuals/tts_piper_voice_setup.md
```

## Translation

Translation requests are proxied to the selected RAGdoll backend:

```text
RAGdollLanguage -> RAGdoll /api/translate -> local LibreTranslate
```

This keeps translation inside the same self-hosted environment when the RAGdoll backend is deployed with the included LibreTranslate container.

The language app does not need a Google Translate API key.

Translations are not requested automatically for every response. The original
agent answer is shown immediately, and translation is requested only when a
student taps a word or clicks Translate. The app keeps a browser-session cache,
and the RAGdoll backend keeps a short-lived in-memory cache, so repeated words
and phrases are fast without permanently storing student text.

## Deployment Notes

For deployment behind a reverse proxy path, set:

```env
NEXT_PUBLIC_BASE_PATH=/language
```

For deployment next to the existing RAGdoll server, set:

```env
NEXT_PUBLIC_BACKEND_API_URL=https://iplvr.it.ntnu.no/backend
NEXT_PUBLIC_SERVER_BACKEND_API_URL=https://iplvr.it.ntnu.no/backend
```

The app itself does not need direct database access. It only calls the RAGdoll backend.
