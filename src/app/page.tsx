"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  CheckCircle2,
  Globe2,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Play,
  RotateCcw,
  Send,
  Square,
  Type,
  Volume2,
} from "lucide-react";

const DEFAULT_BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:8000";
const SERVER_BACKEND =
  process.env.NEXT_PUBLIC_SERVER_BACKEND_API_URL ||
  "https://iplvr.it.ntnu.no/backend";

const languageOptions = [
  {
    code: "es",
    label: "Spanish",
    nativeLabel: "Espanol",
    placeholder: "Escribe o habla en espanol...",
  },
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    placeholder: "Write or speak in English...",
  },
  {
    code: "no",
    label: "Norwegian",
    nativeLabel: "Norsk",
    placeholder: "Skriv eller snakk pa norsk...",
  },
];

type Sender = "user" | "agent";

interface Role {
  name: string;
  description: string;
  document_access: string[];
}

interface AgentInfo {
  agent_id: string;
  name: string;
  roles: Role[];
}

interface FunctionCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface ContextUsed {
  document_name: string;
  category?: string;
  chunk_index: number;
  content: string;
}

interface ChatMessage {
  id: string;
  role: Sender;
  content: string;
  translation?: string;
  contextUsed?: ContextUsed[];
  functionCalls?: FunctionCall[];
}

interface SpeechPayload {
  audio_base64: string;
  mime_type: string;
  format: string;
  engine: string;
  voice: string;
  language: string;
}

interface ApiError {
  title: string;
  message: string;
}

interface TranslationCacheValue {
  translatedText: string;
}

const id = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const splitLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const decodeHtmlEntities = (value: string) => {
  if (typeof window === "undefined") return value;
  const element = document.createElement("textarea");
  element.innerHTML = value;
  return element.value;
};

const normalizeBackend = (value: string) => value.trim().replace(/\/$/, "");

const playableAudioUrl = (speech?: SpeechPayload) =>
  speech?.audio_base64 && speech.mime_type
    ? `data:${speech.mime_type};base64,${speech.audio_base64}`
    : "";

