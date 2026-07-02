import { createHash } from "node:crypto";

import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { getParentReadContext, type ParentReadStudent } from "./_parent-context.js";
import { eq, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const STUDENT_SELECT =
  "id,parent_id,first_name,last_name,date_of_birth,notes,created_at,updated_at";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type AddStudentRequest = {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  notes: string | null;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const context = await getParentReadContext(req);
    const request = readAddStudentRequest(req.body);
    const existing = findMatchingStudent(context.students, request);
    if (existing) return res.status(200).json(existing);

    const studentId = stableStudentId(context.profile.id, request);
    const existingById = await getStudentById(studentId);
    if (existingById) return res.status(200).json(existingById);

    const student = await insertStudent(studentId, context.profile.id, request);
    return res.status(201).json(student);
  } catch (error) {
    return sendError(res, error);
  }
}

function readAddStudentRequest(body: unknown): AddStudentRequest {
  const input = readJsonObject(body);

  return {
    date_of_birth: optionalDateOnly(input.date_of_birth, "date_of_birth"),
    first_name: requiredTrimmedString(input.first_name, "first_name", 255),
    last_name: requiredTrimmedString(input.last_name, "last_name", 255),
    notes: optionalTrimmedString(input.notes, "notes", 2_000),
  };
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new HttpError(400, "Expected JSON body.");
}

function requiredTrimmedString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing required body field: ${fieldName}.`);
  }

  const trimmed = collapseWhitespace(value);
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `Body field ${fieldName} is too long.`);
  }

  return trimmed;
}

function optionalTrimmedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  const trimmed = collapseWhitespace(value);
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `Body field ${fieldName} is too long.`);
  }

  return trimmed.length > 0 ? trimmed : null;
}

function optionalDateOnly(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  const trimmed = value.trim();
  const match = DATE_ONLY_PATTERN.exec(trimmed);
  if (!match) {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isRealDate =
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day);
  if (!isRealDate || parsed.getTime() > Date.now()) {
    throw new HttpError(400, `Invalid body field: ${fieldName}.`);
  }

  return trimmed;
}

function findMatchingStudent(
  students: ParentReadStudent[],
  request: AddStudentRequest,
): ParentReadStudent | null {
  return (
    students.find(
      (student) =>
        normalizeIdentityText(student.first_name) === normalizeIdentityText(request.first_name) &&
        normalizeIdentityText(student.last_name) === normalizeIdentityText(request.last_name) &&
        (student.date_of_birth ?? null) === request.date_of_birth,
    ) ?? null
  );
}

async function getStudentById(studentId: string): Promise<ParentReadStudent | null> {
  const rows = await sb<ParentReadStudent[]>(
    `students?id=eq.${eq(studentId)}` + `&select=${STUDENT_SELECT}` + "&limit=1",
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function insertStudent(
  studentId: string,
  parentId: string,
  request: AddStudentRequest,
): Promise<ParentReadStudent> {
  try {
    const rows = await sb<ParentReadStudent[]>(
      `students?select=${STUDENT_SELECT}`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          date_of_birth: request.date_of_birth,
          first_name: request.first_name,
          id: studentId,
          last_name: request.last_name,
          notes: request.notes,
          parent_id: parentId,
        }),
      },
    );
    const student = Array.isArray(rows) ? rows[0] : null;
    if (!student) throw new HttpError(502, "Student creation failed.");
    return student;
  } catch (error) {
    if (!isSupabaseConflict(error)) throw error;

    const existing = await getStudentById(studentId);
    if (existing) return existing;
    throw error;
  }
}

function isSupabaseConflict(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  if (!error.detail || typeof error.detail !== "object") return false;
  const detail = error.detail as { body?: unknown; status?: unknown };
  return detail.status === 409 || String(detail.body ?? "").includes("duplicate key");
}

function stableStudentId(parentId: string, request: AddStudentRequest): string {
  return uuidFromHash(
    [
      "parent-student",
      parentId,
      normalizeIdentityText(request.first_name),
      normalizeIdentityText(request.last_name),
      request.date_of_birth ?? "",
    ].join("\0"),
  );
}

function uuidFromHash(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function normalizeIdentityText(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export default withSentryApiRoute(handler);
