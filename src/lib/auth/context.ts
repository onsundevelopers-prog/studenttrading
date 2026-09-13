import { cache } from "react";

import { loadClassroomSettings, loadPortfolio } from "@/lib/data/queries";
import type { ClassSettings, Portfolio } from "@/lib/types";

import {
  listClassroomsFor,
  resolveActiveClassroom,
  requireStudent,
  requireTeacher,
  type ClassroomSummary,
  type SessionContext,
} from "./session";

/**
 * Per-request memoised workspace resolution.
 *
 * A layout and the page inside it both need the session, the classroom list and
 * the active classroom. `cache()` collapses those into one lookup each per
 * request rather than repeating the queries at every level.
 */

export type TeacherWorkspace = {
  session: SessionContext;
  classrooms: ClassroomSummary[];
  classroom: ClassroomSummary | null;
  settings: ClassSettings | null;
};

export const getTeacherWorkspace = cache(async (): Promise<TeacherWorkspace> => {
  const session = await requireTeacher();
  const classrooms = await listClassroomsFor(session);
  const classroom = await resolveActiveClassroom(session, classrooms);
  const settings = classroom ? await loadClassroomSettings(classroom.id) : null;

  return { session, classrooms, classroom, settings };
});

export type StudentWorkspace = {
  session: SessionContext;
  classrooms: ClassroomSummary[];
  classroom: ClassroomSummary | null;
  settings: ClassSettings | null;
  portfolio: Portfolio | null;
};

export const getStudentWorkspace = cache(async (): Promise<StudentWorkspace> => {
  const session = await requireStudent();
  const classrooms = await listClassroomsFor(session);
  const classroom = await resolveActiveClassroom(session, classrooms);

  if (!classroom) {
    return { session, classrooms, classroom: null, settings: null, portfolio: null };
  }

  const [settings, portfolio] = await Promise.all([
    loadClassroomSettings(classroom.id),
    loadPortfolio(classroom.id, session.userId).catch((error) => {
      console.error("Portfolio load failed in workspace context:", error);
      throw error;
    }),
  ]);

  return { session, classrooms, classroom, settings, portfolio };
});
