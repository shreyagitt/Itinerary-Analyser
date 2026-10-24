import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { createWorker, createScheduler } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { cpus } from "node:os";
import { analyse } from "./analyser.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// OCR is ~5s per page, so pages run in parallel on a pool of workers. The pool starts with the
// server so the first upload doesn't also pay the worker start-up cost.
const OCR_WORKERS = Math.max(1, Math.min(4, cpus().length - 1));
const ocr = createScheduler();
const ocrReady = Promise.all(Array.from({ length: OCR_WORKERS }, async () => ocr.addWorker(await createWorker("eng"))));

// Drop OCR noise from photos: keep lines with at least a few real letters.
const cleanOcr = (text) => text.split("\n").filter((l) => (l.match(/[A-Za-z]/g) ?? []).length >= 4).join("\n");

async function recognize(image) {
  await ocrReady;
  const { data } = await ocr.addJob("recognize", image);
  return cleanOcr(data.text);
}

// Phone photos are often 4000px+ wide; text reads just as well at 2000px and OCR is far faster.
const MAX_OCR_WIDTH = 2000;
async function shrinkImage(buffer) {
  const img = await loadImage(buffer);
  if (img.width <= MAX_OCR_WIDTH) return buffer;
  const scale = MAX_OCR_WIDTH / img.width;
  const canvas = createCanvas(MAX_OCR_WIDTH, Math.round(img.height * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

// Designed itineraries are often exported as flat images, so OCR each page (in parallel).
async function ocrPdf(pdf) {
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const png = await renderPageAsImage(pdf, i + 1, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });
      return `--- Page ${i + 1} ---\n${await recognize(Buffer.from(png))}`;
    }),
  );
  return pages.join("\n");
}

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  const type = file.mimetype;
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    if (text.trim().length > 200) return text;
    return ocrPdf(pdf);
  }
  if (type.startsWith("image/")) {
    return recognize(await shrinkImage(file.buffer));
  }
  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return file.buffer.toString("utf8");
  }
  throw Object.assign(new Error("Unsupported file type. Upload a PDF, DOCX, TXT or image."), { status: 415 });
}

app.use(express.static("public"));

app.post("/api/analyse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const started = Date.now();
    const text = await extractText(req.file);
    console.log(`Read ${req.file.originalname} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (text.trim().length < 100) return res.status(422).json({ error: "Couldn't read enough text from this document." });

    const result = analyse(text);
    if (!result.is_itinerary) return res.status(422).json({ error: "This doesn't look like a travel itinerary." });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message ?? "Something went wrong." });
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`Itinerary Analyser running on http://localhost:${port}`));
