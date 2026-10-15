export class DatastoreError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export const MARKER_NAME: string;
export function readInTurn(dbPath: string, opts: { allowNew: boolean }): { text: string | null; epoch: number };
export function writeInTurn(dbPath: string, text: string, epoch: number): void;
export function parseDatastoreText(text: string, dbPath: string): Record<string, unknown>;
export function readForScript(dbPath: string): { db: Record<string, unknown>; token: { identity: string; bytes: number } };
export function writeForScript(dbPath: string, db: unknown, token?: { identity: string; bytes: number }): void;
export function writeTextForScript(dbPath: string, text: string): void;
export function _acquireLock(dbPath: string): { ownerId: string; pid: number; host: string; procStart: string | null; takenAt: number };
export function _releaseLock(dbPath: string, owner: { ownerId: string }): void;
export function _identityOf(dbPath: string): string;
export function _atomicReplace(dbPath: string, text: string): void;
export function withFileLock<T>(filePath: string, fn: () => T): T;
export function replaceFileAtomically(filePath: string, text: string): void;
