import { describe, expect, it } from "vitest";
import { createValidatedCvExport, extractCareerDocument } from "@/lib/cv-documents";

const CV = `ROBIN EXAMPLE
Target role: Platform Engineer — Example Engineering
robin@example.com

PROFESSIONAL SUMMARY
Platform engineer focused on reliable Python services.

ROLE-RELEVANT CONFIRMED SKILLS
Python • PostgreSQL

CANDIDATE-CONFIRMED CAREER HISTORY
Senior Engineer — Example Studio
Built Python services with PostgreSQL.`;

describe("local CV document import and validated export", () => {
  it("imports plain-text CV content for the existing CV-text backend contract", async () => {
    const file = new File([CV], "robin-master.txt", { type: "text/plain" });
    const parsed = await extractCareerDocument(file);
    expect(parsed).toMatchObject({ filename: "robin-master.txt", format: "txt" });
    expect(parsed.text).toContain("Built Python services with PostgreSQL.");
  });

  it("creates a PDF whose extracted text, headings and reading order match the approved CV", async () => {
    const result = await createValidatedCvExport(CV, "pdf");
    expect(result.blob.type).toBe("application/pdf");
    expect(result.blob.size).toBeGreaterThan(1000);
    expect(result.validation.pages).toBeGreaterThanOrEqual(1);
    expect(result.validation.checks).toContain("Extracted text matches the approved CV");

    const file = new File([result.blob], "robin-tailored.pdf", { type: result.blob.type });
    const imported = await extractCareerDocument(file);
    expect(imported.format).toBe("pdf");
    expect(imported.text).toContain("ROLE-RELEVANT CONFIRMED SKILLS");
    expect(imported.text).toContain("Built Python services with PostgreSQL.");
  }, 30_000);

  it("creates an editable DOCX and validates its extracted structure", async () => {
    const result = await createValidatedCvExport(CV, "docx");
    expect(result.blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.blob.size).toBeGreaterThan(1000);
    expect(result.validation.checks).toContain("Headings, paragraphs and reading order validated");

    const file = new File([result.blob], "robin-tailored.docx", { type: result.blob.type });
    const imported = await extractCareerDocument(file);
    expect(imported.text).toContain("ROLE-RELEVANT CONFIRMED SKILLS");
    expect(imported.text).toContain("Built Python services with PostgreSQL.");
  }, 30_000);

  it("rejects unsupported files instead of pretending they were parsed", async () => {
    const file = new File(["not a legacy document"], "robin-master.doc");
    await expect(extractCareerDocument(file)).rejects.toThrow("Legacy DOC files are not supported");
  });
});