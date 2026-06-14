import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  credits: number;
  isAdmin: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number; // timestamp in ms
}

export interface CreditRequest {
  id: string;
  userId: string;
  email: string;
  packageId: string;
  amount: number;
  status: "pending" | "completed";
  createdAt: string;
  paymentMethod?: string;
  txHash?: string;
}

interface DbSchema {
  users: User[];
  sessions: Session[];
  creditRequests: CreditRequest[];
}

const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "db.json");

// Simple in-memory serialization lock for write safety
let writeLock = Promise.resolve();

async function ensureDbInitialized(): Promise<void> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    try {
      await fs.access(DB_FILE);
    } catch {
      // Database file doesn't exist, create it with empty structure
      const initialData: DbSchema = { users: [], sessions: [], creditRequests: [] };
      await fs.writeFile(DB_FILE, JSON.stringify(initialData, null, 2), "utf-8");
    }
  } catch (err) {
    console.error("[db] Failed to initialize database folder/file:", err);
  }
}

export async function readDb(): Promise<DbSchema> {
  await ensureDbInitialized();
  try {
    const raw = await fs.readFile(DB_FILE, "utf-8");
    const data = JSON.parse(raw) as DbSchema;
    if (!data.creditRequests) {
      data.creditRequests = [];
    }
    return data;
  } catch (err) {
    console.error("[db] Error reading database, returning empty schema:", err);
    return { users: [], sessions: [], creditRequests: [] };
  }
}

export async function writeDb(data: DbSchema): Promise<void> {
  await ensureDbInitialized();
  return new Promise((resolve, reject) => {
    writeLock = writeLock
      .then(async () => {
        try {
          const tempFile = `${DB_FILE}.tmp`;
          await fs.writeFile(tempFile, JSON.stringify(data, null, 2), "utf-8");
          // fs.rename is atomic and works on most OS systems
          // On Windows, if target exists, rename might throw, so we handle it by removing first if necessary
          try {
            await fs.unlink(DB_FILE);
          } catch {
            // Ignore error if file didn't exist or couldn't delete (rename will try anyway)
          }
          await fs.rename(tempFile, DB_FILE);
          resolve();
        } catch (err) {
          console.error("[db] Write failed:", err);
          reject(err);
        }
      })
      .catch((err) => {
        reject(err);
      });
  });
}

// ── Password Security Helpers ──────────────────────────────────────────────

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}
