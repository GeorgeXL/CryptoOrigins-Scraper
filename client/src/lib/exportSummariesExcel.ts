import * as XLSX from "xlsx";

export type SummaryExportRow = {
  date: string;
  summary: string;
  tags: string;
  topic: string;
};

export function sanitizeExportFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "summaries";
}

export function downloadSummariesExcel(rows: SummaryExportRow[], filenameBase: string): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["date", "summary", "tags", "topic"],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Summaries");
  XLSX.writeFile(workbook, `${sanitizeExportFilename(filenameBase)}.xlsx`);
}
