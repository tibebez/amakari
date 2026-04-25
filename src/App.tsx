import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mockGuides } from "./data.mock";

import type { ProcessGuide } from "./types";

const PROGRESS_STORAGE_KEY = "process-path-progress";
const USER_GUIDES_STORAGE_KEY = "process-path-user-guides";
const FAVORITES_STORAGE_KEY = "process-path-favorite-guides";

type ProgressByGuide = Record<string, Record<string, boolean>>;
type UploadStatus = { type: "success" | "error"; message: string } | null;
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};
type ChatByGuide = Record<string, ChatMessage[]>;
type ProcessReference = {
  id: string;
  title: string;
  institution: string;
  region: string;
};
type FloatingChatMessage = ChatMessage & {
  references?: ProcessReference[];
};
type AiAggregatedReply = {
  answer: string;
  references: ProcessReference[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProcessGuide(value: unknown): value is ProcessGuide {
  if (!isObject(value)) {
    return false;
  }

  const contactLinks = value.contactLinks;
  const steps = value.steps;

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    typeof value.institution === "string" &&
    typeof value.region === "string" &&
    typeof value.language === "string" &&
    typeof value.summary === "string" &&
    isStringArray(value.prerequisites) &&
    isStringArray(value.requiredDocuments) &&
    typeof value.fees === "string" &&
    typeof value.deadlines === "string" &&
    typeof value.estimatedTime === "string" &&
    Array.isArray(contactLinks) &&
    contactLinks.every(
      (link) => isObject(link) && typeof link.label === "string" && typeof link.url === "string",
    ) &&
    value.sourceType === "community-contributed" &&
    typeof value.version === "number" &&
    typeof value.updatedAt === "string" &&
    (value.alternativeOf === undefined || typeof value.alternativeOf === "string") &&
    Array.isArray(steps) &&
    steps.every(
      (step) =>
        isObject(step) &&
        typeof step.id === "string" &&
        typeof step.title === "string" &&
        typeof step.description === "string" &&
        isStringArray(step.requiredDocuments) &&
        typeof step.cost === "string" &&
        typeof step.expectedDuration === "string" &&
        (step.actionMode === "online" || step.actionMode === "offline") &&
        typeof step.officeUrl === "string" &&
        typeof step.sourceReferenceUrl === "string",
    )
  );
}

function getInitialProgress(): ProgressByGuide {
  const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as ProgressByGuide;
  } catch {
    return {};
  }
}

function getInitialUserGuides(): ProcessGuide[] {
  const raw = localStorage.getItem(USER_GUIDES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isProcessGuide);
  } catch {
    return [];
  }
}

function saveProgress(progress: ProgressByGuide): void {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

function saveUserGuides(guides: ProcessGuide[]): void {
  localStorage.setItem(USER_GUIDES_STORAGE_KEY, JSON.stringify(guides));
}

function getInitialFavoriteGuideIds(): string[] {
  const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavoriteGuideIds(guideIds: string[]): void {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(guideIds));
}

function checklistContent(guide: ProcessGuide, completed: Record<string, boolean>): string {
  const lines = [
    `${guide.title} (${guide.region})`,
    `Institution: ${guide.institution}`,
    `Category: ${guide.category}`,
    `Version: v${guide.version} (${guide.updatedAt})`,
    "",
    "Checklist",
  ];

  for (const step of guide.steps) {
    const done = completed[step.id] ? "[x]" : "[ ]";
    lines.push(`${done} ${step.title}`);
  }

  return lines.join("\n");
}

function uniqueBy<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
  };
}

function toProcessReference(guide: ProcessGuide): ProcessReference {
  return {
    id: guide.id,
    title: guide.title,
    institution: guide.institution,
    region: guide.region,
  };
}

function getGuideRelevanceScore(question: string, guide: ProcessGuide): number {
  const normalizedQuestion = question.toLowerCase();
  const keywords = normalizedQuestion
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);

  if (keywords.length === 0) {
    return 0;
  }

  const titleText = guide.title.toLowerCase();
  const summaryText = guide.summary.toLowerCase();
  const categoryText = guide.category.toLowerCase();
  const institutionText = guide.institution.toLowerCase();
  const regionText = guide.region.toLowerCase();
  const docsText = guide.requiredDocuments.join(" ").toLowerCase();
  const prerequisiteText = guide.prerequisites.join(" ").toLowerCase();
  const stepText = guide.steps
    .map((step) => `${step.title} ${step.description} ${step.requiredDocuments.join(" ")}`)
    .join(" ")
    .toLowerCase();

  let score = 0;

  for (const keyword of keywords) {
    if (titleText.includes(keyword)) score += 6;
    if (summaryText.includes(keyword)) score += 4;
    if (categoryText.includes(keyword)) score += 3;
    if (institutionText.includes(keyword)) score += 2;
    if (regionText.includes(keyword)) score += 2;
    if (docsText.includes(keyword)) score += 2;
    if (prerequisiteText.includes(keyword)) score += 2;
    if (stepText.includes(keyword)) score += 1;
  }

  return score;
}

