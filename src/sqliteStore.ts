import initSqlJs, { type Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import { mockGuides } from "./data.mock";
import type { ProcessGuide } from "./types";

const DB_STORAGE_KEY = "amakari-sqlite-db-v1";
const LEGACY_MIGRATION_FLAG = "legacy-localstorage-migrated-v1";
const SEED_ADMIN_MOCK_FLAG = "seed-admin-mock-v1";
const LEGACY_PROGRESS_KEY = "process-path-progress";
const LEGACY_USER_GUIDES_KEY = "process-path-user-guides";
const LEGACY_FAVORITES_KEY = "process-path-favorite-guides";

type ProgressByGuide = Record<string, Record<string, boolean>>;

export type AuthUser = {
  username: string;
};

export type GuideFeedback = {
  id: string;
  guideId: string;
  username: string;
  message: string;
  createdAt: string;
};

type PersistedState = {
  progress: ProgressByGuide;
  userGuides: ProcessGuide[];
  favorites: string[];
  currentUser: AuthUser | null;
  feedback: GuideFeedback[];
};

let dbPromise: Promise<Database> | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function createSchema(db: Database): void {
  db.run(`
    create table if not exists app_meta (
      key text primary key,
      value text not null
    );

    create table if not exists guide_progress (
      guide_id text not null,
      step_id text not null,
      completed integer not null check (completed in (0, 1)),
      primary key (guide_id, step_id)
    );

    create table if not exists user_favorites (
      guide_id text primary key
    );

    create table if not exists user_guides (
      guide_id text primary key,
      payload_json text not null
    );

    create table if not exists app_users (
      username text primary key,
      password text not null
    );

    create table if not exists guide_feedback (
      id text primary key,
      guide_id text not null,
      username text not null,
      message text not null,
      created_at text not null
    );
  `);
}

function parseLegacyJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function migrateLegacyLocalStorage(db: Database): void {
  const hasMigrated = db.exec(
    `select value from app_meta where key = '${LEGACY_MIGRATION_FLAG}' limit 1`,
  );

  if (hasMigrated.length > 0) {
    return;
  }

  const legacyProgress = parseLegacyJson<ProgressByGuide>(LEGACY_PROGRESS_KEY, {});
  const legacyGuides = parseLegacyJson<ProcessGuide[]>(LEGACY_USER_GUIDES_KEY, []);
  const legacyFavorites = parseLegacyJson<string[]>(LEGACY_FAVORITES_KEY, []);

  const insertProgress = db.prepare(
    "insert or replace into guide_progress (guide_id, step_id, completed) values (?, ?, 1)",
  );
  for (const [guideId, steps] of Object.entries(legacyProgress)) {
    for (const [stepId, completed] of Object.entries(steps)) {
      if (completed) {
        insertProgress.run([guideId, stepId]);
      }
    }
  }
  insertProgress.free();

  const insertGuide = db.prepare(
    "insert or replace into user_guides (guide_id, payload_json) values (?, ?)",
  );
  for (const guide of legacyGuides) {
    insertGuide.run([guide.id, JSON.stringify(guide)]);
  }
  insertGuide.free();

  const insertFavorite = db.prepare("insert or replace into user_favorites (guide_id) values (?)");
  for (const guideId of legacyFavorites) {
    insertFavorite.run([guideId]);
  }
  insertFavorite.free();

  db.run("insert or replace into app_meta (key, value) values (?, ?)", [
    LEGACY_MIGRATION_FLAG,
    "true",
  ]);
}

function seedAdminAndMockGuides(db: Database): void {
  const hasSeeded = db.exec(
    `select value from app_meta where key = '${SEED_ADMIN_MOCK_FLAG}' limit 1`,
  );
  if (hasSeeded.length > 0) {
    return;
  }

  const userExistsStmt = db.prepare("select username from app_users limit 1");
  const hasAnyUser = userExistsStmt.step();
  userExistsStmt.free();
  if (!hasAnyUser) {
    db.run("insert or replace into app_users (username, password) values (?, ?)", [
      "admin",
      "admin",
    ]);
  }

  const currentUserStmt = db.prepare(
    "select value from app_meta where key = 'current-user' limit 1",
  );
  const hasCurrentUser = currentUserStmt.step();
  currentUserStmt.free();
  if (!hasCurrentUser) {
    db.run("insert or replace into app_meta (key, value) values ('current-user', ?)", ["admin"]);
  }

  const guideExistsStmt = db.prepare("select guide_id from user_guides limit 1");
  const hasAnyGuides = guideExistsStmt.step();
  guideExistsStmt.free();
  if (!hasAnyGuides) {
    const insertGuide = db.prepare(
      "insert or replace into user_guides (guide_id, payload_json) values (?, ?)",
    );
    for (const guide of mockGuides) {
      const seededGuide: ProcessGuide = {
        ...guide,
        createdBy: guide.createdBy ?? "admin",
      };
      insertGuide.run([seededGuide.id, JSON.stringify(seededGuide)]);
    }
    insertGuide.free();
  }

  db.run("insert or replace into app_meta (key, value) values (?, ?)", [
    SEED_ADMIN_MOCK_FLAG,
    "true",
  ]);
}

function persistDb(db: Database): void {
  const bytes = db.export();
  localStorage.setItem(DB_STORAGE_KEY, toBase64(bytes));
}

async function getDb(): Promise<Database> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: () => sqlWasmUrl,
    });

    const encodedDb = localStorage.getItem(DB_STORAGE_KEY);
    const db = encodedDb ? new SQL.Database(fromBase64(encodedDb)) : new SQL.Database();

    createSchema(db);
    migrateLegacyLocalStorage(db);
    seedAdminAndMockGuides(db);
    persistDb(db);

    return db;
  })();

  return dbPromise;
}

