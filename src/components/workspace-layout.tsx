"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { KnowledgeBase, KnowledgeFile } from "@prisma/client";
import { apiRequest } from "@/lib/client-api";
import { CitationAnswer } from "./citation-answer";

type KnowledgeBaseWithFiles = KnowledgeBase & {
  files: KnowledgeFile[];
};

type SearchResult = {
  fileId: string;
  filename: string;
  score: number;
  snippet: string;
  attributes: Record<string, string | number | boolean>;
};

type ChatResult = {
  answer: string;
  citations: Array<{ fileId: string; filename: string; index: number }>;
  annotations?: Array<{ text: string; fileId: string; filename: string; index: number }>;
  warning: string | null;
};

type Candidate = {
  title: string;
  url: string;
  host: string;
  extension: string;
  reason: string;
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Array<{ fileId: string; filename: string; index: number }>;
  annotations?: Array<{ text: string; fileId: string; filename: string; index: number }>;
  warning?: string | null;
  createdAt: Date;
}

interface ChatSession {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: Date;
}

function formatDate(input: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input));
}

function formatShortTime(dateInput: Date | string) {
  const date = new Date(dateInput);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.round(diffDays / 30);
  return `${diffMonths}mo`;
}

function formatBytes(bytes: number | null) {
  if (bytes === null || bytes === undefined) return "Size n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenId(id: string, visible = 8) {
  if (id.length <= visible + 4) return id;
  return `${id.slice(0, 4)}…${id.slice(-visible)}`;
}

function normalizeSourceUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

type CandidateAddState = "idle" | "adding" | "added" | "duplicate" | "error";

