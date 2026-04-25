import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mockGuides } from "./data.mock";

import type { ProcessGuide } from "./types";

const PROGRESS_STORAGE_KEY = "process-path-progress";
const USER_GUIDES_STORAGE_KEY = "process-path-user-guides";

type ProgressByGuide = Record<string, Record<string, boolean>>;
type UploadStatus = { type: "success" | "error"; message: string } | null;

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

export function App() {
  const { t, i18n } = useTranslation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [institution, setInstitution] = useState("all");
  const [region, setRegion] = useState("all");
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressByGuide>(() => getInitialProgress());
  const [userGuides, setUserGuides] = useState<ProcessGuide[]>(() => getInitialUserGuides());
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(null);

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

  const categories = useMemo(() => uniqueBy(allGuides.map((guide) => guide.category)), [allGuides]);
  const institutions = useMemo(
    () => uniqueBy(allGuides.map((guide) => guide.institution)),
    [allGuides],
  );
  const regions = useMemo(() => uniqueBy(allGuides.map((guide) => guide.region)), [allGuides]);

  const filteredGuides = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return allGuides.filter((guide) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        guide.title.toLowerCase().includes(normalizedQuery) ||
        guide.summary.toLowerCase().includes(normalizedQuery) ||
        guide.category.toLowerCase().includes(normalizedQuery);

      const matchesCategory = category === "all" || guide.category === category;
      const matchesInstitution = institution === "all" || guide.institution === institution;
      const matchesRegion = region === "all" || guide.region === region;

      return matchesQuery && matchesCategory && matchesInstitution && matchesRegion;
    });
  }, [allGuides, category, institution, query, region]);

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

  const selectedProgress = selectedGuide ? (progress[selectedGuide.id] ?? {}) : {};

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
            </div>
          </div>

          <div className="guide-grid" role="list">
            {filteredGuides.map((guide) => {
              const guideProgress = progress[guide.id] ?? {};
              const guideCompletedSteps = guide.steps.filter(
                (step) => guideProgress[step.id],
              ).length;
              const guidePercent = Math.round((guideCompletedSteps / guide.steps.length) * 100);

              return (
                <button
                  key={guide.id}
                  type="button"
                  role="listitem"
                  className="guide-card"
                  onClick={() => setSelectedGuideId(guide.id)}
                >
                  <div className="guide-card-main">
                    <strong>{guide.title}</strong>
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
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setSelectedGuideId(null)}
                >
                  ×
                </button>
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
    </main>
  );
}