export async function loadPersistedState(): Promise<PersistedState> {
  const db = await getDb();

  const progress: ProgressByGuide = {};
  const progressResult = db.exec(
    "select guide_id, step_id from guide_progress where completed = 1 order by guide_id, step_id",
  );
  if (progressResult.length > 0) {
    const [result] = progressResult;
    for (const row of result.values) {
      const guideId = String(row[0]);
      const stepId = String(row[1]);
      progress[guideId] = progress[guideId] ?? {};
      progress[guideId][stepId] = true;
    }
  }

  const favorites: string[] = [];
  const favoritesResult = db.exec("select guide_id from user_favorites order by guide_id");
  if (favoritesResult.length > 0) {
    const [result] = favoritesResult;
    for (const row of result.values) {
      favorites.push(String(row[0]));
    }
  }

  const userGuides: ProcessGuide[] = [];
  const guidesResult = db.exec("select payload_json from user_guides order by guide_id");
  if (guidesResult.length > 0) {
    const [result] = guidesResult;
    for (const row of result.values) {
      try {
        userGuides.push(JSON.parse(String(row[0])) as ProcessGuide);
      } catch {
        // Skip malformed rows to keep app usable.
      }
    }
  }

  let currentUser: AuthUser | null = null;
  const currentUserResult = db.exec(
    "select value from app_meta where key = 'current-user' limit 1",
  );
  if (currentUserResult.length > 0) {
    const [result] = currentUserResult;
    if (result.values.length > 0) {
      const username = String(result.values[0][0]);
      if (username) {
        currentUser = { username };
      }
    }
  }

  const feedback: GuideFeedback[] = [];
  const feedbackResult = db.exec(
    "select id, guide_id, username, message, created_at from guide_feedback order by created_at asc",
  );
  if (feedbackResult.length > 0) {
    const [result] = feedbackResult;
    for (const row of result.values) {
      feedback.push({
        id: String(row[0]),
        guideId: String(row[1]),
        username: String(row[2]),
        message: String(row[3]),
        createdAt: String(row[4]),
      });
    }
  }

  return { progress, favorites, userGuides, currentUser, feedback };
}

export async function saveProgress(progress: ProgressByGuide): Promise<void> {
  const db = await getDb();

  db.run("delete from guide_progress");
  const insert = db.prepare(
    "insert or replace into guide_progress (guide_id, step_id, completed) values (?, ?, 1)",
  );

  for (const [guideId, steps] of Object.entries(progress)) {
    for (const [stepId, completed] of Object.entries(steps)) {
      if (completed) {
        insert.run([guideId, stepId]);
      }
    }
  }

  insert.free();
  persistDb(db);
}

export async function saveFavoriteGuideIds(guideIds: string[]): Promise<void> {
  const db = await getDb();

  db.run("delete from user_favorites");
  const insert = db.prepare("insert or replace into user_favorites (guide_id) values (?)");
  for (const guideId of guideIds) {
    insert.run([guideId]);
  }
  insert.free();

  persistDb(db);
}

export async function saveUserGuides(guides: ProcessGuide[]): Promise<void> {
  const db = await getDb();

  db.run("delete from user_guides");
  const insert = db.prepare(
    "insert or replace into user_guides (guide_id, payload_json) values (?, ?)",
  );
  for (const guide of guides) {
    insert.run([guide.id, JSON.stringify(guide)]);
  }
  insert.free();

  persistDb(db);
}

export async function createAccount(username: string, password: string): Promise<AuthUser> {
  const db = await getDb();
  const normalizedUsername = username.trim();

  if (!normalizedUsername || !password.trim()) {
    throw new Error("invalid-credentials");
  }

  const existingStmt = db.prepare("select username from app_users where username = ? limit 1");
  existingStmt.bind([normalizedUsername]);
  const hasExistingUser = existingStmt.step();
  existingStmt.free();
  if (hasExistingUser) {
    throw new Error("username-exists");
  }

  db.run("insert into app_users (username, password) values (?, ?)", [
    normalizedUsername,
    password,
  ]);
  db.run("insert or replace into app_meta (key, value) values ('current-user', ?)", [
    normalizedUsername,
  ]);
  persistDb(db);

  return { username: normalizedUsername };
}

export async function signIn(username: string, password: string): Promise<AuthUser> {
  const db = await getDb();
  const normalizedUsername = username.trim();
  const stmt = db.prepare(
    "select username from app_users where username = ? and password = ? limit 1",
  );
  stmt.bind([normalizedUsername, password]);
  const isValid = stmt.step();
  stmt.free();

  if (!isValid) {
    throw new Error("invalid-credentials");
  }

  db.run("insert or replace into app_meta (key, value) values ('current-user', ?)", [
    normalizedUsername,
  ]);
  persistDb(db);

  return { username: normalizedUsername };
}

export async function signOut(): Promise<void> {
  const db = await getDb();
  db.run("delete from app_meta where key = 'current-user'");
  persistDb(db);
}

export async function saveGuideFeedback(entries: GuideFeedback[]): Promise<void> {
  const db = await getDb();

  db.run("delete from guide_feedback");
  const insert = db.prepare(
    "insert or replace into guide_feedback (id, guide_id, username, message, created_at) values (?, ?, ?, ?, ?)",
  );
  for (const entry of entries) {
    insert.run([entry.id, entry.guideId, entry.username, entry.message, entry.createdAt]);
  }
  insert.free();

  persistDb(db);
}
