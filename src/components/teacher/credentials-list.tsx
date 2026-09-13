"use client";

import { CircleCheck, Copy, Download } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { DataTable, Notice, Td, Th, Tr } from "@/components/ui/primitives";
import type { ProvisionedStudent } from "@/lib/types";

function toCsv(students: ProvisionedStudent[]): string {
  const header = "Name,Handle,Password,Student ID";
  const escape = (value: string | null) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = students.map((student) =>
    [
      escape(student.fullName),
      escape(student.handle),
      escape(student.temporaryPassword),
      escape(student.externalId),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

/**
 * Passwords are shown exactly once, at the moment they are minted, because only
 * a hash is stored. This panel is the only place a teacher can read them, so it
 * offers copy and CSV export rather than making them transcribe by hand.
 */
export function CredentialsList({
  students,
  title = "Student credentials",
  warning,
}: {
  students: ProvisionedStudent[];
  title?: string;
  warning?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  if (students.length === 0) return null;

  const copyAll = async () => {
    const text = students
      .map(
        (student) =>
          `${student.fullName} — handle: ${student.handle} — password: ${student.temporaryPassword}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(students)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paperdesk-student-credentials.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <Notice tone="warn">
        {warning ??
          "These passwords are shown once and are not stored in readable form. Copy or download them before leaving this page."}
      </Notice>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={copyAll}>
            {copied ? <CircleCheck /> : <Copy />}
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={downloadCsv}>
            <Download />
            CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-hairline">
        <DataTable>
          <thead>
            <tr>
              <Th className="pl-4">Student</Th>
              <Th>Handle</Th>
              <Th>Password</Th>
              <Th className="pr-4">Student ID</Th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <Tr key={`${student.studentId}-${student.handle}`}>
                <Td className="pl-4 text-ink">{student.fullName}</Td>
                <Td className="font-mono text-[12px] text-ink-muted">
                  {student.handle}
                </Td>
                <Td className="font-mono text-[12px] text-ink">
                  {student.temporaryPassword}
                </Td>
                <Td className="pr-4 text-ink-subtle">
                  {student.externalId || "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}