function parseAiAggregatedReply(
  rawText: string,
  fallbackReferences: ProcessReference[],
): AiAggregatedReply {
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch?.[1]?.trim() ?? rawText.trim();

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (isObject(parsed) && typeof parsed.answer === "string" && Array.isArray(parsed.references)) {
      const safeReferences = parsed.references
        .filter(
          (reference) =>
            isObject(reference) &&
            typeof reference.id === "string" &&
            typeof reference.title === "string" &&
            typeof reference.institution === "string" &&
            typeof reference.region === "string",
        )
        .map((reference) => ({
          id: reference.id,
          title: reference.title,
          institution: reference.institution,
          region: reference.region,
        }));

      return {
        answer: parsed.answer,
        references: safeReferences.length > 0 ? safeReferences : fallbackReferences,
      };
    }
  } catch {
    // keep fallback below
  }

  return {
    answer: rawText,
    references: fallbackReferences,
  };
}

export function App() {
  const { t, i18n } = useTranslation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const floatingChatThreadRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [institution, setInstitution] = useState("all");
  const [region, setRegion] = useState("all");
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressByGuide>(() => getInitialProgress());
  const [userGuides, setUserGuides] = useState<ProcessGuide[]>(() => getInitialUserGuides());
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(null);
  const [chatByGuide, setChatByGuide] = useState<ChatByGuide>({});
  const [chatInput, setChatInput] = useState("");
  const [favoriteGuideIds, setFavoriteGuideIds] = useState<string[]>(() =>
    getInitialFavoriteGuideIds(),
  );
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [isFloatingChatLoading, setIsFloatingChatLoading] = useState(false);
  const [floatingChatInput, setFloatingChatInput] = useState("");
  const [floatingChatMessages, setFloatingChatMessages] = useState<FloatingChatMessage[]>(() => [
    createMessage(
      "assistant",
      "Hi! I can search across multiple process guides and give you one aggregated answer.",
    ),
  ]);

  const useLocalStorage = true;

  const allGuides = useMemo(() => {
    const byId = new Map<string, ProcessGuide>();

    for (const guide of mockGuides) {
      byId.set(guide.id, guide);
    }

    for (const guide of userGuides) {
      byId.set(guide.id, guide);
    }

    return [...byId.values()];
  }, [userGuides]);

  const favoriteGuideIdSet = useMemo(() => new Set(favoriteGuideIds), [favoriteGuideIds]);

  const categories = useMemo(() => uniqueBy(allGuides.map((guide) => guide.category)), [allGuides]);
  const institutions = useMemo(
    () => uniqueBy(allGuides.map((guide) => guide.institution)),
    [allGuides],
  );
  const regions = useMemo(() => uniqueBy(allGuides.map((guide) => guide.region)), [allGuides]);

  const filteredGuides = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return allGuides
      .filter((guide) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          guide.title.toLowerCase().includes(normalizedQuery) ||
          guide.summary.toLowerCase().includes(normalizedQuery) ||
          guide.category.toLowerCase().includes(normalizedQuery);

        const matchesCategory = category === "all" || guide.category === category;
        const matchesInstitution = institution === "all" || guide.institution === institution;
        const matchesRegion = region === "all" || guide.region === region;
        const matchesFavorites = !favoritesOnly || favoriteGuideIdSet.has(guide.id);

        return (
          matchesQuery && matchesCategory && matchesInstitution && matchesRegion && matchesFavorites
        );
      })
      .sort((a, b) => {
        const favoriteDelta =
          Number(favoriteGuideIdSet.has(b.id)) - Number(favoriteGuideIdSet.has(a.id));

        if (favoriteDelta !== 0) {
          return favoriteDelta;
        }

        return a.title.localeCompare(b.title);
      });
  }, [allGuides, category, favoriteGuideIdSet, favoritesOnly, institution, query, region]);

  const selectedGuide = selectedGuideId
    ? (filteredGuides.find((guide) => guide.id === selectedGuideId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedGuideId) {
      return;
    }

    const stillVisible = filteredGuides.some((guide) => guide.id === selectedGuideId);
    if (!stillVisible) {
      setSelectedGuideId(null);
    }
  }, [filteredGuides, selectedGuideId]);

  useEffect(() => {
    if (!selectedGuide) {
      return;
    }

    setChatByGuide((current) => {
      if (current[selectedGuide.id]) {
        return current;
      }

      return {
        ...current,
        [selectedGuide.id]: [],
      };
    });

    setChatInput("");
  }, [selectedGuide, t]);

  const selectedProgress = selectedGuide ? (progress[selectedGuide.id] ?? {}) : {};
  const selectedChat = selectedGuide ? (chatByGuide[selectedGuide.id] ?? []) : [];

  useEffect(() => {
    if (!chatThreadRef.current) {
      return;
    }

    chatThreadRef.current.scrollTo({
      top: chatThreadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedGuide?.id, selectedChat.length]);

  useEffect(() => {
    if (!floatingChatThreadRef.current) {
      return;
    }

    floatingChatThreadRef.current.scrollTo({
      top: floatingChatThreadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [floatingChatMessages.length, isFloatingChatOpen]);

  const completedSteps = selectedGuide
    ? selectedGuide.steps.filter((step) => selectedProgress[step.id]).length
    : 0;

  const completionPercent = selectedGuide
    ? Math.round((completedSteps / selectedGuide.steps.length) * 100)
    : 0;

  const toggleStep = (guideId: string, stepId: string) => {
    setProgress((current) => {
      const guideProgress = current[guideId] ?? {};
      const nextProgress = {
        ...current,
        [guideId]: {
          ...guideProgress,
          [stepId]: !guideProgress[stepId],
        },
      };
      saveProgress(nextProgress);
      return nextProgress;
    });
  };

  const toggleFavoriteGuide = (guideId: string) => {
    setFavoriteGuideIds((current) => {
      const isFavorite = current.includes(guideId);
      const next = isFavorite ? current.filter((id) => id !== guideId) : [...current, guideId];
      saveFavoriteGuideIds(next);
      return next;
    });
  };

  const handleGuideUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const uploadedGuides = Array.isArray(parsed) ? parsed : [parsed];

      if (uploadedGuides.length === 0 || !uploadedGuides.every(isProcessGuide)) {
        throw new Error("invalid-format");
      }

      setUserGuides((current) => {
        const byId = new Map<string, ProcessGuide>(current.map((guide) => [guide.id, guide]));

        for (const guide of uploadedGuides) {
          byId.set(guide.id, guide);
        }

        const nextGuides = [...byId.values()];
        saveUserGuides(nextGuides);
        return nextGuides;
      });

      setUploadStatus({
        type: "success",
        message: t("uploadProcessSuccess", { count: uploadedGuides.length }),
      });
    } catch {
      setUploadStatus({
        type: "error",
        message: t("uploadProcessError"),
      });
    } finally {
      event.target.value = "";
    }
  };

  const downloadChecklist = () => {
    if (!selectedGuide) {
      return;
    }

    const content = checklistContent(selectedGuide, selectedProgress);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedGuide.id}-checklist.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };


  const sendChatMessage = () => {
    if (!selectedGuide) {
      return;
    }

    const question = chatInput.trim();
    if (!question) {
      return;
    }

    const userMessage = createMessage("user", question);

    setChatByGuide((current) => {
      const currentThread = current[selectedGuide.id] ?? [];
      return {
        ...current,
        [selectedGuide.id]: [...currentThread, userMessage],
      };
    });

    setChatInput("");
  };

  const openGuideFromReference = (guideId: string) => {
    setQuery("");
    setCategory("all");
    setInstitution("all");
    setRegion("all");
    setSelectedGuideId(guideId);
  };

  const sendFloatingChatMessage = async () => {
    const question = floatingChatInput.trim();
    if (!question || isFloatingChatLoading) {
      return;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    const matchedGuides = allGuides
      .map((guide) => ({
        guide,
        score: getGuideRelevanceScore(question, guide) + (favoriteGuideIdSet.has(guide.id) ? 3 : 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.guide);

    const fallbackReferences = matchedGuides.map(toProcessReference);

    const userMessage = createMessage("user", question);
    setFloatingChatMessages((current) => [...current, userMessage]);
    setFloatingChatInput("");

    if (!apiKey) {
      setFloatingChatMessages((current) => [
        ...current,
        {
          ...createMessage("assistant", t("floatingChatMissingKey")),
          references: fallbackReferences,
        },
      ]);
      return;
    }

    if (matchedGuides.length === 0) {
      setFloatingChatMessages((current) => [
        ...current,
        createMessage("assistant", t("floatingChatNoSourceMatch")),
      ]);
      return;
    }

    setIsFloatingChatLoading(true);

    try {
      const sourceContext = matchedGuides
        .map((guide) => {
          const steps = guide.steps
            .map(
              (step) =>
                `- ${step.title}: ${step.description} | Docs: ${step.requiredDocuments.join(", ")}`,
            )
            .join("\n");

          return [
            `Guide ID: ${guide.id}`,
            `Title: ${guide.title}`,
            `Institution: ${guide.institution}`,
            `Region: ${guide.region}`,
            `Category: ${guide.category}`,
            `Summary: ${guide.summary}`,
            `Prerequisites: ${guide.prerequisites.join(", ")}`,
            `Required documents: ${guide.requiredDocuments.join(", ")}`,
            `Fees: ${guide.fees}`,
            `Deadlines: ${guide.deadlines}`,
            `Estimated time: ${guide.estimatedTime}`,
            "Steps:",
            steps,
          ].join("\n");
        })
        .join("\n\n---\n\n");

      const google = createGoogleGenerativeAI({ apiKey });
      const result = await generateText({
        model: google("gemini-2.5-flash"),
        system:
          'You are an assistant that aggregates multiple process sources into one concise response. Return valid JSON only with this shape: {"answer": string, "references": [{"id": string, "title": string, "institution": string, "region": string}]}. In the answer, mention key differences across sources when relevant.',
        prompt: `User question:\n${question}\n\nProcess sources:\n${sourceContext}\n\nReturn an aggregated answer and include only references from the provided sources.`,
      });

      const parsed = parseAiAggregatedReply(result.text, fallbackReferences);
      const assistantMessage: FloatingChatMessage = {
        ...createMessage("assistant", parsed.answer),
        references: parsed.references,
      };

      setFloatingChatMessages((current) => [...current, assistantMessage]);
    } catch {
      setFloatingChatMessages((current) => [
        ...current,
        {
          ...createMessage("assistant", t("floatingChatError")),
          references: fallbackReferences,
        },
      ]);
    } finally {
      setIsFloatingChatLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>{t("appTitle")}</h1>
          <p>{t("appSubtitle")}</p>
        </div>
        <div className="topbar-actions">
          <label htmlFor="lang-select">{t("language")}</label>
          <select
            id="lang-select"
            value={i18n.language}
            onChange={(event) => {
              void i18n.changeLanguage(event.target.value);
            }}
          >
            <option value="en">English</option>
            <option value="am">አማርኛ (Amharic)</option>
          </select>
        </div>
      </header>

      <section className="status-banner">
        <p>{t("signInHint")}</p>
        <small>
          Local Storage: <strong>{useLocalStorage ? "enabled" : "disabled"}</strong>
        </small>
      </section>

      <section className="upload-panel" aria-live="polite">
        <div>
          <h2>{t("uploadProcessTitle")}</h2>
          <p>{t("uploadProcessHint")}</p>
        </div>
        <div className="upload-actions">
          <input
            ref={uploadInputRef}
            className="upload-input"
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              void handleGuideUpload(event);
            }}
          />
          <button
            type="button"
            className="upload-trigger"
            onClick={() => uploadInputRef.current?.click()}
          >
            {t("uploadProcessCta")}
          </button>
        </div>
        {uploadStatus ? (
          <p className={`upload-message upload-message-${uploadStatus.type}`}>
            {uploadStatus.message}
          </p>
        ) : null}
      </section>

      <section className="layout">
        <section className="panel search-top">
          <div className="search-header">
            <h2>{t("filterTitle")}</h2>
          </div>
          <div className="search-bar-row">
            <label className="search-input-wrapper">
              <span className="sr-only">{t("keyword")}</span>
              <input
                className="search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search processes (tax, permit, driver...)"
              />
            </label>
            <div className="filter-selects">
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">
                  {t("category")}: {t("all")}
                </option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select value={institution} onChange={(event) => setInstitution(event.target.value)}>
                <option value="all">
                  {t("institution")}: {t("all")}
                </option>
                {institutions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="all">
                  {t("region")}: {t("all")}
                </option>
                {regions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <label className="favorites-only-toggle">
                <input
                  type="checkbox"
                  checked={favoritesOnly}
                  onChange={(event) => setFavoritesOnly(event.target.checked)}
                />
                <span>{t("favoritesOnly")}</span>
              </label>
            </div>
          </div>

          <div className="guide-grid" role="list">
            {filteredGuides.map((guide) => {
              const guideProgress = progress[guide.id] ?? {};
              const guideCompletedSteps = guide.steps.filter(
                (step) => guideProgress[step.id],
              ).length;
              const guidePercent = Math.round((guideCompletedSteps / guide.steps.length) * 100);
              const isFavorite = favoriteGuideIdSet.has(guide.id);

              return (
                <button
                  key={guide.id}
                  type="button"
                  role="listitem"
                  className="guide-card"
                  onClick={() => setSelectedGuideId(guide.id)}
                >
                  <div className="guide-card-main">
                    <div className="guide-card-title-row">
                      <strong>{guide.title}</strong>
                      {isFavorite ? <span className="favorite-pill">★ {t("favorite")}</span> : null}
                    </div>
                    <small>
                      {guide.institution} • {guide.region}
                    </small>
                  </div>
                  {guideCompletedSteps > 0 && (
                    <div className="guide-card-progress">
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${guidePercent}%` }} />
                      </div>
                      <small>{guidePercent}%</small>
                    </div>
                  )}
                </button>
              );
            })}
            {filteredGuides.length === 0 ? <p className="no-results">{t("noResults")}</p> : null}
          </div>
        </section>

        {selectedGuide && (
          <div className="dialog-overlay" onClick={() => setSelectedGuideId(null)}>
            <dialog className="dialog-sidebar" open onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <h2>{selectedGuide.title}</h2>
                <div className="dialog-header-actions">
                  <button
                    type="button"
                    className={`favorite-btn ${favoriteGuideIdSet.has(selectedGuide.id) ? "is-favorite" : ""}`}
                    onClick={() => toggleFavoriteGuide(selectedGuide.id)}
                  >
                    {favoriteGuideIdSet.has(selectedGuide.id) ? t("unfavorite") : t("favorite")}
                  </button>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={() => setSelectedGuideId(null)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="dialog-content">
                <p className="summary-text">{selectedGuide.summary}</p>
                <div className="metadata">
                  <p>
                    {t("version")}: v{selectedGuide.version}
                  </p>
                  <p>
                    {t("updatedAt")}: {selectedGuide.updatedAt}
                  </p>
                </div>

                <div className="facts-grid">
                  <article>
                    <h3>{t("processDetails")}</h3>
                    <ul>
                      <li>
                        <strong>{t("category")}:</strong> {selectedGuide.category}
                      </li>
                      <li>
                        <strong>{t("institution")}:</strong> {selectedGuide.institution}
                      </li>
                      <li>
                        <strong>{t("region")}:</strong> {selectedGuide.region}
                      </li>
                      <li>
                        <strong>{t("fees")}:</strong> {selectedGuide.fees}
                      </li>
                      <li>
                        <strong>{t("deadlines")}:</strong> {selectedGuide.deadlines}
                      </li>
                      <li>
                        <strong>{t("estimatedTime")}:</strong> {selectedGuide.estimatedTime}
                      </li>
                      <li>
                        <strong>{t("sourceType")}:</strong> {selectedGuide.sourceType}
                      </li>
                    </ul>
                  </article>

                  <article>
                    <h3>{t("prerequisites")}</h3>
                    <ul>
                      {selectedGuide.prerequisites.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>

                    <h3>{t("requiredDocuments")}</h3>
                    <ul>
                      {selectedGuide.requiredDocuments.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>

                    <h3>{t("contactLinks")}</h3>
                    <ul>
                      {selectedGuide.contactLinks.map((link) => (
                        <li key={link.url}>
                          <a href={link.url} target="_blank" rel="noreferrer">
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </article>
                </div>

                <div className="progress-row">
                  <div>
                    <h3>{t("progress")}</h3>
                    <p>
                      {completedSteps}/{selectedGuide.steps.length} • {completionPercent}%
                    </p>
                  </div>
                  <div className="progress-actions">
                    <button type="button" onClick={() => window.print()}>
                      {t("printChecklist")}
                    </button>
                    <button type="button" onClick={downloadChecklist}>
                      {t("downloadChecklist")}
                    </button>
                  </div>
                </div>

                <section className="chat-panel">
                  <div className="chat-panel-header">
                    <h3>{t("chatTitle")}</h3>
                  </div>

                  <div className="chat-thread" ref={chatThreadRef} aria-live="polite">
                    {selectedChat.map((message) => (
                      <article
                        key={message.id}
                        className={`chat-message chat-message-${message.role}`}
                      >
                        <small>
                          {message.role === "assistant"
                            ? t("chatAssistantLabel")
                            : t("chatUserLabel")}
                        </small>
                        <p>{message.content}</p>
                      </article>
                    ))}
                  </div>

                  <form
                    className="chat-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendChatMessage();
                    }}
                  >
                    <input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder={t("chatPlaceholder")}
                    />
                    <button type="submit">{t("chatSend")}</button>
                  </form>
                </section>

                <ol className="step-list">
                  {selectedGuide.steps.map((step) => (
                    <li key={step.id}>
                      <div className="step-heading">
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedProgress[step.id])}
                            onChange={() => toggleStep(selectedGuide.id, step.id)}
                          />
                          <span>{step.title}</span>
                        </label>
                        <small>
                          {t("mode")}: {step.actionMode}
                        </small>
                      </div>
                      <p>{step.description}</p>
                      <ul>
                        <li>
                          <strong>{t("requiredDocuments")}:</strong>{" "}
                          {step.requiredDocuments.join(", ")}
                        </li>
                        <li>
                          <strong>{t("cost")}:</strong> {step.cost}
                        </li>
                        <li>
                          <strong>{t("duration")}:</strong> {step.expectedDuration}
                        </li>
                        <li>
                          <strong>{t("officeOrUrl")}:</strong>{" "}
                          <a href={step.officeUrl} target="_blank" rel="noreferrer">
                            {step.officeUrl}
                          </a>
                        </li>
                        <li>
                          <strong>{t("sourceReference")}:</strong>{" "}
                          <a href={step.sourceReferenceUrl} target="_blank" rel="noreferrer">
                            {step.sourceReferenceUrl}
                          </a>
                        </li>
                      </ul>
                    </li>
                  ))}
                </ol>
              </div>
            </dialog>
          </div>
        )}
      </section>

      <div className="floating-chat-root">
        {isFloatingChatOpen ? (
          <section className="floating-chat-panel" aria-label={t("floatingChatTitle")}>
            <div className="floating-chat-header">
              <div>
                <h2>{t("floatingChatTitle")}</h2>
                <p>{t("floatingChatHint")}</p>
              </div>
              <button
                type="button"
                className="floating-chat-close"
                onClick={() => setIsFloatingChatOpen(false)}
                aria-label={t("floatingChatClose")}
              >
                ×
              </button>
            </div>

            <div className="floating-chat-thread" ref={floatingChatThreadRef} aria-live="polite">
              {floatingChatMessages.map((message) => {
                const references = message.references;
                return (
                  <article key={message.id} className={`chat-message chat-message-${message.role}`}>
                    <small>
                      {message.role === "assistant" ? t("chatAssistantLabel") : t("chatUserLabel")}
                    </small>
                    <p>{message.content}</p>
                    {message.role === "assistant" && references && references.length > 0 ? (
                      <footer className="floating-chat-references">
                        <strong>{t("floatingChatReferences")}</strong>
                        <ul>
                          {references.map((reference) => (
                            <li key={`${message.id}-${reference.id}`}>
                              <button
                                type="button"
                                className="floating-chat-reference-link"
                                onClick={() => openGuideFromReference(reference.id)}
                              >
                                {reference.title} · {reference.institution} ({reference.region})
                              </button>
                            </li>
                          ))}
                        </ul>
                      </footer>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <form
              className="chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                void sendFloatingChatMessage();
              }}
            >
              <input
                value={floatingChatInput}
                onChange={(event) => setFloatingChatInput(event.target.value)}
                placeholder={t("floatingChatPlaceholder")}
                disabled={isFloatingChatLoading}
              />
              <button type="submit" disabled={isFloatingChatLoading}>
                {isFloatingChatLoading ? t("floatingChatThinking") : t("chatSend")}
              </button>
            </form>
          </section>
        ) : null}

        <button
          type="button"
          className="floating-chat-trigger"
          onClick={() => setIsFloatingChatOpen((current) => !current)}
        >
          {isFloatingChatOpen ? t("floatingChatClose") : t("floatingChatOpen")}
        </button>
      </div>
    </main>
  );
}