function InlineSpinner({ className = "h-3 w-3 text-accent-teal" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function PanelNotice({
  tone,
  children,
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
}) {
  const styles =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300"
      : tone === "success"
        ? "border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-300"
        : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function WorkspaceLayout({
  knowledgeBases,
  activeKb,
  activeFiles: initialActiveFiles,
}: {
  knowledgeBases: KnowledgeBaseWithFiles[];
  activeKb: KnowledgeBase | null;
  activeFiles: KnowledgeFile[];
}) {
  const router = useRouter();

  // Dark/Light Theme state
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Left sidebar states
  const [projectSearch, setProjectSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<"create" | "attach">("create");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [attachId, setAttachId] = useState("");
  const [attachName, setAttachName] = useState("");

  // Settings states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState(false);

  // Chat window states
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // Right sidebar states
  const [rightTab, setRightTab] = useState<"documents" | "retrieval">("documents");
  const [addDocExpanded, setAddDocExpanded] = useState(false);
  const [addDocMethod, setAddDocMethod] = useState<"upload" | "drive" | "web">("upload");
  const [driveUrl, setDriveUrl] = useState("");
  const [webQuery, setWebQuery] = useState("");
  const [webPreset, setWebPreset] = useState("all");
  const [webCandidates, setWebCandidates] = useState<Candidate[]>([]);
  const [webSearching, setWebSearching] = useState(false);
  const [directUrl, setDirectUrl] = useState("");
  const [selectedCandidateUrls, setSelectedCandidateUrls] = useState<string[]>([]);
  const [candidateAddState, setCandidateAddState] = useState<Record<string, CandidateAddState>>({});
  const [candidateAddErrors, setCandidateAddErrors] = useState<Record<string, string>>({});
  const [bulkAdding, setBulkAdding] = useState(false);
  const [directUrlAdding, setDirectUrlAdding] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const [directUrlError, setDirectUrlError] = useState<string | null>(null);
  const [bulkAddError, setBulkAddError] = useState<string | null>(null);
  const [webSearchAttempted, setWebSearchAttempted] = useState(false);

  // Indexed document filters
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [fileFilterSource, setFileFilterSource] = useState("all");
  const [fileFilterStatus, setFileFilterStatus] = useState("all");

  // Direct retrieval search states
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrievalResults, setRetrievalResults] = useState<SearchResult[]>([]);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [retrievalWarning, setRetrievalWarning] = useState<string | null>(null);

  // Global notification states (sidebar-level successes)
  const [message, setMessage] = useState<string | null>(null);

  // Scoped API states
  const [creatingKb, setCreatingKb] = useState(false);
  const [createKbError, setCreateKbError] = useState<string | null>(null);
  const [attachingKb, setAttachingKb] = useState(false);
  const [attachKbError, setAttachKbError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);

  // Local files copy for live status updates/polling
  const [activeFiles, setActiveFiles] = useState<KnowledgeFile[]>(initialActiveFiles);

  // Load theme and API Key on mount
  useEffect(() => {
    // Theme setup
    const savedTheme = (window.localStorage.getItem("theme") as "dark" | "light") || "dark";
    setTheme(savedTheme);
    if (savedTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }

    // API Key setup
    const existing = window.sessionStorage.getItem("openai_user_key") || "";
    setApiKey(existing);
  }, []);

  // Update active files when props change
  useEffect(() => {
    setActiveFiles(initialActiveFiles);
  }, [initialActiveFiles]);

  // Polling for file statuses if there are files in PENDING or IN_PROGRESS status
  useEffect(() => {
    if (!activeKb) return;

    const hasPendingFiles = activeFiles.some(
      (file) => file.status === "PENDING" || file.status === "IN_PROGRESS"
    );

    if (!hasPendingFiles) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/knowledge-bases/${activeKb.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.knowledgeBase && data.knowledgeBase.files) {
            setActiveFiles(data.knowledgeBase.files);
          }
        }
      } catch (err) {
        console.error("Error polling files:", err);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeKb, activeFiles]);

  // Load sessions from localStorage when activeKb changes
  useEffect(() => {
    if (!activeKb) {
      setSessions([]);
      setActiveSessionId("");
      setMessages([]);
      return;
    }

    const storageKey = `kb_sessions_${activeKb.id}`;
    let loadedSessions: ChatSession[] = [];

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        loadedSessions = JSON.parse(stored);
        // Convert ISO string dates back to Date objects
        loadedSessions.forEach(s => {
          s.createdAt = new Date(s.createdAt);
          s.messages.forEach(m => {
            m.createdAt = new Date(m.createdAt);
          });
        });
      }
    } catch (e) {
      console.error("Failed to parse stored sessions:", e);
    }

    if (loadedSessions.length === 0) {
      // Create a default first session
      const defaultSession: ChatSession = {
        id: Math.random().toString(36).substr(2, 9),
        name: "Session 1",
        messages: [
          {
            id: "welcome",
            role: "system",
            content: `Connected to "${activeKb.name}". Ask me questions grounded in this knowledge base.`,
            createdAt: new Date(),
          },
        ],
        createdAt: new Date(),
      };
      loadedSessions = [defaultSession];
      window.localStorage.setItem(storageKey, JSON.stringify(loadedSessions));
    }

    setSessions(loadedSessions);
    setActiveSessionId(loadedSessions[0].id);
    setMessages(loadedSessions[0].messages);

    // Clear other states
    setRetrievalResults([]);
    setRetrievalQuery("");
    setRetrievalWarning(null);
    setWebCandidates([]);
    setWebQuery("");
    setDirectUrl("");
    setSelectedCandidateUrls([]);
    setCandidateAddState({});
    setCandidateAddErrors({});
    setDirectUrlAdding(false);
    setWebSearchError(null);
    setDirectUrlError(null);
    setBulkAddError(null);
    setWebSearchAttempted(false);
    setWebSearching(false);
    setBulkAdding(false);
    setDriveUrl("");
    setFileFilterQuery("");
    setFileFilterSource("all");
    setFileFilterStatus("all");
    setCreatingKb(false);
    setCreateKbError(null);
    setAttachingKb(false);
    setAttachKbError(null);
    setUploadingFile(false);
    setUploadError(null);
    setDriveImporting(false);
    setDriveError(null);
    setImportMessage(null);
    setChatError(null);
    setRetrievalError(null);
    setMessage(null);
  }, [activeKb?.id]);

  // Sync current messages to sessions array and localStorage
  useEffect(() => {
    if (!activeKb || !activeSessionId || sessions.length === 0) return;

    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) return;

    // Check if the messages are different to prevent an infinite update loop
    if (JSON.stringify(activeSession.messages) === JSON.stringify(messages)) return;

    const updatedSessions = sessions.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages };
      }
      return s;
    });

    setSessions(updatedSessions);
    window.localStorage.setItem(`kb_sessions_${activeKb.id}`, JSON.stringify(updatedSessions));
  }, [messages, activeSessionId, activeKb?.id]);

  // Helper to create a new chat session
  function handleCreateSession() {
    if (!activeKb) return;

    const newSession: ChatSession = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Session ${sessions.length + 1}`,
      messages: [
        {
          id: "welcome",
          role: "system",
          content: `Connected to "${activeKb.name}". Ask me questions grounded in this knowledge base.`,
          createdAt: new Date(),
        },
      ],
      createdAt: new Date(),
    };

    const updatedSessions = [...sessions, newSession];
    setSessions(updatedSessions);
    setActiveSessionId(newSession.id);
    setMessages(newSession.messages);
    window.localStorage.setItem(`kb_sessions_${activeKb.id}`, JSON.stringify(updatedSessions));
  }

  // Helper to switch chat sessions
  function handleSwitchSession(sessionId: string) {
    const targetSession = sessions.find(s => s.id === sessionId);
    if (!targetSession) return;

    setActiveSessionId(sessionId);
    setMessages(targetSession.messages);
  }

  // Scroll to bottom of chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  // Filter projects (knowledge bases) client-side
  const filteredKbs = useMemo(() => {
    if (!projectSearch.trim()) return knowledgeBases;
    const query = projectSearch.toLowerCase();
    return knowledgeBases.filter(
      (kb) =>
        kb.name.toLowerCase().includes(query) ||
        (kb.description && kb.description.toLowerCase().includes(query)) ||
        kb.vectorStoreId.toLowerCase().includes(query)
    );
  }, [knowledgeBases, projectSearch]);

  const readyFilesCount = useMemo(() => {
    return activeFiles.filter((f) => f.status === "COMPLETED").length;
  }, [activeFiles]);

  const indexedSourceUrls = useMemo(() => {
    return new Set(
      activeFiles
        .map((file) => file.sourceUrl)
        .filter((url): url is string => Boolean(url))
        .map((url) => normalizeSourceUrl(url)),
    );
  }, [activeFiles]);

  const filteredFiles = useMemo(() => {
    const query = fileFilterQuery.trim().toLowerCase();

    return activeFiles.filter((file) => {
      const matchesQuery =
        !query ||
        file.originalName.toLowerCase().includes(query) ||
        (file.sourceUrl && file.sourceUrl.toLowerCase().includes(query));

      const matchesSource =
        fileFilterSource === "all" ||
        file.importSource.toLowerCase() === fileFilterSource.toLowerCase();

      const matchesStatus =
        fileFilterStatus === "all" ||
        file.status.toLowerCase() === fileFilterStatus.toLowerCase();

      return matchesQuery && matchesSource && matchesStatus;
    });
  }, [activeFiles, fileFilterQuery, fileFilterSource, fileFilterStatus]);

  async function handleCreateKnowledgeBase() {
    if (!createName.trim()) return;

    setCreatingKb(true);
    setCreateKbError(null);
    setMessage(null);

    try {
      const result = await apiRequest<{ knowledgeBase: KnowledgeBase }>("/api/knowledge-bases/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName,
          description: createDescription || null,
        }),
      });
      setCreateName("");
      setCreateDescription("");
      setIsCreateOpen(false);
      router.push(`/kb/${result.knowledgeBase.id}`);
      router.refresh();
    } catch (caughtError) {
      setCreateKbError(
        caughtError instanceof Error ? caughtError.message : "Failed to create knowledge base.",
      );
    } finally {
      setCreatingKb(false);
    }
  }

  async function handleAttachKnowledgeBase() {
    if (!attachId.trim()) return;

    setAttachingKb(true);
    setAttachKbError(null);
    setMessage(null);

    try {
      const result = await apiRequest<{ knowledgeBase: KnowledgeBase }>("/api/knowledge-bases/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vectorStoreId: attachId,
          name: attachName || null,
        }),
      });
      setAttachId("");
      setAttachName("");
      setIsCreateOpen(false);
      router.push(`/kb/${result.knowledgeBase.id}`);
      router.refresh();
    } catch (caughtError) {
      setAttachKbError(
        caughtError instanceof Error ? caughtError.message : "Failed to attach vector store.",
      );
    } finally {
      setAttachingKb(false);
    }
  }

  async function handleUploadFile(file: File) {
    if (!activeKb) return;

    setUploadingFile(true);
    setUploadError(null);
    setImportMessage(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const res = await apiRequest<{ knowledgeFile: KnowledgeFile }>(
        `/api/knowledge-bases/${activeKb.id}/files/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      setImportMessage("Local file uploaded.");
      setActiveFiles((prev) => [res.knowledgeFile, ...prev]);
      router.refresh();
    } catch (caughtError) {
      setUploadError(
        caughtError instanceof Error ? caughtError.message : "Failed to upload file.",
      );
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleDriveImport(url: string) {
    if (!activeKb) return;

    setDriveImporting(true);
    setDriveError(null);
    setImportMessage(null);

    try {
      const result = await apiRequest<{
        knowledgeFile: KnowledgeFile;
        duplicate?: boolean;
      }>(`/api/knowledge-bases/${activeKb.id}/files/from-drive-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (result.duplicate) {
        setImportMessage("This Google Drive link is already indexed.");
      } else {
        setImportMessage("Google Drive import started.");
        setActiveFiles((prev) => [result.knowledgeFile, ...prev]);
      }
      setDriveUrl("");
      router.refresh();
    } catch (caughtError) {
      setDriveError(
        caughtError instanceof Error ? caughtError.message : "Failed to import Google Drive link.",
      );
    } finally {
      setDriveImporting(false);
    }
  }

  async function handleRetrievalSearch() {
    if (!activeKb || !retrievalQuery.trim()) return;

    setRetrievalLoading(true);
    setRetrievalError(null);
    setRetrievalWarning(null);
    setRetrievalResults([]);

    try {
      const res = await apiRequest<{ results: SearchResult[] }>(
        `/api/knowledge-bases/${activeKb.id}/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: retrievalQuery }),
        },
      );
      setRetrievalResults(res.results);
      if (res.results.length === 0) {
        setRetrievalWarning("No matching chunks found for this query.");
      }
    } catch (caughtError) {
      setRetrievalError(
        caughtError instanceof Error ? caughtError.message : "Vector search failed. Try again.",
      );
    } finally {
      setRetrievalLoading(false);
    }
  }

  async function addWebSourceUrl(url: string): Promise<{ ok: true; duplicate?: boolean } | { ok: false; error: string }> {
    if (!activeKb) {
      return { ok: false, error: "No active knowledge base selected." };
    }

    const normalized = normalizeSourceUrl(url);
    if (indexedSourceUrls.has(normalized)) {
      setCandidateAddState((prev) => ({ ...prev, [url]: "duplicate" }));
      setCandidateAddErrors((prev) => {
        const next = { ...prev };
        delete next[url];
        return next;
      });
      return { ok: true, duplicate: true };
    }

    setCandidateAddState((prev) => ({ ...prev, [url]: "adding" }));
    setCandidateAddErrors((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });

    try {
      const result = await apiRequest<{ knowledgeFile: KnowledgeFile; duplicate?: boolean }>(
        `/api/knowledge-bases/${activeKb.id}/files/from-web-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );

      if (result.duplicate) {
        setCandidateAddState((prev) => ({ ...prev, [url]: "duplicate" }));
      } else {
        setCandidateAddState((prev) => ({ ...prev, [url]: "added" }));
        setActiveFiles((prev) => [result.knowledgeFile, ...prev]);
      }
      router.refresh();
      return { ok: true, duplicate: result.duplicate };
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : "Failed to add source to knowledge base.";
      setCandidateAddState((prev) => ({ ...prev, [url]: "error" }));
      setCandidateAddErrors((prev) => ({ ...prev, [url]: errorMessage }));
      return { ok: false, error: errorMessage };
    }
  }

  async function handleDirectUrlAdd(url: string) {
    setDirectUrlError(null);
    setDirectUrlAdding(true);

    try {
      const result = await addWebSourceUrl(url);
      if (!result.ok) {
        setDirectUrlError(result.error);
        return;
      }
      if (result.duplicate) {
        setMessage("This source URL is already indexed in this knowledge base.");
        return;
      }
      setMessage("Web file added successfully.");
      setDirectUrl("");
    } finally {
      setDirectUrlAdding(false);
    }
  }

  async function handleWebSearch() {
    if (!webQuery.trim()) return;

    setWebSearching(true);
    setWebSearchError(null);
    setWebSearchAttempted(true);
    setWebCandidates([]);
    setSelectedCandidateUrls([]);
    setCandidateAddState({});
    setCandidateAddErrors({});
    setBulkAddError(null);

    try {
      const res = await apiRequest<{ candidates: Candidate[] }>("/api/web-files/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: webQuery, preset: webPreset }),
      });
      setWebCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setWebSearchError("No supported downloadable files matched this search.");
      }
    } catch (caughtError) {
      setWebSearchError(
        caughtError instanceof Error ? caughtError.message : "Web search failed. Try again in a moment.",
      );
    } finally {
      setWebSearching(false);
    }
  }

  function toggleCandidateSelection(url: string) {
    setSelectedCandidateUrls((prev) =>
      prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url],
    );
  }

  async function addSelectedCandidates() {
    if (!activeKb || selectedCandidateUrls.length === 0) return;

    setBulkAdding(true);
    setBulkAddError(null);

    let addedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    try {
      for (const url of selectedCandidateUrls) {
        const result = await addWebSourceUrl(url);
        if (!result.ok) {
          failedCount += 1;
          continue;
        }
        if (result.duplicate) {
          duplicateCount += 1;
        } else {
          addedCount += 1;
        }
      }

      setSelectedCandidateUrls([]);

      if (addedCount > 0) {
        setMessage(
          `Added ${addedCount} source${addedCount === 1 ? "" : "s"}` +
            (duplicateCount > 0 ? `, ${duplicateCount} already indexed.` : "."),
        );
      } else if (duplicateCount > 0 && failedCount === 0) {
        setMessage("Selected sources were already indexed in this knowledge base.");
      }

      if (failedCount > 0) {
        setBulkAddError(
          `${failedCount} selected source${failedCount === 1 ? "" : "s"} failed to add. Check the errors below and retry.`,
        );
      }
    } finally {
      setBulkAdding(false);
    }
  }

  function handleSaveKey() {
    if (apiKey.trim()) {
      window.sessionStorage.setItem("openai_user_key", apiKey.trim());
    } else {
      window.sessionStorage.removeItem("openai_user_key");
    }
    setSavedKey(true);
    setTimeout(() => setSavedKey(false), 2000);
    setIsSettingsOpen(false);
  }

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    window.localStorage.setItem("theme", newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!activeKb || !chatInput.trim() || chatLoading) return;

    const userQuestion = chatInput.trim();
    setChatInput("");
    setChatError(null);

    // Append user message
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      role: "user",
      content: userQuestion,
      createdAt: new Date(),
    };

    // Auto-rename session on first question
    const isFirstUserMessage = messages.filter((m) => m.role === "user").length === 0;
    if (isFirstUserMessage && sessions.length > 0) {
      const truncatedName =
        userQuestion.length > 28 ? userQuestion.slice(0, 26) + "..." : userQuestion;
      const updatedSessions = sessions.map((s) => {
        if (s.id === activeSessionId) {
          return { ...s, name: truncatedName };
        }
        return s;
      });
      setSessions(updatedSessions);
      window.localStorage.setItem(`kb_sessions_${activeKb.id}`, JSON.stringify(updatedSessions));
    }

    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const result = await apiRequest<ChatResult>(
        `/api/knowledge-bases/${activeKb.id}/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: userQuestion }),
        }
      );

      const assistantMsg: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        annotations: result.annotations,
        warning: result.warning,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : "Chat generation failed.";
      setChatError(errorMessage);
      const errorMsg: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: "system",
        content: `Error: ${caughtError instanceof Error ? caughtError.message : "Failed to generate answer."}`,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full min-w-0 overflow-hidden bg-background text-foreground">
      {/* LEFT PANEL: PROJECTS & CREATION */}
      <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-border-theme bg-sidebar sm:w-80">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-theme px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)] animate-pulse"></span>
            <span className="font-mono text-sm font-semibold tracking-wider text-slate-200 dark:text-slate-200 text-slate-800">
              KB LAB
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-card-bg hover:text-foreground transition"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? (
                <svg className="h-4.5 w-4.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
              ) : (
                <svg className="h-4.5 w-4.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Key status */}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-card-bg hover:text-foreground transition"
              title="OpenAI Runtime Settings"
            >
              <svg
                className={`h-4.5 w-4.5 ${apiKey.trim() ? "text-teal-500" : "text-amber-500"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Settings Popover Panel */}
        {isSettingsOpen && (
          <div className="border-b border-border-theme bg-card-bg/95 px-4 py-4 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground text-xs">Runtime OpenAI Key</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] bg-background text-slate-400">
                {apiKey.trim() ? "Session Key Active" : "Using .env Fallback"}
              </span>
            </div>
            <p className="text-slate-400 dark:text-slate-400 leading-relaxed text-[11px]">
              Stored only in browser memory. Stricter limits apply when using the fallback key.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 rounded border border-border-theme bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal"
              />
              <button
                onClick={handleSaveKey}
                className="rounded bg-teal-600 px-3 py-1.5 font-semibold text-white hover:bg-teal-700 transition"
              >
                Save
              </button>
            </div>
            {savedKey && (
              <p className="text-[10px] text-teal-500 text-right">Saved successfully.</p>
            )}
          </div>
        )}

        {/* Project Search & Create Action */}
        <div className="px-4 pt-4 pb-2 space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </span>
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Filter projects..."
              className="w-full rounded-xl border border-border-theme bg-input-theme py-2.5 pl-10 pr-4 text-xs text-foreground outline-none transition placeholder:text-slate-500 focus:border-accent-teal"
            />
          </div>

          <button
            onClick={() => setIsCreateOpen(!isCreateOpen)}
            className="flex w-full items-center justify-between rounded-xl border border-border-theme bg-card-bg px-4 py-2.5 text-xs font-medium text-slate-400 hover:bg-input-theme hover:text-foreground transition"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 text-accent-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Knowledge Base
            </span>
            <svg
              className={`h-4 w-4 transform transition-transform ${isCreateOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* New Project Creator Accordion */}
        {isCreateOpen && (
          <div className="border-b border-border-theme bg-input-theme px-4 py-4 space-y-4">
            <div className="flex border-b border-border-theme text-xs">
              <button
                onClick={() => {
                  setCreateTab("create");
                  setCreateKbError(null);
                  setAttachKbError(null);
                }}
                className={`flex-1 pb-2 text-center font-medium ${
                  createTab === "create" ? "border-b-2 border-accent-teal text-accent-teal" : "text-slate-400"
                }`}
              >
                Create Fresh
              </button>
              <button
                onClick={() => {
                  setCreateTab("attach");
                  setCreateKbError(null);
                  setAttachKbError(null);
                }}
                className={`flex-1 pb-2 text-center font-medium ${
                  createTab === "attach" ? "border-b-2 border-accent-teal text-accent-teal" : "text-slate-400"
                }`}
              >
                Attach Store
              </button>
            </div>

            {createTab === "create" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreateKnowledgeBase();
                }}
                className="space-y-3"
              >
                {createKbError && <PanelNotice tone="error">{createKbError}</PanelNotice>}
                <input
                  value={createName}
                  onChange={(e) => {
                    setCreateName(e.target.value);
                    if (createKbError) setCreateKbError(null);
                  }}
                  placeholder="KB Name (e.g., Pediatrics)"
                  className="w-full rounded border border-border-theme bg-card-bg px-3 py-2 text-xs text-foreground outline-none focus:border-accent-teal"
                  required
                />
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Description or audience notes"
                  rows={2}
                  className="w-full rounded border border-border-theme bg-card-bg px-3 py-2 text-xs text-foreground outline-none focus:border-accent-teal"
                />
                <button
                  type="submit"
                  disabled={creatingKb}
                  className="flex w-full items-center justify-center gap-2 rounded bg-teal-600 py-2 text-xs font-semibold text-white hover:bg-teal-700 transition disabled:opacity-60"
                >
                  {creatingKb && <InlineSpinner />}
                  {creatingKb ? "Creating..." : "Create Knowledge Base"}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAttachKnowledgeBase();
                }}
                className="space-y-3"
              >
                {attachKbError && <PanelNotice tone="error">{attachKbError}</PanelNotice>}
                <input
                  value={attachId}
                  onChange={(e) => {
                    setAttachId(e.target.value);
                    if (attachKbError) setAttachKbError(null);
                  }}
                  placeholder="OpenAI Vector Store ID (vs_...)"
                  className="w-full rounded border border-border-theme bg-card-bg px-3 py-2 text-xs text-foreground outline-none focus:border-accent-teal"
                  required
                />
                <input
                  value={attachName}
                  onChange={(e) => setAttachName(e.target.value)}
                  placeholder="Display Name (optional)"
                  className="w-full rounded border border-border-theme bg-card-bg px-3 py-2 text-xs text-foreground outline-none focus:border-accent-teal"
                />
                <button
                  type="submit"
                  disabled={attachingKb}
                  className="flex w-full items-center justify-center gap-2 rounded bg-teal-600 py-2 text-xs font-semibold text-white hover:bg-teal-700 transition disabled:opacity-60"
                >
                  {attachingKb && <InlineSpinner />}
                  {attachingKb ? "Attaching..." : "Attach Vector Store"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Projects List */}
        <div className="flex-1 min-w-0 overflow-y-auto px-2 py-4">
          <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Knowledge Bases ({filteredKbs.length})
          </div>

          <div className="space-y-2">
            {filteredKbs.map((kb) => {
              const isActive = activeKb?.id === kb.id;
              return (
                <div key={kb.id} className="flex flex-col">
                  <div
                    onClick={() => {
                      if (!isActive) {
                        router.push(`/kb/${kb.id}`);
                      }
                    }}
                    className={`flex min-w-0 flex-col gap-1.5 rounded-xl px-4 py-3 text-left transition cursor-pointer ${
                      isActive
                        ? "bg-card-bg text-foreground shadow-sm border-l-2 border-accent-teal"
                        : "text-slate-400 hover:bg-card-bg/60 hover:text-foreground"
                    }`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold">{kb.name}</span>
                      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {isActive && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCreateSession();
                            }}
                            title="New Chat Session"
                            className="text-[9px] font-bold text-accent-teal hover:text-accent-teal/85 bg-accent-teal/10 hover:bg-accent-teal/15 px-2 py-0.5 rounded cursor-pointer transition flex items-center gap-0.5"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                            New
                          </button>
                        )}
                        {!isActive && (
                          <span className="text-[9px] rounded px-1.5 py-0.5 bg-background dark:bg-slate-950/60 font-semibold tracking-wide uppercase">
                            {kb.sourceMode.toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{kb.files.length} file{kb.files.length === 1 ? "" : "s"}</span>
                      {isActive && (
                        <span className="truncate font-mono text-[9px]" title={kb.vectorStoreId}>
                          {shortenId(kb.vectorStoreId)}
                        </span>
                      )}
                    </div>
                  </div>

                  {isActive && sessions.length > 0 && (
                    <div
                      className="mt-1 ml-4 pl-3.5 border-l border-border-theme/40 space-y-0.5 my-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {sessions.map((s) => {
                        const isSessionActive = activeSessionId === s.id;
                        return (
                          <div
                            key={s.id}
                            onClick={() => handleSwitchSession(s.id)}
                            className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer select-none ${
                              isSessionActive
                                ? "text-accent-teal font-medium bg-accent-teal/5"
                                : "text-slate-400 hover:text-foreground hover:bg-card-bg/30"
                            }`}
                          >
                            <span className="truncate max-w-[160px]">{s.name}</span>
                            <span className="text-[9px] text-slate-500 group-hover:text-slate-400 transition ml-2 flex-shrink-0">
                              {formatShortTime(s.createdAt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredKbs.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-slate-500 italic">
                No knowledge bases found.
              </div>
            )}
          </div>
        </div>

        {/* Global Notifications */}
        {message && (
          <div className="p-3 border-t border-border-theme bg-input-theme text-xs">
            <div className="rounded border border-teal-950 bg-teal-950/40 p-2 text-teal-350 dark:text-teal-300">
              {message}
            </div>
          </div>
        )}
      </aside>

      {/* CENTER PANEL: CHAT WINDOW */}
      <main className="flex min-w-0 flex-1 flex-col h-full overflow-hidden bg-background">
        {activeKb ? (
          <>
            {/* Chat Header */}
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-theme bg-input-theme/80 px-4 py-4 backdrop-blur-sm sm:px-6">
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold text-foreground truncate">{activeKb.name}</h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {activeKb.description || "No description provided."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span className="rounded-full bg-accent-teal/15 border border-accent-teal/20 px-3 py-1 text-xs text-accent-teal font-medium whitespace-nowrap">
                  {readyFilesCount} / {activeFiles.length} files ready
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeKb.id);
                    setMessage("Knowledge base ID copied.");
                  }}
                  className="rounded-full px-3 py-1 font-mono text-[10px] text-slate-400 border border-border-theme bg-card-bg hover:text-foreground transition whitespace-nowrap"
                  title={activeKb.id}
                >
                  Copy KB ID
                </button>
              </div>
            </header>

            {/* Chat Message List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
                >
                  {msg.role === "system" ? (
                    <div className="mx-auto rounded-full bg-card-bg border border-border-theme px-4 py-1 text-[11px] text-slate-400">
                      {msg.content}
                    </div>
                  ) : msg.role === "user" ? (
                    <div className="max-w-[75%] rounded-2xl bg-accent-teal px-4 py-3 text-sm text-white shadow-lg shadow-teal-950/20 leading-relaxed">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[85%] rounded-2xl border border-border-theme bg-card-bg px-4 py-3.5 text-sm text-foreground shadow-sm leading-relaxed space-y-3">
                      <CitationAnswer
                        answer={msg.content}
                        citations={msg.citations}
                        annotations={msg.annotations}
                      />

                      {msg.role === "assistant" && (!msg.citations || msg.citations.length === 0) && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-300 flex gap-2 items-start mt-2">
                          <svg className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div>
                            <span className="font-semibold">Ungrounded Answer:</span> No files were retrieved or searched from the knowledge base for this question.
                          </div>
                        </div>
                      )}

                      {msg.role === "assistant" && (msg.citations && msg.citations.length > 0) && (!msg.annotations || msg.annotations.length === 0) && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-300 flex gap-2 items-start mt-2">
                          <svg className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div>
                            <span className="font-semibold">Ungrounded Answer:</span> Although files were retrieved, no grounding citations were used in this response.
                          </div>
                        </div>
                      )}

                      {msg.warning && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-300 flex gap-2 items-start mt-2">
                          <svg className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>{msg.warning}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start animate-pulse-slow">
                  <div className="rounded-2xl border border-border-theme bg-card-bg px-4 py-3 text-sm text-slate-400 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-bounce" style={{ animationDelay: "0ms" }}></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-bounce" style={{ animationDelay: "150ms" }}></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-bounce" style={{ animationDelay: "300ms" }}></span>
                    <span className="text-[11px] font-mono ml-1 text-slate-400">Searching sources...</span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chat Sticky Prompt Box */}
            {chatError && (
              <div className="border-t border-border-theme bg-input-theme px-6 pt-4">
                <PanelNotice tone="error">{chatError}</PanelNotice>
              </div>
            )}
            <form onSubmit={handleSendChat} className="border-t border-border-theme bg-input-theme px-6 py-4">
              <div className="flex items-center gap-3 bg-card-bg border border-border-theme rounded-2xl px-4 py-2 focus-within:border-accent-teal transition">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat(e);
                    }
                  }}
                  placeholder={`Ask a question grounded in ${activeKb.name}... (Press Enter to send)`}
                  className="flex-1 max-h-24 min-h-[36px] bg-transparent text-sm text-foreground placeholder-slate-500 outline-none resize-none pt-1"
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatLoading}
                  className="flex items-center justify-center h-8 w-8 rounded-xl bg-accent-teal text-white hover:opacity-90 transition disabled:opacity-40"
                  title={chatLoading ? "Generating answer..." : "Send message"}
                >
                  {chatLoading ? (
                    <InlineSpinner className="h-4 w-4 border-white/30 border-t-white" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
                <span>Grounded Answer generated with OpenAI File Search.</span>
                <span>Shift + Enter for new line.</span>
              </div>
            </form>
          </>
        ) : (
          /* Empty Workspace Welcome Screen */
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-background">
            <div className="relative mb-6">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-teal-500 to-indigo-500 opacity-20 blur-lg animate-pulse"></div>
              <div className="relative flex items-center justify-center h-20 w-20 rounded-full border border-border-theme bg-card-bg text-accent-teal">
                <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h1 className="text-3xl font-semibold text-foreground tracking-tight">Knowledge Base Lab</h1>
            <p className="mt-3 max-w-lg text-sm text-slate-400 dark:text-slate-400 leading-relaxed">
              Redesigned into a premium triple-panel workspace. Select a project in the left sidebar or create a new knowledge base to begin.
            </p>
            {knowledgeBases.length === 0 && (
              <button
                onClick={() => setIsCreateOpen(true)}
                className="mt-6 rounded-xl bg-accent-teal px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 transition"
              >
                Create First Knowledge Base
              </button>
            )}
          </div>
        )}
      </main>

      {/* RIGHT PANEL: CONTEXT, DOCUMENTS & RETRIEVAL */}
      <aside className="flex h-full w-80 min-w-80 shrink-0 flex-col overflow-hidden border-l border-border-theme bg-sidebar xl:w-96 xl:min-w-96">
        {activeKb ? (
          <>
            {/* Header / Tabs */}
            <div className="shrink-0 border-b border-border-theme">
              <div className="px-4 py-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Workspace Context</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Manage sources and run retrieval checks</p>
              </div>

              <div className="flex text-xs px-2">
                <button
                  onClick={() => setRightTab("documents")}
                  className={`min-w-0 flex-1 pb-3 text-center text-[11px] font-medium transition whitespace-nowrap sm:text-xs ${
                    rightTab === "documents"
                      ? "border-b-2 border-accent-teal text-accent-teal"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Documents ({activeFiles.length})
                </button>
                <button
                  onClick={() => setRightTab("retrieval")}
                  className={`min-w-0 flex-1 pb-3 text-center text-[11px] font-medium transition whitespace-nowrap sm:text-xs ${
                    rightTab === "retrieval"
                      ? "border-b-2 border-accent-teal text-accent-teal"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Direct Search
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
              {rightTab === "documents" ? (
                <>
                  {/* Add Documents Accordion */}
                  <div className="rounded-xl border border-border-theme bg-background overflow-hidden">
                    <button
                      onClick={() => setAddDocExpanded(!addDocExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-card-bg text-xs font-semibold text-slate-400 hover:bg-input-theme hover:text-foreground transition"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        <svg className="h-4 w-4 shrink-0 text-accent-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Add New Documents
                      </span>
                      <svg
                        className={`h-4 w-4 transform transition-transform ${addDocExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {addDocExpanded && (
                      <div className="p-4 border-t border-border-theme bg-input-theme space-y-4">
                        {importMessage && <PanelNotice tone="success">{importMessage}</PanelNotice>}
                        {/* Importer tabs */}
                        <div className="flex border-b border-border-theme text-[10px]">
                          <button
                            onClick={() => {
                              setAddDocMethod("upload");
                              setUploadError(null);
                              setDriveError(null);
                              setImportMessage(null);
                            }}
                            className={`flex-1 pb-2 text-center font-medium ${
                              addDocMethod === "upload" ? "border-b border-accent-teal text-accent-teal" : "text-slate-400"
                            }`}
                          >
                            Upload Local
                          </button>
                          <button
                            onClick={() => {
                              setAddDocMethod("drive");
                              setUploadError(null);
                              setDriveError(null);
                              setImportMessage(null);
                            }}
                            className={`flex-1 pb-2 text-center font-medium ${
                              addDocMethod === "drive" ? "border-b border-accent-teal text-accent-teal" : "text-slate-400"
                            }`}
                          >
                            Google Drive
                          </button>
                          <button
                            onClick={() => {
                              setAddDocMethod("web");
                              setUploadError(null);
                              setDriveError(null);
                              setImportMessage(null);
                            }}
                            className={`flex-1 pb-2 text-center font-medium ${
                              addDocMethod === "web" ? "border-b border-accent-teal text-accent-teal" : "text-slate-400"
                            }`}
                          >
                            Source Browser
                          </button>
                        </div>

                        {/* Upload Form */}
                        {addDocMethod === "upload" && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
                              const selectedFile = fileInput?.files?.[0];

                              if (!selectedFile) {
                                setUploadError("Select a file first.");
                                return;
                              }

                              void handleUploadFile(selectedFile).then(() => {
                                form.reset();
                              });
                            }}
                            className="space-y-3"
                          >
                            {uploadError && <PanelNotice tone="error">{uploadError}</PanelNotice>}
                            <input
                              name="file"
                              type="file"
                              onChange={() => {
                                if (uploadError) setUploadError(null);
                                if (importMessage) setImportMessage(null);
                              }}
                              className="w-full rounded border border-border-theme bg-card-bg px-2 py-1.5 text-xs text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-teal-950/20 dark:file:bg-teal-950 file:px-2 file:py-1 file:font-semibold file:text-accent-teal"
                              required
                            />
                            <button
                              type="submit"
                              disabled={uploadingFile}
                              className="flex w-full items-center justify-center gap-2 rounded bg-accent-teal py-1.5 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-60"
                            >
                              {uploadingFile && <InlineSpinner />}
                              {uploadingFile ? "Uploading..." : "Upload File"}
                            </button>
                          </form>
                        )}

                        {/* Google Drive Import Form */}
                        {addDocMethod === "drive" && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!driveUrl.trim() || driveImporting) return;
                              void handleDriveImport(driveUrl.trim());
                            }}
                            className="space-y-3"
                          >
                            {driveError && <PanelNotice tone="error">{driveError}</PanelNotice>}
                            <input
                              value={driveUrl}
                              onChange={(e) => {
                                setDriveUrl(e.target.value);
                                if (driveError) setDriveError(null);
                                if (importMessage) setImportMessage(null);
                              }}
                              placeholder="Public link to Docs, Slides, Sheets..."
                              className="w-full rounded border border-border-theme bg-card-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal"
                              required
                            />
                            <button
                              type="submit"
                              disabled={driveImporting || !driveUrl.trim()}
                              className="flex w-full items-center justify-center gap-2 rounded bg-accent-teal py-1.5 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-60"
                            >
                              {driveImporting && <InlineSpinner />}
                              {driveImporting ? "Submitting..." : "Import Link"}
                            </button>
                          </form>
                        )}

                        {/* Source Browser */}
                        {addDocMethod === "web" && (
                          <div className="space-y-3">
                            {(webSearchError || directUrlError || bulkAddError) && (
                              <div className="space-y-2">
                                {directUrlError && <PanelNotice tone="error">{directUrlError}</PanelNotice>}
                                {webSearchError && <PanelNotice tone="error">{webSearchError}</PanelNotice>}
                                {bulkAddError && <PanelNotice tone="error">{bulkAddError}</PanelNotice>}
                              </div>
                            )}

                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!directUrl.trim() || directUrlAdding) return;
                                void handleDirectUrlAdd(directUrl.trim());
                              }}
                              className="space-y-2"
                            >
                              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Direct URL
                              </label>
                              <div className="flex gap-2">
                                <input
                                  value={directUrl}
                                  onChange={(e) => {
                                    setDirectUrl(e.target.value);
                                    if (directUrlError) setDirectUrlError(null);
                                  }}
                                  placeholder="https://example.com/paper.pdf"
                                  disabled={directUrlAdding}
                                  className="flex-1 rounded border border-border-theme bg-card-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal disabled:opacity-60"
                                />
                                <button
                                  type="submit"
                                  disabled={directUrlAdding || !directUrl.trim()}
                                  className="inline-flex items-center gap-1.5 rounded bg-accent-teal px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
                                >
                                  {directUrlAdding ? (
                                    <>
                                      <InlineSpinner className="h-3 w-3 text-white" />
                                      Adding
                                    </>
                                  ) : (
                                    "Add"
                                  )}
                                </button>
                              </div>
                            </form>

                            <div className="space-y-2 border-t border-border-theme pt-3">
                              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Web Discovery
                              </label>
                              <div className="flex gap-2">
                                <input
                                  value={webQuery}
                                  onChange={(e) => {
                                    setWebQuery(e.target.value);
                                    if (webSearchError) setWebSearchError(null);
                                  }}
                                  placeholder="WHO guidelines, papers..."
                                  disabled={webSearching}
                                  className="flex-1 rounded border border-border-theme bg-card-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal disabled:opacity-60"
                                />
                                <select
                                  value={webPreset}
                                  onChange={(e) => setWebPreset(e.target.value)}
                                  disabled={webSearching}
                                  className="rounded border border-border-theme bg-card-bg px-2 py-1.5 text-xs text-slate-500 outline-none focus:border-accent-teal disabled:opacity-60"
                                >
                                  <option value="all">All</option>
                                  <option value="pmc">PubMed</option>
                                  <option value="who">WHO</option>
                                  <option value="india">India</option>
                                  <option value="books">Books</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleWebSearch()}
                                  disabled={webSearching || !webQuery.trim()}
                                  className="inline-flex items-center gap-1.5 rounded bg-accent-teal px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
                                >
                                  {webSearching ? (
                                    <>
                                      <InlineSpinner className="h-3 w-3 text-white" />
                                      Searching
                                    </>
                                  ) : (
                                    "Find"
                                  )}
                                </button>
                              </div>
                            </div>

                            {webSearching && (
                              <div className="flex items-center gap-2 rounded-lg border border-border-theme bg-card-bg px-3 py-3 text-[11px] text-slate-500">
                                <InlineSpinner />
                                Searching the web for supported files...
                              </div>
                            )}

                            {!webSearching && webSearchAttempted && webCandidates.length === 0 && !webSearchError && (
                              <PanelNotice tone="info">
                                No supported downloadable files matched this search. Try a different query or preset.
                              </PanelNotice>
                            )}

                            {webCandidates.length > 0 && (
                              <div className="space-y-2 pt-2 border-t border-border-theme">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-slate-500">
                                    {bulkAdding ? (
                                      <span className="inline-flex items-center gap-1.5">
                                        <InlineSpinner />
                                        Adding selected sources...
                                      </span>
                                    ) : (
                                      `${selectedCandidateUrls.length} selected`
                                    )}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void addSelectedCandidates()}
                                    disabled={bulkAdding || selectedCandidateUrls.length === 0}
                                    className="inline-flex items-center gap-1.5 rounded bg-card-bg px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-accent-teal hover:text-white transition disabled:opacity-40"
                                  >
                                    {bulkAdding ? (
                                      <>
                                        <InlineSpinner className="h-3 w-3" />
                                        Adding...
                                      </>
                                    ) : (
                                      "Add Selected"
                                    )}
                                  </button>
                                </div>

                                <div className="max-h-56 overflow-y-auto space-y-2">
                                  {webCandidates.map((c) => {
                                    const addState = candidateAddState[c.url] ?? "idle";
                                    const addError = candidateAddErrors[c.url];
                                    const isIndexed =
                                      indexedSourceUrls.has(normalizeSourceUrl(c.url)) ||
                                      addState === "duplicate";
                                    const isSelected = selectedCandidateUrls.includes(c.url);

                                    return (
                                      <div
                                        key={c.url}
                                        className={`rounded border bg-background p-2 text-[10px] space-y-1 ${
                                          addState === "error"
                                            ? "border-rose-500/30"
                                            : "border-border-theme"
                                        }`}
                                      >
                                        <div className="flex items-start gap-2">
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleCandidateSelection(c.url)}
                                            disabled={
                                              isIndexed ||
                                              addState === "added" ||
                                              addState === "adding" ||
                                              bulkAdding
                                            }
                                            className="mt-0.5"
                                          />
                                          <div className="min-w-0 flex-1 space-y-1">
                                            <div
                                              className="font-semibold text-slate-300 dark:text-slate-300 truncate"
                                              title={c.title}
                                            >
                                              {c.title}
                                            </div>
                                            <div className="text-slate-500 truncate">
                                              {c.host} · .{c.extension}
                                            </div>
                                            <p className="text-slate-400 text-[9px] leading-tight line-clamp-2">
                                              {c.reason}
                                            </p>
                                          </div>
                                        </div>

                                        {addState === "error" && addError && (
                                          <PanelNotice tone="error">{addError}</PanelNotice>
                                        )}

                                        <button
                                          type="button"
                                          onClick={() => {
                                            void (async () => {
                                              const result = await addWebSourceUrl(c.url);
                                              if (result.ok && !result.duplicate) {
                                                setMessage("Web file added successfully.");
                                              } else if (result.ok && result.duplicate) {
                                                setMessage("This source URL is already indexed in this knowledge base.");
                                              }
                                            })();
                                          }}
                                          disabled={
                                            isIndexed ||
                                            addState === "adding" ||
                                            addState === "added" ||
                                            bulkAdding
                                          }
                                          className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded bg-card-bg py-1 font-semibold text-slate-500 hover:bg-accent-teal hover:text-white transition text-[9px] disabled:opacity-50"
                                        >
                                          {addState === "adding" ? (
                                            <>
                                              <InlineSpinner className="h-3 w-3" />
                                              Adding...
                                            </>
                                          ) : isIndexed ? (
                                            "Already indexed"
                                          ) : addState === "added" ? (
                                            "Added"
                                          ) : addState === "error" ? (
                                            "Retry add"
                                          ) : (
                                            "Add File to KB"
                                          )}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Document Filters */}
                  <div className="rounded-xl border border-border-theme bg-background p-3 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Filter Documents
                    </div>
                    <input
                      value={fileFilterQuery}
                      onChange={(e) => setFileFilterQuery(e.target.value)}
                      placeholder="Search by name or URL..."
                      className="w-full rounded border border-border-theme bg-card-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal"
                    />
                    <div className="flex flex-col gap-2">
                      <select
                        value={fileFilterSource}
                        onChange={(e) => setFileFilterSource(e.target.value)}
                        className="flex-1 rounded border border-border-theme bg-card-bg px-2 py-1.5 text-xs text-slate-500 outline-none focus:border-accent-teal"
                      >
                        <option value="all">All sources</option>
                        <option value="local">Local</option>
                        <option value="drive">Drive</option>
                        <option value="web">Web</option>
                        <option value="external">External</option>
                      </select>
                      <select
                        value={fileFilterStatus}
                        onChange={(e) => setFileFilterStatus(e.target.value)}
                        className="flex-1 rounded border border-border-theme bg-card-bg px-2 py-1.5 text-xs text-slate-500 outline-none focus:border-accent-teal"
                      >
                        <option value="all">All statuses</option>
                        <option value="completed">Completed</option>
                        <option value="pending">Pending</option>
                        <option value="in_progress">In progress</option>
                        <option value="failed">Failed</option>
                      </select>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Showing {filteredFiles.length} of {activeFiles.length} files
                    </div>
                  </div>

                  {/* Documents List */}
                  <div className="space-y-2">
                    {filteredFiles.map((file) => (
                      <article
                        key={file.id}
                        className="rounded-xl border border-border-theme bg-background p-3.5 space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground truncate" title={file.originalName}>
                              {file.originalName}
                            </h3>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mt-0.5 block">
                              Source: {file.importSource.toLowerCase()}
                            </span>
                            {file.sourceUrl && (
                              <a
                                href={file.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-accent-teal hover:underline truncate block mt-0.5"
                                title={file.sourceUrl}
                              >
                                {file.sourceUrl}
                              </a>
                            )}
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-semibold flex items-center gap-1.5 ${
                              file.status === "COMPLETED"
                                ? "bg-accent-teal/10 text-accent-teal border border-accent-teal/20"
                                : file.status === "FAILED"
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                            }`}
                          >
                            {file.status === "IN_PROGRESS" || file.status === "PENDING" ? (
                              <svg className="animate-spin h-2.5 w-2.5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            ) : null}
                            {file.status.toLowerCase()}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 pt-1 border-t border-border-theme/40">
                          <span>{formatBytes(file.bytes)}</span>
                          <span>{formatDate(file.createdAt)}</span>
                        </div>
                      </article>
                    ))}

                    {filteredFiles.length === 0 && (
                      <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-500 italic">
                        {activeFiles.length === 0
                          ? "No files indexed in this KB. Expand the section above to upload files."
                          : "No files match the current filters."}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* Retrieval Search Panel */
                <div className="space-y-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRetrievalSearch();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={retrievalQuery}
                      onChange={(e) => {
                        setRetrievalQuery(e.target.value);
                        if (retrievalError) setRetrievalError(null);
                      }}
                      placeholder="Enter search phrase..."
                      className="flex-1 rounded border border-border-theme bg-card-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent-teal"
                    />
                    <button
                      type="submit"
                      disabled={retrievalLoading || !retrievalQuery.trim()}
                      className="flex items-center gap-1.5 rounded bg-accent-teal px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-60"
                    >
                      {retrievalLoading && <InlineSpinner />}
                      {retrievalLoading ? "Searching..." : "Search"}
                    </button>
                  </form>

                  {retrievalLoading && (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                      <InlineSpinner />
                      Running OpenAI vector search...
                    </div>
                  )}

                  {retrievalError && <PanelNotice tone="error">{retrievalError}</PanelNotice>}

                  {retrievalWarning && <PanelNotice tone="info">{retrievalWarning}</PanelNotice>}

                  <div className="space-y-3">
                    {retrievalResults.map((r, i) => (
                      <article
                        key={`${r.fileId}-${i}`}
                        className="rounded-xl border border-border-theme bg-background p-3 space-y-2 text-xs"
                      >
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="font-semibold text-foreground truncate max-w-[180px]">
                            {r.filename}
                          </span>
                          <span className="rounded bg-accent-teal/10 text-accent-teal border border-accent-teal/20 px-1.5 py-0.5 text-[9px] font-bold">
                            Score: {r.score.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-[11px] whitespace-pre-wrap bg-input-theme p-2 rounded border border-border-theme">
                          {r.snippet}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Empty Right Sidebar Placeholder */
          <div className="flex flex-col items-center justify-center p-8 h-full text-center text-slate-500 bg-sidebar/50">
            <svg className="h-8 w-8 mb-2 opacity-30 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-xs">No active project context</p>
          </div>
        )}
      </aside>
    </div>
  );
}