export default function LanguageChatPage() {
  const [backendMode, setBackendMode] = useState<"local" | "server" | "custom">(
    "local"
  );
  const [customBackend, setCustomBackend] = useState(DEFAULT_BACKEND);
  const [accessKey, setAccessKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [setupError, setSetupError] = useState<ApiError | null>(null);
  const [chatError, setChatError] = useState<ApiError | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState("");
  const [lastSpeechUrl, setLastSpeechUrl] = useState("");
  const [studyPanelTitle, setStudyPanelTitle] = useState("Study panel");
  const [studySource, setStudySource] = useState("");
  const [studyTranslation, setStudyTranslation] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [warmupMessage, setWarmupMessage] = useState("");
  const [userInformation, setUserInformation] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const translationCacheRef = useRef<Map<string, TranslationCacheValue>>(
    new Map()
  );

  const selectedLanguage = useMemo(
    () =>
      languageOptions.find((language) => language.code === targetLanguage) ||
      languageOptions[0],
    [targetLanguage]
  );

  const backendUrl = useMemo(() => {
    if (backendMode === "server") return normalizeBackend(SERVER_BACKEND);
    if (backendMode === "custom") return normalizeBackend(customBackend);
    return normalizeBackend(DEFAULT_BACKEND);
  }, [backendMode, customBackend]);

  const normalizedRole = roleName.trim();

  const playSpeech = useCallback((speech?: SpeechPayload) => {
    const url = playableAudioUrl(speech);
    if (!url) return;
    setLastSpeechUrl(url);
    const audio = new Audio(url);
    audio.play().catch(() => {
      setChatError({
        title: "Playback blocked",
        message: "Use the replay button to play the response audio.",
      });
    });
  }, []);

  const buildCommandPayload = useCallback(
    (chatLog: ChatMessage[]) => ({
      agent_id: agentInfo?.agent_id,
      active_role_id: normalizedRole,
      access_key: accessKey.trim(),
      chat_log: chatLog.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      session_id: sessionId,
      progress_limit: 5,
      user_information: splitLines(userInformation),
    }),
    [accessKey, agentInfo?.agent_id, normalizedRole, sessionId, userInformation]
  );

  const requestTranslation = async (text: string, title: string) => {
    if (!text.trim()) return;
    const normalizedText = text.trim();
    const cacheKey = `${backendUrl}|${targetLanguage}|en|${normalizedText}`;
    const cachedTranslation = translationCacheRef.current.get(cacheKey);

    setIsTranslating(true);
    setStudyPanelTitle(title);
    setStudySource(normalizedText);
    setStudyTranslation("");

    if (cachedTranslation) {
      setStudyTranslation(cachedTranslation.translatedText);
      setIsTranslating(false);
      return;
    }

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: normalizedText,
          source: targetLanguage,
          target: "en",
          backendUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStudyTranslation(data.message || "Translation failed.");
        return;
      }
      const translatedText = decodeHtmlEntities(data.translatedText);
      translationCacheRef.current.set(cacheKey, { translatedText });
      setStudyTranslation(translatedText);
    } catch (error) {
      setStudyTranslation(
        error instanceof Error ? error.message : "Translation failed."
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSetupError(null);

    if (!accessKey.trim() || !normalizedRole) {
      setSetupError({
        title: "Missing setup",
        message: "Enter an agent access key and role.",
      });
      return;
    }

    setIsConnecting(true);
    try {
      const agentResponse = await fetch(`${backendUrl}/agent-info-by-accesskey`, {
        headers: { "access-key": accessKey.trim() },
      });
      const resolvedAgent = (await agentResponse.json()) as AgentInfo | ApiError;
      if (!agentResponse.ok) {
        throw new Error(
          "message" in resolvedAgent
            ? resolvedAgent.message
            : "Could not resolve the access key."
        );
      }

      const agent = resolvedAgent as AgentInfo;
      const roleExists = agent.roles.some((role) => role.name === normalizedRole);
      if (!roleExists) {
        throw new Error(
          `Role '${normalizedRole}' was not found. Available roles: ${
            agent.roles.map((role) => role.name).join(", ") || "none"
          }`
        );
      }

      const sessionResponse = await fetch(
        `${backendUrl}/api/progress/session?agent_id=${agent.agent_id}`,
        { headers: { "access-key": accessKey.trim() } }
      );
      const sessionData = await sessionResponse.json();

      setAgentInfo(agent);
      setSessionId(sessionData.session_id || "");
      setMessages([
        {
          id: id(),
          role: "agent",
          content: `Hola. Soy ${agent.name}. Practiquemos ${selectedLanguage.label}.`,
        },
      ]);
    } catch (error) {
      setSetupError({
        title: "Connection failed",
        message: error instanceof Error ? error.message : "Unable to connect.",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const warmSpeech = useCallback(async () => {
    if (!agentInfo) return;
    setWarmupMessage("Warming speech services...");
    try {
      await Promise.allSettled([
        fetch(`${backendUrl}/api/chat/stt/warmup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: targetLanguage }),
        }),
        fetch(`${backendUrl}/api/chat/tts/warmup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: targetLanguage }),
        }),
      ]);
      setWarmupMessage("Voice is ready.");
    } catch {
      setWarmupMessage("Voice warmup failed. Text chat still works.");
    }
  }, [agentInfo, backendUrl, targetLanguage]);

  useEffect(() => {
    const warmupTimer = window.setTimeout(() => {
      void warmSpeech();
    }, 0);
    return () => window.clearTimeout(warmupTimer);
  }, [warmSpeech]);

  useEffect(() => {
    if (!agentInfo) return;

    const warmupTimer = window.setTimeout(() => {
      void fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warmup: true,
          source: targetLanguage,
          target: "en",
          backendUrl,
        }),
      }).catch(() => {
        // Translation remains optional; failures are shown only when requested.
      });
    }, 0);

    return () => window.clearTimeout(warmupTimer);
  }, [agentInfo, backendUrl, targetLanguage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAwaitingResponse]);

  useEffect(() => {
    return () => {
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    };
  }, [recordedAudioUrl]);

  const sendTextPrompt = async () => {
    const content = prompt.trim();
    if (!content || !agentInfo || isAwaitingResponse) return;

    const userMessage: ChatMessage = { id: id(), role: "user", content };
    const chatLog = [...messages, userMessage];
    setMessages(chatLog);
    setPrompt("");
    setChatError(null);
    setIsAwaitingResponse(true);

    try {
      const response = await fetch(`${backendUrl}/api/chat/askWithSpeech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: buildCommandPayload(chatLog),
          tts_language: targetLanguage,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "The agent did not respond.");
      }

      const agentMessage: ChatMessage = {
        id: id(),
        role: "agent",
        content: data.response?.response || "",
        contextUsed: data.response?.context_used || [],
        functionCalls: data.response?.function_calls || [],
      };
      setMessages((current) => [...current, agentMessage]);
      playSpeech(data.speech);
    } catch (error) {
      setChatError({
        title: "Chat error",
        message:
          error instanceof Error ? error.message : "Unable to ask the agent.",
      });
    } finally {
      setIsAwaitingResponse(false);
    }
  };

  const askWithRecordedAudio = async () => {
    if (!recordedAudio || !agentInfo || isAwaitingResponse) return;

    setChatError(null);
    setIsAwaitingResponse(true);
    const formData = new FormData();
    formData.append("audio", recordedAudio, "student-audio.webm");
    formData.append("data", JSON.stringify(buildCommandPayload(messages)));
    formData.append("tts_language", targetLanguage);
    formData.append("stt_language", targetLanguage);

    try {
      const response = await fetch(`${backendUrl}/api/chat/askTranscribeWithSpeech`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Voice request failed.");
      }

      const userMessage: ChatMessage = {
        id: id(),
        role: "user",
        content: data.transcription || "[Audio]",
      };
      const agentMessage: ChatMessage = {
        id: id(),
        role: "agent",
        content: data.response?.response || "",
        contextUsed: data.response?.context_used || [],
        functionCalls: data.response?.function_calls || [],
      };
      setMessages((current) => [...current, userMessage, agentMessage]);
      playSpeech(data.speech);
      setRecordedAudio(null);
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl("");
    } catch (error) {
      setChatError({
        title: "Voice error",
        message:
          error instanceof Error ? error.message : "Unable to ask with audio.",
      });
    } finally {
      setIsAwaitingResponse(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setChatError({
        title: "Microphone unavailable",
        message: "This browser does not support microphone recording.",
      });
      return;
    }

    setChatError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    mediaChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) mediaChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudio(blob);
      setRecordedAudioUrl(URL.createObjectURL(blob));
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendTextPrompt();
    }
  };

  const reset = () => {
    setAgentInfo(null);
    setMessages([]);
    setSessionId("");
    setRecordedAudio(null);
    setRecordedAudioUrl("");
    setLastSpeechUrl("");
    setStudySource("");
    setStudyTranslation("");
    setWarmupMessage("");
  };

  const renderMessageContent = (message: ChatMessage) => {
    if (message.role !== "agent") return message.content;
    return message.content.split(/(\s+)/).map((part, index) => {
      if (/^\s+$/.test(part)) return part;
      const word = part.replace(/^[^\w]+|[^\w]+$/g, "");
      if (!word) return part;
      return (
        <button
          key={`${message.id}-${index}`}
          type="button"
          className="word-button"
          onClick={() => requestTranslation(word, "Word translation")}
        >
          {part}
        </button>
      );
    });
  };

  if (!agentInfo) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_430px]">
          <section className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-1 text-sm text-[var(--muted)]">
              <Globe2 className="h-4 w-4 text-[var(--primary)]" />
              Local RAGdoll language practice
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Practice speaking with a local AI language partner.
              </h1>
              <p className="max-w-xl text-lg leading-8 text-[var(--muted)]">
                Connect an agent access key, choose a role and language, then
                type or speak. Responses come back as text and local voice
                output from the RAGdoll backend.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Feature icon={<Mic />} label="Speak naturally" />
              <Feature icon={<Volume2 />} label="Hear replies" />
              <Feature icon={<BookOpen />} label="Tap words" />
            </div>
          </section>

          <form
            onSubmit={connect}
            className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-sm"
          >
            <div className="mb-5 space-y-1">
              <h2 className="text-xl font-semibold">Start a session</h2>
              <p className="text-sm text-[var(--muted)]">
                Use an access key from a configured RAGdoll agent.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium">Backend</span>
                <div className="grid grid-cols-3 gap-2">
                  {(["local", "server", "custom"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBackendMode(mode)}
                      className={`min-h-10 rounded-md border px-3 text-sm font-medium ${
                        backendMode === mode
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : "border-[var(--line)] bg-white"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </label>

              {backendMode === "custom" && (
                <input
                  value={customBackend}
                  onChange={(event) => setCustomBackend(event.target.value)}
                  className="min-h-11 w-full rounded-md border border-[var(--line)] px-3 outline-none focus:border-[var(--primary)]"
                  placeholder="https://example.com/backend"
                />
              )}

              <div className="break-all rounded-md bg-[#f2eee7] px-3 py-2 font-mono text-xs text-[var(--muted)]">
                {backendUrl}
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Language</span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className="min-h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 outline-none focus:border-[var(--primary)]"
                >
                  {languageOptions.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Agent access key</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-3 left-3 h-5 w-5 text-[var(--muted)]" />
                  <input
                    value={accessKey}
                    onChange={(event) => setAccessKey(event.target.value)}
                    className="min-h-11 w-full rounded-md border border-[var(--line)] px-10 outline-none focus:border-[var(--primary)]"
                    type="password"
                    autoComplete="off"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Role</span>
                <input
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  className="min-h-11 w-full rounded-md border border-[var(--line)] px-3 outline-none focus:border-[var(--primary)]"
                  placeholder="student"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Learner notes</span>
                <textarea
                  value={userInformation}
                  onChange={(event) => setUserInformation(event.target.value)}
                  className="min-h-20 w-full resize-none rounded-md border border-[var(--line)] px-3 py-2 outline-none focus:border-[var(--primary)]"
                  placeholder="Optional: one fact per line, e.g. Beginner level"
                />
              </label>

              {setupError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <div className="font-medium">{setupError.title}</div>
                  <div>{setupError.message}</div>
                </div>
              )}

              <button
                type="submit"
                disabled={isConnecting}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 font-medium text-white disabled:opacity-60"
              >
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Lock className="h-5 w-5" />
                )}
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-white">
              <Globe2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold">{agentInfo.name}</div>
              <div className="text-sm text-[var(--muted)]">
                {selectedLanguage.label} practice as {normalizedRole}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-md bg-[#f2eee7] px-3 py-2 text-xs text-[var(--muted)] sm:flex">
            <CheckCircle2 className="h-4 w-4 text-[var(--primary)]" />
            {warmupMessage || "Connected"}
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-medium"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-[calc(100vh-4rem)] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-lg px-4 py-3 shadow-sm sm:max-w-[72%] ${
                    message.role === "user"
                      ? "bg-[var(--primary)] text-white"
                      : "border border-[var(--line)] bg-white"
                  }`}
                >
                  <div className="whitespace-pre-wrap leading-7">
                    {renderMessageContent(message)}
                  </div>
                  {message.role === "agent" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          requestTranslation(message.content, "Full response")
                        }
                        className="rounded-md bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--accent)]"
                      >
                        Translate
                      </button>
                      {lastSpeechUrl && (
                        <button
                          type="button"
                          onClick={() => new Audio(lastSpeechUrl).play()}
                          className="rounded-md bg-[#eef4f2] px-3 py-1.5 text-sm font-medium text-[var(--primary)]"
                        >
                          Replay voice
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
            {isAwaitingResponse && (
              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for response...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {chatError && (
            <div className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mx-6">
              <div className="font-medium">{chatError.title}</div>
              <div>{chatError.message}</div>
            </div>
          )}

          {recordedAudioUrl && (
            <div className="mx-4 mb-3 rounded-lg border border-[var(--line)] bg-white p-3 sm:mx-6">
              <div className="mb-2 text-sm font-medium">Recorded prompt</div>
              <audio controls src={recordedAudioUrl} className="w-full" />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={askWithRecordedAudio}
                  disabled={isAwaitingResponse}
                  className="min-h-10 rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-white"
                >
                  Ask with recording
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecordedAudio(null);
                    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
                    setRecordedAudioUrl("");
                  }}
                  className="min-h-10 rounded-md border border-[var(--line)] bg-white px-4 text-sm font-medium"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-[var(--line)] bg-white p-3 sm:p-4">
            <div className="mx-auto flex max-w-4xl items-end gap-2">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isAwaitingResponse}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-white ${
                  isRecording ? "bg-[var(--accent)]" : "bg-[var(--primary)]"
                }`}
                aria-label={isRecording ? "Stop recording" : "Record"}
              >
                {isRecording ? (
                  <Square className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
              <div className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[#fbfaf7] px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Type className="h-3.5 w-3.5" />
                  {selectedLanguage.nativeLabel}
                </div>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handlePromptKeyDown}
                  rows={2}
                  className="max-h-32 min-h-12 w-full resize-none bg-transparent outline-none"
                  placeholder={selectedLanguage.placeholder}
                  disabled={isAwaitingResponse}
                />
              </div>
              <button
                type="button"
                onClick={sendTextPrompt}
                disabled={!prompt.trim() || isAwaitingResponse}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-white disabled:opacity-50"
                aria-label="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <aside className="border-t border-[var(--line)] bg-[#fbfaf7] p-4 lg:border-t-0 lg:border-l">
          <div className="sticky top-20 space-y-4">
            <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-[var(--primary)]" />
                <h2 className="font-semibold">{studyPanelTitle}</h2>
              </div>
              {studySource ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      {selectedLanguage.label}
                    </div>
                    <p className="mt-1 leading-7">{studySource}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      English
                    </div>
                    <p className="mt-1 leading-7 text-[var(--primary)]">
                      {isTranslating ? "Translating..." : studyTranslation}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-6 text-[var(--muted)]">
                  Tap an agent word or use Translate on a response to inspect
                  meaning in English.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-[var(--primary)]" />
                <h2 className="font-semibold">Voice</h2>
              </div>
              <p className="text-sm leading-6 text-[var(--muted)]">
                Responses are generated by the local RAGdoll backend using the
                configured Piper voice for {selectedLanguage.label}.
              </p>
              {lastSpeechUrl && (
                <button
                  type="button"
                  onClick={() => new Audio(lastSpeechUrl).play()}
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white text-sm font-medium"
                >
                  <Play className="h-4 w-4" />
                  Replay last response
                </button>
              )}
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Feature({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-white p-3 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eef4f2] text-[var(--primary)]">
        {icon}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
