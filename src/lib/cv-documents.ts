export type CareerDocumentInput = {
  text: string;
  filename: string;
  format: "txt" | "md" | "pdf" | "docx";
};

export type CvExportValidation = {
  format: "pdf" | "docx";
  checks: string[];
  pages: number | null;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;

function validatedText(value: string): string {
  const text = value.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  if (text.length < 20)
    throw new Error("We could not extract enough CV text. Add at least 20 characters.");
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error("The extracted CV is over 100,000 characters. Shorten it and try again.");
  return text;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerPath = "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
  pdfjs.GlobalWorkerOptions.workerSrc =
    import.meta.env.MODE === "test"
      ? new URL(workerPath, `file://${process.cwd()}/src/lib/`).href
      : new URL(workerPath, import.meta.url).href;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  if (pageCount > 30) {
    await loadingTask.destroy();
    throw new Error("PDFs are limited to 30 pages in this local demo.");
  }
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    page.cleanup();
  }
  await loadingTask.destroy();
  return { text: pages.join("\n\n"), pages: pageCount };
}

async function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("The document could not be read. Try again."));
    reader.readAsArrayBuffer(blob);
  });
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const input =
    import.meta.env.MODE === "test" ? { buffer: Buffer.from(buffer) } : { arrayBuffer: buffer };
  return (await mammoth.extractRawText(input)).value;
}

export async function extractCareerDocument(file: File): Promise<CareerDocumentInput> {
  if (!file.size) throw new Error("Choose a non-empty CV file.");
  if (file.size > MAX_FILE_BYTES)
    throw new Error("CV files are limited to 5 MB in this local demo.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["txt", "md", "pdf", "docx"].includes(extension)) {
    throw new Error("Choose a PDF, DOCX, TXT or MD file. Legacy DOC files are not supported.");
  }
  const format = extension as CareerDocumentInput["format"];
  const buffer = await blobArrayBuffer(file);
  let text: string;
  if (format === "pdf") {
    text = (await extractPdfText(buffer)).text;
  } else if (format === "docx") {
    text = await extractDocxText(buffer);
  } else {
    text = new TextDecoder().decode(buffer);
  }
  return { text: validatedText(text), filename: file.name, format };
}

function pdfSafe(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\n]/g, "");
}

async function createPdf(content: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const margin = 48;
  const bottom = 54;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const lines = pdfSafe(content).split("\n");
  for (const sourceLine of lines) {
    const heading = /^[A-Z][A-Z /&-]{3,}$/.test(sourceLine.trim());
    const font = heading ? bold : regular;
    const size = heading ? 11 : 9.5;
    const lineHeight = heading ? 18 : 13;
    const maxWidth = width - margin * 2;
    const words = sourceLine.split(/\s+/).filter(Boolean);
    const wrapped: string[] = words.length ? [] : [""];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) wrapped.push(line);
        line = word;
      }
    }
    if (line) wrapped.push(line);
    for (const wrappedLine of wrapped) {
      if (y < bottom) {
        page = pdf.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(wrappedLine, { x: margin, y, size, font });
      y -= lineHeight;
    }
    if (!sourceLine) y -= 4;
  }
  const pages = pdf.getPages();
  pages.forEach((entry, index) => {
    entry.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: width - margin - regular.widthOfTextAtSize(`Page ${index + 1} of ${pages.length}`, 8),
      y: 26,
      size: 8,
      font: regular,
    });
  });
  return pdf.save();
}

async function createDocx(content: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await import("docx");
  const lines = content.split("\n");
  const children = lines.map((line, index) => {
    const heading = /^[A-Z][A-Z /&-]{3,}$/.test(line.trim());
    if (heading) {
      return new Paragraph({
        text: line,
        heading: index === 0 ? HeadingLevel.TITLE : HeadingLevel.HEADING_2,
        spacing: { before: index === 0 ? 0 : 180, after: 100 },
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: line, size: 20 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: line ? 60 : 100 },
    });
  });
  const document = new Document({
    creator: "Hired Not Tired local demo",
    title: "Tailored CV",
    description: "Candidate-approved tailored CV generated from confirmed source facts.",
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 850, right: 850, bottom: 850, left: 850 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}

function comparableWords(value: string): string {
  return pdfSafe(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateReadingOrder(original: string, extracted: string): void {
  const extractedWithoutPageNumbers = extracted.replace(/Page \d+ of \d+/g, "");
  if (comparableWords(original) !== comparableWords(extractedWithoutPageNumbers)) {
    throw new Error(
      "Export validation failed: extracted text does not match the approved CV reading order. Nothing was downloaded.",
    );
  }
  const headings = original.split("\n").filter((line) => /^[A-Z][A-Z /&-]{3,}$/.test(line.trim()));
  let previous = -1;
  for (const heading of headings) {
    const position = extracted.indexOf(heading);
    if (position < 0 || position < previous) {
      throw new Error(
        "Export validation failed: a CV heading is missing or out of order. Nothing was downloaded.",
      );
    }
    previous = position;
  }
}

export async function createValidatedCvExport(
  content: string,
  format: "pdf" | "docx",
): Promise<{ blob: Blob; validation: CvExportValidation }> {
  let blob: Blob;
  let extracted: string;
  let validation: CvExportValidation;
  if (format === "pdf") {
    const bytes = await createPdf(content);
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await extractPdfText(copy);
    extracted = result.text;
    validateReadingOrder(content, extracted);
    blob = new Blob([copy], { type: "application/pdf" });
    validation = {
      format,
      pages: result.pages,
      checks: [
        "Extracted text matches the approved CV",
        "Headings and reading order validated",
        `${result.pages} A4 page${result.pages === 1 ? "" : "s"} generated with fixed margins and page breaks`,
      ],
    };
  } else {
    blob = await createDocx(content);
    extracted = await extractDocxText(await blobArrayBuffer(blob));
    validateReadingOrder(content, extracted);
    validation = {
      format,
      pages: null,
      checks: [
        "Extracted text matches the approved CV",
        "Headings, paragraphs and reading order validated",
        "A4 section and margins validated; review final pagination in your document editor",
      ],
    };
  }
  return { blob, validation };
}

export async function downloadValidatedCv(
  content: string,
  format: "pdf" | "docx",
  filenameBase: string,
): Promise<CvExportValidation> {
  const { blob, validation } = await createValidatedCvExport(content, format);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName =
    filenameBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tailored-cv";
  anchor.href = url;
  anchor.download = `${safeName}-tailored-cv.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return validation;
}