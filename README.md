# Itinerary Analyser

Upload a travel itinerary or package quote (PDF, Word, text, or a screenshot/photo) and get an honest **score out of 100**, a list of **red flags**, a **day-by-day load** breakdown and **what to ask the operator before you pay**.

It runs fully offline: there is no AI model and no external API. Scoring is done by a rule-based engine, and text is read from scanned pages with local OCR.

---

## Quick start

Requirements: **Node.js 20+** and npm.

```bash
git clone https://github.com/shreyagitt/Itinerary-Analyser.git
cd Itinerary-Analyser
npm install
npm start
```

Open **http://localhost:3000** and drop in an itinerary.

### Run on a different port

```bash
# macOS / Linux / Git Bash
PORT=3001 npm start
```

```powershell
# Windows PowerShell
$env:PORT = "3001"; npm start
```

If you see `EADDRINUSE`, another copy is already running on that port. Stop it, or use a different `PORT`.

### Use the API directly

```bash
curl -F "file=@my-itinerary.pdf" http://localhost:3000/api/analyse
```

Returns JSON (see [Response format](#response-format)). Errors come back as `{ "error": "..." }` with status `400` (no file), `415` (unsupported type) or `422` (unreadable / not an itinerary).

---

## How it works

```
upload ──► extract text ──► analyse(text) ──► JSON ──► results page
           (server.js)       (analyser.js)              (public/index.html)
```

### 1. Text extraction ([server.js](server.js))

| File type | How it's read |
|---|---|
| PDF with a text layer | Text extracted directly with `unpdf` (fast, ~1s) |
| PDF made of images (designed brochures) | Each page is rendered at 2× and OCR'd with `tesseract.js`. Pages run **in parallel** on a pool of up to 4 OCR workers |
| Images / screenshots | Large photos are shrunk to 2000px wide, then OCR'd |
| `.docx` | `mammoth` |
| `.txt` / `.md` | Read as UTF-8 |

The OCR pool starts when the server starts, so the first upload doesn't wait for it. OCR uses the bundled `eng.traineddata` English model. Each upload's read time is logged to the terminal, e.g. `Read brochure.pdf in 26.1s`.

### 2. Rule-based analysis ([analyser.js](analyser.js))

The engine is built around **generic rules**, so it works for any destination and layout. Lookup tables only make the result more precise when a place is recognised.

**Parsing**
- **Trip facts:** duration (`7D/6N`, `5 Nights 6 Days`, `6N7D`, "an 8-day trip"), start date (`26 Dec 2026`, `January 15, 2027`, `2026-04-02`, `18-11-2026`, `July 2026`, preferring a labelled "Travel date"), number of travellers, operator website.
- **Price:** ₹/Rs/INR, $, €, £, AED, S$, A$, ฿, RM. Handles "per person", "per couple" and totals ("AED 5,800 for 2 adults"). It picks the largest per-person figure so add-on prices (e.g. a ₹500 camel ride) aren't mistaken for the package price.
- **Days**, in order of preference:
  1. `Day 1: …`, `DAY 01 | …`, `Day One - …`, `Day 1` with the title on the next line, table rows `| Day 1 | … |`. The text under each heading becomes that day's body.
  2. Numbered lists: `01 Delhi to Shimla`, `1. Arrive Hanoi`, `2) …`.
  3. Per-page headings (`: Delhi to Shimla | …`) in OCR'd brochures.
  4. Prose: "On arrival… The next day… On the third day… On the final day…".

**Per-day analysis**
- **Route** from the title: `A to B`, `A → B → C`, `A - B` (both sides known places), `Arrive in B`, `Fly to B`. Unknown places (e.g. *Reykjavik*, *Takayama*) are still picked up from capitalised names.
- **Mode:** road, flight, train, boat or overnight journey. Trips with a rail pass (JR / Eurail / Swiss Travel Pass) default to train.
- **Travel time:** taken in this order:
  1. Hours stated in the document ("(4 hrs)", "approx 6 hrs drive").
  2. The built-in leg table, summed across multi-stop days.
  3. An estimate from a stated distance (30 km/h in mountains, 50 km/h elsewhere, 60 km/h by train).
  4. Otherwise "not stated".
- **Load:** heavy (7+ hrs or overnight), moderate (4+ hrs, flights, busy sightseeing), or light.

**Seasonality.** Each known place belongs to a climate region with snow, rain and heat months, e.g. Western Himalaya snow Nov–Mar, Bali wet season Dec–Mar, Gulf heat Jun–Sep, Thailand's Andaman coast rain May–Oct. Warnings are worded by place type: landslides for hill roads, rough seas for beaches, flooding for cities. Places that usually close in winter (Kunzum, Chandratal, Kedarnath…) raise a high-severity flag.

**Other checks**
- High altitude: no acclimatisation, flying into Leh and moving on the next day.
- Overnight journeys and runs of 8-hour drives.
- Backtracking (returning to the start city counts as a loop).
- "Or similar" hotels and missing star ratings.
- Inclusions/exclusions lists: excluded heaters in winter, 4x4/snow-chain surcharges, resort fees, city tax, tips.
- Visa and flights for international trips.
- Cancellation terms: deductions on booking, late no-refund windows, terms that make you pay for weather delays.
- Consistency: days vs nights, meal counts, a large vehicle promised but a small car in the fine print.

### Scoring rubric (100 points)

| Category | Max |
|---|---|
| Route & Logistics | 20 |
| Pacing & Comfort | 15 |
| Seasonality & Safety | 15 |
| Accommodation | 10 |
| Experiences & Sightseeing | 10 |
| Inclusions & Exclusions Clarity | 10 |
| Value for Money | 10 |
| Policies & Hidden Costs | 5 |
| Document Accuracy & Consistency | 5 |

Bands: **80+** Strong itinerary · **70+** Good plan with a few gaps · **60+** Workable, but read the fine print · **below 60** Risky plan - needs changes.

Value for money compares the price per person per night (converted to ₹ at rough rates) against bands. Domestic: under ₹1,500 is suspiciously low, ₹1,500–4,000 competitive, up to ₹8,000 mid-range. International: ₹3,000 / ₹9,000 / ₹18,000.

---

## Extending the rules

Everything is data at the top of [analyser.js](analyser.js).

**Add places** (one line per group). `type` is one of `high`, `hill`, `beach`, `desert`, `city`:

```js
add("europe", "hill", "hallstatt, bled");
add("western himalaya", "high", "spiti valley", { winterClosed: true });
```

**Add a climate region.** Months are 0 = Jan, and ranges may wrap the year end:

```js
"iceland": { snow: [10, 3], intl: true },
```

**Add a drive time** (km, hours) for a leg the documents rarely state:

```js
"reykjavik|vik": [185, 3],
```

**Add an alternate spelling** that should be reported under one name:

```js
const ALIASES = { cochin: "kochi", ... };
```

Destinations not in the tables still get routes, day loads, prices and policy checks. They just get no seasonal warning; the report says to check the local season instead.

---

## Response format

```jsonc
{
  "is_itinerary": true,
  "engine": "Rule-based engine (offline)",
  "score": 69,
  "verdict": "Workable, but read the fine print: watch out for room heaters cost extra in sub-zero weather.",
  "summary": "This 7-day itinerary covers Kaza, Shimla, Sangla, Kalpa starting 26 Dec 2026. ...",
  "trip": { "title": "...", "destination": "...", "duration": "7 days / 6 nights", "travel_dates": "26 Dec 2026",
            "travellers": "4", "price": "₹24,999 per person", "operator": "..." },
  "categories": [{ "key": "route", "name": "Route & Logistics", "max": 20, "score": 17, "reasoning": "..." }],
  "red_flags": [{ "severity": "high", "title": "...", "detail": "..." }],
  "strengths": ["..."],
  "recommendations": ["..."],
  "days": [{ "day": 1, "title": "Delhi to Shimla | Overnight Journey", "load": "heavy", "note": "..." }]
}
```

---

## Project structure

```
├── server.js          Express server: upload, text extraction, parallel OCR, /api/analyse
├── analyser.js        Rule-based scoring engine (pure function: text in, JSON out)
├── public/index.html  Single-page UI (upload + results)
├── eng.traineddata    Tesseract English model used for OCR
└── package.json
```

## Performance

| Input | Typical time |
|---|---|
| Text PDF / DOCX / TXT | ~1 s |
| Phone photo | ~8 s |
| 8-page image-only brochure | ~26 s (about 3 s per page with 4 OCR workers) |

The scoring step itself takes about 0.1 s. Nearly all of the time is OCR, so a text PDF or Word file is much faster than a scan or a photo.

## Limitations

The engine uses heuristics, not understanding. Treat the score as a checklist that highlights questions to ask, not a final verdict.

**Reading the document**
- **OCR quality:** blurry scans, low-light photos, stylised brochure fonts and text over images can garble place names, prices and dates. Clear PDFs and Word files give the most accurate results.
- **OCR speed:** image-only PDFs take about 3 s per page and photos about 8 s, versus about 1 s for text documents.
- **English only:** OCR uses the English model, and all rules match English wording. Itineraries in other languages won't be parsed properly.
- **Unusual layouts:** days are found from "Day N" headings, numbered lists, per-page headings, tables and simple prose ("the next day…"). Other layouts (e.g. multi-column brochures where OCR mixes columns, or plans with no day structure at all) show days as "Not clearly described" and are scored on general content only.
- **Dates:** numeric dates are read as day/month (`05/06/2026` = 5 June). Without a labelled "Travel date" it uses the first date in the document, which may be a quote or validity date.
- **Price:** it picks the largest per-person figure. Documents with several price options (e.g. standard vs deluxe, or different group sizes) are scored on the highest one. Currency conversion uses fixed approximate rates.

**Rules and data**
- **Seasonal warnings only cover known places:** about 300 places across India and popular international destinations. Other destinations get no seasonal check; the report says to check the local season.
- **Southern hemisphere and microclimates:** climate is set per region, so local exceptions (e.g. rain-shadow valleys, or altitude differences within a region) aren't captured.
- **Drive times:** they come from the document, a small built-in leg table, or a rough distance-based estimate. Road works, closures, traffic and border or permit stops aren't considered.
- **Mixed-mode days:** a day that combines several modes (fly + drive + boat) is labelled by its main mode, so it may look lighter than it really is.
- **Place names:** unknown places are picked up from capitalised words in day titles, so occasionally a non-place (e.g. an attraction name) is listed as a stop.
- **Static data:** climate, distances, price bands and exchange rates are built-in approximations, not live data. Nothing checks real hotel quality, reviews, availability or the operator's reputation.

**Scoring**
- **Fixed rubric weights:** the 100-point weights and category bands are fixed. A short city break and a high-altitude road trip are scored with the same rubric.
- **Absence ≠ problem:** many points depend on what the document *mentions*. A good trip with a short quote can score lower than a weaker trip with a detailed one.
- **Not-an-itinerary check:** it relies on travel keywords, so very short or unusual documents may be wrongly rejected or accepted.

**App**
- **No accounts, history or saved reports:** each upload is analysed and then discarded.
- **Upload limit:** 30 MB per file, one file at a time.
- **Concurrency:** the OCR pool is shared, so several large scans uploaded at once queue behind each other.

## License

[MIT](LICENSE)
