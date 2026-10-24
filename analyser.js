// Rule-based itinerary scorer. No AI, no network: reads the itinerary text and
// scores it on a weighted 100-point rubric using travel heuristics.
//
// The rules are generic so any itinerary works: days are split on their headings,
// drive times/distances are read from the document itself, travel mode (road,
// flight, train, boat, overnight) is detected per day, and seasonality comes from
// a per-region climate table. The place and leg tables only sharpen the result
// when a destination is recognised; unknown places still get parsed and scored.

export const RUBRIC = [
  { key: "route", name: "Route & Logistics", max: 20 },
  { key: "pacing", name: "Pacing & Comfort", max: 15 },
  { key: "season", name: "Seasonality & Safety", max: 15 },
  { key: "stays", name: "Accommodation", max: 10 },
  { key: "experiences", name: "Experiences & Sightseeing", max: 10 },
  { key: "inclusions", name: "Inclusions & Exclusions Clarity", max: 10 },
  { key: "value", name: "Value for Money", max: 10 },
  { key: "policies", name: "Policies & Hidden Costs", max: 5 },
  { key: "accuracy", name: "Document Accuracy & Consistency", max: 5 },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

// Climate risk per region as [fromMonth, toMonth] (0 = Jan, ranges may wrap the year end).
// snow: snowbound roads / sub-zero at altitude (applies to "high" places), rain: monsoon or wet
// season, heat: uncomfortably hot. landslides: monsoon regularly closes hill roads. intl: outside India
// (changes value bands and visa advice).
const REGIONS = {
  "western himalaya": { snow: [10, 2], rain: [6, 7], landslides: true },
  ladakh: { snow: [10, 3] },
  "eastern himalaya": { snow: [11, 1], rain: [5, 8], landslides: true },
  "north plains": { heat: [4, 5] },
  rajasthan: { heat: [3, 5] },
  "india west coast": { rain: [5, 8], landslides: true },
  "india east coast": { rain: [9, 11], heat: [3, 5] },
  deccan: { heat: [3, 4] },
  andaman: { rain: [4, 8] },
  nepal: { snow: [11, 1], rain: [5, 8], landslides: true, intl: true },
  bhutan: { snow: [11, 1], rain: [5, 8], landslides: true, intl: true },
  "sri lanka": { rain: [4, 8], intl: true },
  maldives: { rain: [4, 9], intl: true },
  "thailand andaman coast": { rain: [4, 9], intl: true },
  "thailand central": { rain: [6, 9], heat: [3, 4], intl: true },
  "thailand gulf islands": { rain: [9, 11], intl: true },
  indonesia: { rain: [11, 2], intl: true },
  "malaysia & singapore": { rain: [10, 0], intl: true },
  "north vietnam": { rain: [5, 8], landslides: true, intl: true },
  "central vietnam": { rain: [8, 11], intl: true },
  "south vietnam": { rain: [4, 9], intl: true },
  gulf: { heat: [5, 8], intl: true },
  "egypt & jordan": { heat: [5, 7], intl: true },
  "east africa": { rain: [3, 4], intl: true },
  mauritius: { rain: [0, 2], intl: true },
  japan: { rain: [5, 8], intl: true },
  "tropical australia": { rain: [11, 3], intl: true },
  caribbean: { rain: [7, 9], intl: true },
  europe: { snow: [11, 2], intl: true },
  temperate: { intl: true },
};

// type: high = high-altitude (snow/AMS risk), hill, beach, desert, city.
// winterClosed: pass/place usually cut off by snow during its region's snow months.
const PLACES = {};
const add = (region, type, names, extra = {}) => {
  for (const name of names.split(",")) PLACES[name.trim()] = { region, type, ...extra };
};
add("western himalaya", "city", "chandigarh, haridwar, dehradun");
add("western himalaya", "hill", "shimla, kufri, narkanda, sarahan, rampur, sangla, kalpa, reckong peo, manali, kullu, solang, kasol, dharamshala, mcleodganj, dalhousie, khajjiar, tirthan, jibhi, rishikesh, mussoorie, dhanaulti, nainital, ranikhet, almora, kausani, lansdowne, chopta, corbett, srinagar, gulmarg, pahalgam, sonamarg");
add("western himalaya", "high", "chitkul, nako, tabo, kaza, dhankar, langza, komic, hikkim, kibber, auli");
add("western himalaya", "high", "chandratal, kunzum, rohtang, kedarnath, badrinath, valley of flowers, hemkund, gangotri, yamunotri", { winterClosed: true });
add("ladakh", "high", "leh, nubra, diskit, hunder, pangong, turtuk, khardung la, kargil, hanle");
add("ladakh", "high", "tso moriri, zanskar", { winterClosed: true });
add("eastern himalaya", "city", "bagdogra, siliguri, guwahati");
add("eastern himalaya", "hill", "gangtok, darjeeling, kalimpong, pelling, ravangla, namchi, shillong, cherrapunji, mawlynnong, dawki, kaziranga");
add("eastern himalaya", "high", "lachung, lachen, yumthang, tsomgo, zuluk, tawang, bomdila, dirang");
add("eastern himalaya", "high", "gurudongmar", { winterClosed: true });
add("north plains", "city", "delhi, agra, mathura, vrindavan, varanasi, ayodhya, prayagraj, lucknow, amritsar, khajuraho, orchha, gwalior, ujjain, indore, bhopal");
add("rajasthan", "city", "jaipur, udaipur, ranthambore, chittorgarh, mount abu");
add("rajasthan", "desert", "jodhpur, jaisalmer, pushkar, bikaner");
add("india west coast", "city", "mumbai, kochi, cochin, trivandrum, mangalore");
add("india west coast", "beach", "goa, alleppey, alappuzha, kumarakom, kovalam, varkala, gokarna");
add("india west coast", "hill", "munnar, thekkady, wayanad, coorg, ooty, chikmagalur, lonavala, mahabaleshwar");
add("india east coast", "city", "chennai, madurai, rameswaram, kanyakumari, tirupati, visakhapatnam");
add("india east coast", "beach", "pondicherry, puducherry, mahabalipuram");
add("india east coast", "hill", "kodaikanal");
add("deccan", "city", "bangalore, bengaluru, mysore, hampi, hyderabad, aurangabad, ajanta, ellora");
add("andaman", "beach", "andaman, port blair, havelock, swaraj dweep, neil island");
add("nepal", "city", "kathmandu, bhaktapur, chitwan");
add("nepal", "hill", "pokhara, nagarkot");
add("nepal", "high", "lukla, namche, everest base camp");
add("bhutan", "hill", "thimphu, paro, punakha");
add("sri lanka", "city", "colombo, sigiriya");
add("sri lanka", "hill", "kandy, nuwara eliya");
add("sri lanka", "beach", "bentota, galle");
add("maldives", "beach", "maldives");
add("thailand andaman coast", "beach", "phuket, krabi, phi phi, khao lak, ao nang");
add("thailand central", "city", "bangkok, ayutthaya, chiang mai, chiang rai");
add("thailand central", "beach", "pattaya");
add("thailand gulf islands", "beach", "koh samui, koh phangan, koh tao");
add("indonesia", "beach", "bali, seminyak, kuta, nusa penida, lombok, gili");
add("indonesia", "hill", "ubud");
add("indonesia", "city", "jakarta");
add("malaysia & singapore", "city", "singapore, kuala lumpur, penang");
add("malaysia & singapore", "beach", "langkawi");
add("malaysia & singapore", "hill", "genting");
add("north vietnam", "city", "vietnam, hanoi, ninh binh");
add("north vietnam", "beach", "ha long, halong");
add("north vietnam", "hill", "sapa");
add("central vietnam", "city", "da nang, hoi an, hue");
add("south vietnam", "city", "ho chi minh, saigon, mekong");
add("south vietnam", "beach", "phu quoc");
add("gulf", "desert", "dubai, abu dhabi, sharjah, doha, muscat");
add("egypt & jordan", "desert", "cairo, luxor, aswan, petra, amman, wadi rum");
add("east africa", "city", "nairobi, masai mara, maasai mara, serengeti, amboseli");
add("east africa", "beach", "zanzibar");
add("mauritius", "beach", "mauritius");
add("japan", "city", "tokyo, kyoto, osaka, hiroshima, nara, hakone");
add("tropical australia", "beach", "cairns, darwin");
add("caribbean", "beach", "cancun, bahamas, jamaica, miami, puerto rico");
add("europe", "city", "paris, london, rome, venice, florence, milan, amsterdam, barcelona, madrid, lisbon, prague, vienna, budapest, berlin, munich, zurich, geneva, brussels, athens, istanbul");
add("europe", "hill", "switzerland, interlaken, lucerne, zermatt, grindelwald, jungfraujoch, titlis, innsbruck, salzburg, cappadocia");
add("europe", "beach", "santorini, mykonos, amalfi");
add("temperate", "city", "sydney, melbourne, gold coast, auckland, christchurch, new york, las vegas, los angeles, san francisco, toronto, vancouver");
add("temperate", "hill", "queenstown");
// Region-specific cautions that the generic snow/rain rules don't capture.
PLACES.chitkul.caution = { months: [11, 1], title: "Chitkul may be snowed in", detail: "In late December-February the road beyond Rakchham often closes after snowfall, so the Chitkul day may get cut short or swapped." };

// Alternate spellings, matched in the text but reported under one name.
const ALIASES = {
  cochin: "kochi", alappuzha: "alleppey", bengaluru: "bangalore", puducherry: "pondicherry", halong: "ha long",
  saigon: "ho chi minh", "maasai mara": "masai mara", diskit: "nubra", hunder: "nubra",
};
const canon = (p) => ALIASES[p] ?? p;
const PLACE_RES = Object.keys(PLACES).map((name) => [name, new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "g")]);

// Approximate road distance (km) and travel hours for common legs. Used only when the
// document doesn't state the time itself; otherwise it is estimated from a stated distance.
const LEGS = {
  "delhi|shimla": [345, 8], "shimla|sarahan": [170, 6], "sarahan|sangla": [90, 4], "sarahan|chitkul": [115, 5],
  "sangla|chitkul": [25, 1], "chitkul|tabo": [210, 9], "sangla|tabo": [185, 8], "kalpa|tabo": [150, 6], "chitkul|nako": [150, 6],
  "tabo|kaza": [47, 2], "shimla|sangla": [225, 8], "shimla|kalpa": [230, 8], "kaza|kalpa": [205, 8], "kaza|reckong peo": [200, 8], "kalpa|shimla": [230, 8], "reckong peo|shimla": [225, 8],
  "kalpa|sangla": [45, 2], "kalpa|chitkul": [60, 3], "rampur|sangla": [95, 4], "shimla|rampur": [130, 5], "sarahan|kalpa": [110, 4],
  "manali|kaza": [200, 9], "manali|chandratal": [125, 6], "delhi|manali": [540, 13], "shimla|manali": [250, 8], "manali|leh": [430, 14],
  "srinagar|leh": [420, 12], "leh|nubra": [150, 5], "leh|pangong": [220, 6], "nubra|pangong": [170, 6], "leh|tso moriri": [220, 7],
  "leh|kargil": [215, 6], "srinagar|gulmarg": [50, 2], "srinagar|pahalgam": [95, 3], "srinagar|sonamarg": [80, 3],
  "delhi|rishikesh": [240, 6], "delhi|haridwar": [220, 5], "delhi|mussoorie": [290, 7], "delhi|nainital": [310, 8], "rishikesh|auli": [255, 9],
  "bagdogra|gangtok": [125, 4], "gangtok|lachung": [115, 5], "gangtok|darjeeling": [100, 4], "gangtok|pelling": [115, 5], "bagdogra|darjeeling": [70, 3],
  "jaipur|udaipur": [395, 7], "jaipur|jodhpur": [335, 6], "jodhpur|jaisalmer": [285, 5], "udaipur|jodhpur": [250, 5], "jaipur|pushkar": [145, 3],
  "jaipur|ranthambore": [160, 4], "delhi|jaipur": [280, 5], "jaipur|jaisalmer": [560, 10], "jaisalmer|udaipur": [490, 9], "delhi|agra": [230, 4], "agra|jaipur": [240, 5],
  "kochi|munnar": [130, 4], "cochin|munnar": [130, 4], "munnar|thekkady": [90, 3], "thekkady|alleppey": [140, 4], "alleppey|kovalam": [160, 4],
  "mysore|ooty": [125, 4], "mysore|coorg": [120, 3], "bangalore|mysore": [145, 3], "bengaluru|mysore": [145, 3],
  "kathmandu|pokhara": [200, 7], "bangkok|pattaya": [150, 2.5], "phuket|krabi": [165, 3], "hanoi|ha long": [170, 3], "hanoi|halong": [170, 3],
  "zurich|lucerne": [50, 1], "lucerne|interlaken": [70, 1.5], "zurich|interlaken": [120, 2], "dubai|abu dhabi": [140, 2],
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const count = (text, re) => (text.match(re) ?? []).length;
const has = (text, re) => re.test(text);
const clamp = (v, max) => Math.round(Math.min(max, Math.max(0, v)) * 2) / 2;
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const list = (names) => names.slice(0, 3).map(cap).join(", ");
const inMonths = (month, r) => {
  if (!r || month === null) return false;
  const [a, b] = r;
  return a <= b ? month >= a && month <= b : month >= a || month <= b;
};
const typeOf = (p) => PLACES[p]?.type ?? null;
const isHigh = (p) => typeOf(p) === "high";
const isHilly = (p) => typeOf(p) === "hill" || typeOf(p) === "high";

function findPlaces(lower) {
  const found = {};
  for (const [name, re] of PLACE_RES) {
    const n = count(lower, re);
    if (n) found[canon(name)] = (found[canon(name)] ?? 0) + n;
  }
  return found;
}

function placeIn(fragment) {
  const f = fragment.toLowerCase();
  let best = null;
  for (const [name, re] of PLACE_RES) {
    const i = f.search(re);
    if (i >= 0 && (best === null || i < best.i)) best = { name: canon(name), i };
  }
  return best?.name ?? null;
}

// Words that start a day title but are never a place name.
const NOT_PLACES = new Set(["hotel", "resort", "airport", "station", "day", "leisure", "arrival", "arrive", "departure", "depart",
  "home", "check", "sightseeing", "lunch", "dinner", "breakfast", "overnight", "local", "the", "your", "return", "free", "trip",
  "tour", "city", "excursion", "journey", "drive", "transfer", "visit", "explore", "morning", "evening", "afternoon", "night",
  "back", "via", "and", "with", "on", "in", "we", "you", "then", "upon", "onward", "camp", "stay", "rest", "full", "half", "boat", "flight", "train", "bus", "cab", "end",
  "ends", "start", "welcome", "optional", "board", "bid", "farewell", "after", "post", "early", "later", "next"]);

// A known place if there is one, else a capitalised name (so unknown destinations still form a route).
function placeName(fragment) {
  const known = placeIn(fragment);
  if (known) return known;
  const f = fragment
    .replace(/^\W*(?:(?:arriv\w*|depart\w*|drive|fly|flight|transfer|travel|proceed|head|reach|return|journey|road trip|day trip|from|in|at|to|via)\b\W*)+/i, "")
    .trim();
  const m = f.match(/^([A-Z][A-Za-z'’]+(?:[ -][A-Z][A-Za-z'’]+){0,2})/);
  if (!m || NOT_PLACES.has(m[1].split(/[ -]/)[0].toLowerCase())) return null;
  return m[1].toLowerCase();
}

// "A to B", "A → B → C", "A - B" (dash only between two known places), "Arrive in B", "Fly to B".
// stops lists every place on the way so multi-stop days add up all their legs.
function routeOf(title) {
  const t = title.replace(/\([^)]*\)/g, " ");
  const parts = t.split(/\s*(?:\bto\b|→|->|➔|➝|>)\s*/i);
  if (parts.length > 1) {
    const stops = [placeName(parts[0]), ...parts.slice(1).map(placeName).filter(Boolean)];
    const to = stops[stops.length - 1];
    if (stops.length > 1 && to) return { from: stops[0], to, stops: stops.filter(Boolean) };
  }
  let m = t.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  if (m) {
    const a = placeIn(m[1]), b = placeIn(m[2]);
    if (a && b && a !== b) return { from: a, to: b, stops: [a, b] };
  }
  m = t.match(/\b(?:arriv\w*|reach\w*|fly|flight|land\w*)\b(?:\s+(?:in|at|into|to))?\s+(.+)/i);
  if (m && !/^(home|back|out|from)\b/i.test(m[1]) && !/depart/i.test(t)) {
    const to = placeName(m[1]);
    if (to) return { from: null, to, stops: [to] };
  }
  return null;
}

function leg(a, b) {
  if (!a || !b || a === b) return null;
  return LEGS[`${a}|${b}`] ?? LEGS[`${b}|${a}`] ?? null;
}

// Sum of the table legs along the stops, or null if any hop is unknown.
function routeLeg(stops) {
  let km = 0, hours = 0;
  for (let i = 1; i < stops.length; i++) {
    const l = leg(stops[i - 1], stops[i]);
    if (!l) return null;
    km += l[0];
    hours += l[1];
  }
  return stops.length > 1 ? [km, hours] : null;
}

// An "overnight cruise" is a night's stay on board, not a travel night, so it isn't listed.
const OVERNIGHT_TITLE = /overnight\s+(journey|bus|train|drive|volvo|coach|ferry)|\(overnight\b[^)]*\)|night (bus|train)|sleeper (bus|train|coach)/;
const OVERNIGHT_BODY = /overnight\s*:\s*[^\n]*(bus|train|journey|sleeper|volvo)|board (?:an? |the |your )?(?:overnight|night|sleeper|volvo)/;

function modeOf(tl, bl, fallback) {
  if (OVERNIGHT_TITLE.test(tl) || OVERNIGHT_BODY.test(bl)) return "overnight";
  for (const s of [tl, bl]) {
    if (/\b(fly|flies|flight|flights|by air|airlines?)\b/.test(s)) return "flight";
    if (/\b(train|rail|railway|shinkansen|tgv|eurostar)\b/.test(s)) return "train";
    if (/\b(ferry|catamaran|speedboat|seaplane)\b/.test(s)) return "boat";
  }
  return fallback;
}

// Travel time/distance written in the text: "approx 6 hrs drive", "(170 km / 6 hrs)", "4-5 hours journey".
// Clock times ("14:00 hrs", "1400 hrs") and non-travel durations ("2 hours at the museum") are ignored;
// in a day title any duration counts, since "Vik to Hofn (4 hrs)" is about the transfer.
function statedTravel(s, isTitle = false) {
  let hours = null, km = null;
  for (const m of s.matchAll(/(?<![\d:.])(\d{1,2}(?:\.\d)?)(?:\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d)?))?\s*(?:hrs?|hours?)\b/gi)) {
    const ctx = s.slice(Math.max(0, m.index - 50), m.index + m[0].length + 40).toLowerCase();
    if (!isTitle && !/driv|journey|travel|transfer|road|km|flight|train|ferry|ride|route|\/\s*$/.test(ctx)) continue;
    const h = +(m[2] ?? m[1]);
    if (h > 0 && h <= 20) hours = Math.max(hours ?? 0, h);
  }
  const k = s.match(/(?<![\d,.])(\d{1,2},\d{3}|\d{2,4})\s*(?:kms?|kilomet(?:er|re)s?)\b/i);
  if (k && +k[1].replace(",", "") <= 2000) km = +k[1].replace(",", "");
  return { hours, km };
}

function parseDuration(text) {
  let m = text.match(/\b(\d{1,2})\s*D(?:ays?)?\s*[\/&,|-]?\s*(\d{1,2})\s*N(?:ights?)?\b/i);
  if (m) return { days: +m[1], nights: +m[2] };
  m = text.match(/\b(\d{1,2})\s*N(?:ights?)?\s*[\/&,|-]?\s*(\d{1,2})\s*D(?:ays?)?\b/i);
  if (m) return { days: +m[2], nights: +m[1] };
  // "A 7-day trip" near the top (later "N days" are usually policy terms).
  m = text.slice(0, 1500).match(/(?<!\b(?:within|in|than|of|next|last|due)\s+)\b(\d{1,2})[\s-]*days?\b(?!\s*(?:before|prior|after|from|in advance|of))/i);
  if (m && +m[1] >= 2) return { days: +m[1], nights: +m[1] - 1 };
  return null;
}

function parseStartDate(text) {
  // Prefer an explicitly labelled travel date, else the first date in the document.
  const patterns = [
    [new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?[-\\/ ]?\\s*${MONTH_RE}[-\\/ ,]*(\\d{4})?`, "i"), (m) => [+m[1], m[2], m[3]]],
    [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(\\d{4})?`, "i"), (m) => [+m[2], m[1], m[3]]],
    [/\b(20\d{2})-(\d{2})-(\d{2})\b/, (m) => [+m[3], MONTHS[+m[2] - 1], m[1]]],
    [/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/, (m) => [+m[1], MONTHS[+m[2] - 1], m[3]]],
    [new RegExp(`\\b${MONTH_RE}\\s+(20\\d{2})\\b`, "i"), (m) => [null, m[1], m[2]]],
  ];
  const find = (s) => {
    let best = null;
    for (const [re, get] of patterns) {
      const m = s.match(re);
      if (!m || (best && m.index >= best.index)) continue;
      const [day, mon, year] = get(m);
      const month = mon ? MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) : -1;
      if (month < 0 || (day !== null && (day < 1 || day > 31))) continue;
      best = { index: m.index, day, month, year: year ? +year : null };
    }
    return best;
  };
  const labelled = text.match(/(?:travel|departure|tour|trip|start|journey|arrival)\s*dates?|dates? of (?:travel|journey)|departing on|check[- ]?in date|valid for travel[^\n]*/i);
  const d = (labelled && find(text.slice(labelled.index, labelled.index + 160))) || find(text);
  if (!d) return null;
  return { ...d, raw: `${d.day ? `${d.day} ` : ""}${cap(MONTHS[d.month])}${d.year ? ` ${d.year}` : ""}` };
}

const CURRENCIES = [
  [/s\$|sgd/i, "S$", 65], [/a\$|aud/i, "A$", 57], [/aed|dirham/i, "AED ", 23], [/£|gbp/i, "£", 112], [/€|eur/i, "€", 95],
  [/฿|thb|baht/i, "฿", 2.6], [/myr|\brm\b/i, "RM ", 19], [/\$|usd/i, "$", 86], [/(?:)/, "₹", 1],
];

function parsePrice(text, travellers) {
  const CUR = "(₹|rs\\.?|inr|usd|us\\$|s\\$|a\\$|sgd|aud|\\$|€|eur|£|gbp|aed|thb|฿|myr)?";
  const AMT = "(\\d{1,3}(?:,\\d{2,3})+|\\d{3,7})(?:\\.\\d+)?\\s*(?:\\/-)?";
  const BASIS = "(per\\s*person|\\/\\s*person|\\bpp\\b|per\\s*pax|\\/\\s*pax|per\\s*head|per\\s*adult|per\\s*couple|\\/\\s*couple)";
  const candidates = [];
  // split: how many people a total price covers (0/1 = already per person).
  const push = (cur, amt, basis, split = 0) => {
    const [, currency, rate] = CURRENCIES.find(([re]) => re.test(cur ?? ""));
    let amount = +amt.replace(/,/g, "");
    if (/couple/i.test(basis ?? "")) amount = Math.round(amount / 2);
    if (split > 1) amount = Math.round(amount / split);
    candidates.push({ amount, currency, inr: amount * rate });
  };
  for (const m of text.matchAll(new RegExp(`${CUR}\\s*${AMT}[^\\d\\n]{0,25}?${BASIS}`, "gi"))) push(m[1], m[2], m[3]);
  for (const m of text.matchAll(new RegExp(`${BASIS}[^\\d\\n]{0,30}?${CUR}\\s*${AMT}`, "gi"))) push(m[2], m[3], m[1]);
  if (!candidates.length) {
    // A labelled price with a currency but no stated basis. "Total" prices, or "X for 2 adults",
    // are split across the travellers.
    const GROUP = "(?:[^\\d\\n]{0,10}for\\s*(\\d{1,2})\\s*(?:adults|people|persons|pax|guests|travell?ers))?";
    const re = new RegExp(`(?:(total)[^\\n\\d]{0,15})?(?:price|cost|fare|amount|package)[^\\d\\n]{0,30}?${CUR.slice(0, -1)}\\s*${AMT}${GROUP}`, "gi");
    for (const m of text.matchAll(re)) push(m[2], m[3], null, m[4] ? +m[4] : m[1] ? travellers ?? 0 : 0);
  }
  // Excursion and fee lines are also "per person"; the package price is the largest one.
  return candidates.sort((a, b) => b.inr - a.inr)[0] ?? null;
}

function parseDays(text, expected) {
  // A title is the heading line, cut at a wide gap or, when long, at the first sentence.
  const titleOf = (s) => {
    // In a table row ("| Day 1 | Plan | Stay |") only the plan cell is the title.
    if (/\|\s*$/.test(s)) s = s.split("|")[0];
    const t = s.replace(/\s{2,}.*/, "").replace(/[|•·:]\s*$/, "").trim();
    return t.length > 50 ? t.replace(/\.\s+[A-Z].*$/, "") : t;
  };
  const dayNum = (s) => (/^\d+$/.test(s) ? +s : NUM_WORDS.indexOf(s.toLowerCase()));

  // 1. Explicit "Day N" headings: "Day 1: ...", "DAY 01 | ...", "Day One - ...", "Day 1 Arrival",
  //    or "Day 1" with the title on the next line. Each day's body runs to the next heading.
  const hits = [];
  const re = new RegExp(`\\bday\\s*(0?\\d{1,2}|${NUM_WORDS.slice(1).join("|")})\\b(?:[^\\S\\n]*[:\\-–—.)|][^\\S\\n]*|[^\\S\\n]*\\n\\s*|[^\\S\\n]+)([A-Za-z][^\\n]{3,90})`, "gi");
  for (const m of text.matchAll(re)) {
    const n = dayNum(m[1]);
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (n < 1 || n > 40 || /\b(from|to|till|until|on|by|of|and|before|after|the|per)\s*$/i.test(before)) continue;
    if (/^(to|and|onwards?|till|until|&)\b/i.test(m[2])) continue;
    hits.push({ n, index: m.index, title: titleOf(m[2]), bodyStart: m.index + m[0].length });
  }
  const labelled = {};
  hits.forEach((h, i) => {
    const body = text.slice(h.bodyStart, hits[i + 1]?.index ?? text.length);
    const cur = labelled[h.n];
    // First mention gives the title (overview tables are concise); the longest gives the body.
    if (!cur) labelled[h.n] = { title: h.title, body };
    else if (body.length > cur.body.length) cur.body = body;
  });
  const target = expected ?? 3;
  const maxLabelled = Math.max(0, ...Object.keys(labelled).map(Number));
  if (Object.keys(labelled).length >= Math.max(2, Math.ceil(target * 0.6))) return { days: labelled, total: expected ?? maxLabelled, maxLabelled };

  // 2. Numbered overview ("01 Delhi to Shimla | ...") or numbered list ("1. Arrive Hanoi", "2) ..."),
  //    found in sequence close together.
  const seq = {};
  let pos = 0, lastIdx = -1, gap = 1;
  for (let n = 1; n <= 30; n++) {
    const num = n < 10 ? `0${n}` : `${n}`;
    const r = new RegExp(`(?:(?:^|[^\\d/+.-])${num}\\s+|^[^\\S\\n]*(?:${num}|${n})[^\\S\\n]*[.)][^\\S\\n]*)([A-Za-z][^\\n]{3,90})`, "gm");
    r.lastIndex = pos;
    const m = r.exec(text);
    if (m && (lastIdx < 0 || m.index - lastIdx < 700 * gap)) {
      seq[n] = { title: titleOf(m[1]), body: "" };
      pos = lastIdx = m.index + 1;
      gap = 1;
    } else {
      gap++;
      if (gap > 3) break;
    }
  }

  // 3. Fill gaps from per-day page headings (": Delhi to Shimla | ...") when they line up one per day.
  const headers = [...text.matchAll(/^\s*:\s*([A-Za-z][^\n]{3,90})$/gm)]
    .map((m) => titleOf(m[1]))
    .filter((h) => /\sto(\s|$)|\||sightseeing|arriv|depart|explore|leisure|excursion|free day/i.test(h));
  if (expected && headers.length === expected) {
    for (let n = 1; n <= expected; n++) if (!seq[n]) seq[n] = { title: headers[n - 1], body: "" };
  }
  if (Object.keys(seq).length >= 2) return { days: seq, total: expected ?? Math.max(...Object.keys(seq).map(Number)), maxLabelled: 0 };
  if (expected && headers.length >= expected * 0.6) return { days: Object.fromEntries(headers.map((h, i) => [i + 1, { title: h, body: "" }])), total: expected, maxLabelled: 0 };

  // 4. Prose: "On arrival ... The next day ... On the third day ... On the final day ...".
  const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth"];
  const markers = [...text.matchAll(new RegExp(`\\b(?:(?:on|upon) arrival|(?:the )?(?:next|following) day|(?:on )?(?:the )?(${ORDINALS.join("|")}|final|last) day)\\b`, "gi"))];
  if (markers.length >= 2) {
    const prose = {};
    let n = 0;
    markers.forEach((m, i) => {
      const word = m[1]?.toLowerCase();
      n = /arrival/i.test(m[0]) ? 1 : word === "final" || word === "last" ? Math.max(n + 1, expected ?? 0) : word ? ORDINALS.indexOf(word) + 1 : n + 1;
      const passage = text.slice(m.index, markers[i + 1]?.index ?? text.length);
      const sentence = passage.split(/(?<=[.!?])\s/)[0].trim().slice(0, 100);
      if (!prose[n]) prose[n] = { title: sentence, body: passage };
    });
    if (Object.keys(prose).length >= 2) return { days: prose, total: expected ?? Math.max(...Object.keys(prose).map(Number)), maxLabelled: 0 };
  }
  return { days: {}, total: expected ?? 0, maxLabelled: 0 };
}

export function analyse(rawText) {
  const text = rawText.replace(/\r/g, "");
  const lower = text.toLowerCase();

  const isItinerary =
    count(lower, /\b(itinerary|day\s*\d|overnight|check[- ]?in|sightseeing|inclusions?|exclusions?|includes|excludes|hotels?|resort|transfer|pick ?up|accommodation|tour|arriv\w*|departure|flights?|cruise|nights?|trip|holiday|package)\b/g) >= 4;

  const duration = parseDuration(text);
  const start = parseStartDate(text);
  const travellersMatch = text.match(/\b(\d{1,2})\s*(?:travell?ers|pax|adults|guests|persons|people)\b/i);
  const travellers = travellersMatch ? +travellersMatch[1] : null;
  const price = parsePrice(text, travellers);
  const operator = text.match(/www\.([a-z0-9-]+)\.(?:com|in|co\.in|net|travel|co\.uk|com\.au)/i)?.[1] ?? "";
  const places = findPlaces(lower);
  const known = Object.keys(places);
  const month = start?.month ?? null;
  const monthName = month !== null ? cap(MONTHS[month]) : null;
  const peakHoliday = start?.day && ((month === 11 && start.day >= 20) || (month === 0 && start.day <= 5));
  const international = known.some((p) => REGIONS[PLACES[p].region].intl) || (price && price.currency !== "₹");

  // Altitude stated in the document ("3,800 m", "12,500 ft") covers places not in the table.
  const altitudes = [...text.matchAll(/(\d{1,2},?\d{3})\s*(m|mtrs?|metres?|meters?|ft|feet)\b/gi)]
    .map((m) => +m[1].replace(",", "") * (/^f/i.test(m[2]) ? 0.305 : 1))
    .filter((m) => m < 9000);
  const highPlaces = known.filter(isHigh);
  const altitudeTrip = highPlaces.length > 0 || altitudes.some((a) => a >= 3000);
  const mountainous = known.some(isHilly) || altitudeTrip || has(lower, /\b(ghat road|mountain pass|hairpin|himalaya|alps)\b/);

  const { days: dayMap, total: totalDays, maxLabelled } = parseDays(text, duration?.days);

  const flags = [];
  const strengths = [];
  const recs = [];
  const notes = Object.fromEntries(RUBRIC.map((r) => [r.key, []]));
  const score = {};
  const flag = (severity, title, detail) => flags.push({ severity, title, detail });

  // ---------- Day-by-day load ----------
  const days = [];
  const meta = [];
  let heavyDays = 0, longestDrive = null, unknownTransfers = 0, backtracks = 0, overnightDays = 0, roadLegs = 0;
  const visited = [];
  const stayDays = {};
  // Rail-pass trips move between cities by train unless a day says otherwise.
  const defaultMode = has(lower, /rail ?pass|jr pass|eurail|swiss travel pass|train pass/) ? "train" : "road";
  const firstRoute = routeOf(dayMap[1]?.title ?? "");
  const home = firstRoute?.from ?? firstRoute?.to ?? null;
  for (let n = 1; n <= totalDays; n++) {
    const d = dayMap[n];
    if (!d) {
      days.push({ day: n, title: "Not clearly described", load: "moderate", note: "Couldn't read this day's plan from the document." });
      meta.push({});
      continue;
    }
    const { title, body } = d;
    const tl = title.toLowerCase(), bl = body.toLowerCase();
    const route = routeOf(title);
    const from = route?.from ?? null, to = route?.to ?? null;
    const mode = modeOf(tl, bl, defaultMode);
    const st = statedTravel(title, true), sb = statedTravel(body);
    const stated = { hours: st.hours ?? sb.hours, km: st.km ?? sb.km };
    const l = route ? routeLeg(route.stops) : null;
    const arrival = /^\W*(arriv|welcome)/i.test(title) && stated.hours === null;
    const speed = mode === "train" ? 60 : mountainous && (isHilly(from) || isHilly(to) || !PLACES[to]) ? 30 : 50;
    const km = stated.km ?? l?.[0] ?? null;
    const hours = stated.hours ?? l?.[1] ?? (km ? Math.max(1, Math.round(km / speed)) : null);
    const estimated = stated.hours === null && !l && km !== null;
    let load = "light", note = "", driveHours = null;

    if (mode === "overnight") {
      load = "heavy";
      overnightDays++;
      note = hours ? `Overnight journey, ~${km ? `${km} km, ` : ""}${hours}+ hrs - sleep on the move.` : "Overnight journey - sleep on the move.";
    } else if (arrival) {
      note = to ? `Arrival${from && from !== to ? `, then transfer to ${cap(to)}` : ` in ${cap(to)}`}.` : "Arrival day.";
      if (to && isHigh(to)) note += " Rest here to acclimatise to the altitude.";
    } else if (from && to && from !== to) {
      const legName = route.stops.map(cap).join(" → ");
      if (mode === "flight") {
        load = "moderate";
        note = `Flight ${legName}${stated.hours ? ` (~${stated.hours} hrs)` : ""}, plus airport transfers and check-in time.`;
      } else if (hours) {
        load = hours >= 7 ? "heavy" : hours >= 4 ? "moderate" : "light";
        const how = mode === "train" ? "by train" : mode === "boat" ? "by boat" : "of driving";
        note = `${legName}: ${km ? `~${km} km, ` : ""}about ${hours} hrs ${how}${estimated ? " (estimated from distance)" : ""}${load === "heavy" && mode === "road" ? " plus stops" : ""}.`;
        if (mode === "road") {
          driveHours = hours;
          roadLegs++;
          if (!longestDrive || hours > longestDrive.hours) longestDrive = { from: cap(from), to: cap(to), hours, km, day: n };
        }
      } else {
        load = "moderate";
        unknownTransfers++;
        if (mode === "road") roadLegs++;
        note = `Transfer day (${legName}); travel time not stated in the document.`;
      }
    } else if (/sightseeing|explore|excursion|tour\b|visit|safari|trek|hike|day trip|city/.test(tl)) {
      const stops = Math.max(
        title.split(/[·•,|]|\s[-–&]\s|\band\b/).length,
        (body.match(/^\s*[-•*●▪➢✓]\s*\S/gm) ?? []).length,
        count(bl, /\b(visit|stop at|proceed to|head to|continue to|explore)\b/g),
      );
      if (stated.hours >= 5) {
        load = "heavy";
        note = `Day excursion with ~${stated.hours} hrs on the road.`;
      } else {
        load = stops >= 6 ? "heavy" : "moderate";
        note = stops >= 6 ? `Packed sightseeing day with ${stops}+ stops.` : "Local sightseeing day.";
      }
    } else if (to || /arriv|depart|trip ends|leisure|free|relax|fly home|fly back|flight home|return home|homeward|check[- ]?out|transfer to the airport/.test(tl)) {
      if (mode === "flight" && to) {
        load = "moderate";
        note = `Fly into ${cap(to)}, plus airport transfers.`;
      } else note = /leisure|free|relax/.test(tl) ? "Free / leisure time." : "Arrival or departure day.";
      if (to && isHigh(to)) note += " Rest here to acclimatise to the altitude.";
    } else {
      load = "moderate";
      note = "Day plan without clear travel info.";
    }

    const loc = to ?? placeIn(title);
    if (loc) stayDays[loc] = (stayDays[loc] ?? 0) + 1;
    if (to) {
      // Returning to where the trip started closes a loop; revisiting anywhere else is backtracking.
      if (visited.includes(to) && visited[visited.length - 1] !== to && to !== home && n < totalDays - 1) backtracks++;
      visited.push(to);
    }
    if (load === "heavy") heavyDays++;
    days.push({ day: n, title, load, note });
    meta.push({ mode, to, driveHours });
  }
  const overnightJourneys = Math.max(
    overnightDays,
    count(lower, /overnight\s*:\s*[^\n]*(bus|train|sleeper|flight|journey)/g),
    count(lower, /overnight\s+(journey|bus|train|drive)/g) > 0 ? 1 : 0,
  );
  const sightseeingDays = days.filter((d) => /sightseeing|explore|leisure|free|excursion/i.test(d.title)).length;

  // Destinations: most-mentioned places, leaving out the gateway the trip starts from.
  const gateway = routeOf(dayMap[1]?.title ?? "")?.from ?? null;
  const mentions = { ...places };
  for (const p of visited) if (!PLACES[p]) mentions[p] = (mentions[p] ?? 0) + 1;
  const ranked = Object.entries(mentions).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const topPlaces = (ranked.length > 1 ? ranked.filter((p) => p !== gateway) : ranked).slice(0, 4).map(cap);

  // Seasonal risks for the recognised places in the travel month.
  const risks = { snow: [], closed: [], rain: [], heat: [] };
  if (month !== null) {
    for (const p of known) {
      const r = REGIONS[PLACES[p].region];
      if (isHigh(p) && inMonths(month, r.snow)) risks.snow.push(p);
      if (PLACES[p].winterClosed && inMonths(month, r.snow)) risks.closed.push(p);
      if (inMonths(month, r.rain)) risks.rain.push(p);
      if (inMonths(month, r.heat)) risks.heat.push(p);
    }
  }
  const cold = risks.snow.length > 0 || has(lower, /sub[- ]zero|snowfall|freezing|minus\s*\d+\s*°/);
  const landslideRisk = (p) => isHilly(p) && REGIONS[PLACES[p].region].landslides;
  const roadRisk = risks.snow.length > 0 || risks.rain.some(landslideRisk);

  // ---------- Route & logistics (20) ----------
  {
    let s = 15;
    const n = notes.route;
    if (totalDays && Object.keys(dayMap).length >= totalDays * 0.6) { s += 2; n.push(`Clear day-by-day route across ${totalDays} days.`); }
    else { s -= 3; n.push("The day-by-day route is hard to follow in the document."); }
    if (longestDrive && longestDrive.hours >= 8) {
      s -= 2;
      n.push(`Longest drive is ${longestDrive.from} → ${longestDrive.to} (${longestDrive.km ? `~${longestDrive.km} km, ` : ""}${longestDrive.hours}+ hrs).`);
    }
    const longLegs = days.filter((_, i) => meta[i].driveHours >= 8);
    if (longLegs.length >= 3) {
      s -= 2;
      flag("medium", `${longLegs.length} driving days of 8+ hours`, `Days ${longLegs.map((d) => d.day).join(", ")} each involve 8 or more hours on ${mountainous ? "mountain roads" : "the road"}. Expect fatigue and little time at the stops.`);
    }
    if (backtracks) { s -= 2; n.push("The route doubles back on itself at least once."); }
    else if (visited.length >= 3) { s += 1; n.push("No obvious backtracking - the route flows in a loop or line."); }
    if (unknownTransfers >= 2) { s -= 1; n.push(`${unknownTransfers} transfer days don't state travel times.`); }
    if (has(lower, /boarding point|pick ?up point|meeting point|airport pick ?up|pick ?up from|meet (?:and|&) greet|arrival transfer|hotel pick ?up/)) { s += 1; n.push("Pickup/boarding point is specified."); }
    else recs.push("Ask for exact pickup and drop points and times.");
    const vehicle = has(lower, /tempo traveller|innova|ertiga|sedan|suv|xylo|bolero|crysta|\bcab\b|coach|volvo|semi-sleeper|minivan|mini ?bus|\bvan\b|private (car|vehicle|transfer)|car with driver|chauffeur|self[- ]drive|rental car|shuttle/);
    if (vehicle) n.push("Vehicle type for transfers is mentioned.");
    else if (roadLegs) { s -= 2; recs.push("Ask which vehicle is used for road transfers and whether it's private or shared."); }
    score.route = s;
  }

  // ---------- Pacing & comfort (15) ----------
  {
    let s = 12;
    const n = notes.pacing;
    if (overnightJourneys >= 2) {
      s -= 3;
      flag("medium", `${overnightJourneys} overnight journeys`, `${overnightJourneys} nights are spent travelling instead of in a bed. You start the trip tired and lose time at both ends.`);
      recs.push("Ask about a flight or daytime option for at least one leg, or an extra hotel night at the start or end.");
    } else if (overnightJourneys === 1) { s -= 1.5; n.push("Includes one overnight journey."); }
    const ratio = totalDays ? heavyDays / totalDays : 0;
    if (ratio >= 0.5) { s -= 4; n.push(`${heavyDays} of ${totalDays} days are heavy travel days.`); }
    else if (ratio >= 0.3) { s -= 2; n.push(`${heavyDays} of ${totalDays} days are heavy travel days.`); }
    else n.push(`Only ${heavyDays} heavy day(s) - comfortable overall pace.`);
    if (sightseeingDays === 0 && totalDays >= 4) { s -= 1.5; n.push("No full day without long transfers."); }
    else if (sightseeingDays >= 1) n.push(`${sightseeingDays} day(s) based in one place for sightseeing.`);
    if (altitudeTrip) {
      const stayedHigh = Object.entries(stayDays).some(([p, c]) => isHigh(p) && c >= 2)
        || new RegExp(`0?[2-9]\\s*nights?\\s*(?:in|at)?\\s*(${highPlaces.join("|") || "$^"})`, "i").test(text);
      if (has(lower, /acclimati[sz]/)) { s += 1; n.push("Builds in acclimatization for high altitude."); }
      else if (stayedHigh) n.push("Two nights at a high-altitude base helps acclimatization.");
      else { s -= 1.5; n.push("No acclimatization time mentioned for high altitude."); }
    }
    // Flying straight to altitude and moving on the next day is a classic AMS trap.
    meta.forEach((m, i) => {
      if (m.mode === "flight" && isHigh(m.to) && days[i + 1] && days[i + 1].load !== "light") {
        s -= 1.5;
        flag("medium", `No rest day after flying into ${cap(m.to)}`, `Day ${days[i + 1].day} is already a ${days[i + 1].load} day. After flying to high altitude, the first 24-48 hours should be rest to avoid altitude sickness.`);
      }
    });
    if (has(lower, /time permitting/)) n.push(`${count(lower, /time permitting/g)} activities are only 'time permitting' - a sign of tight days.`);
    score.pacing = s;
  }

  // ---------- Seasonality & safety (15) ----------
  {
    let s = 12;
    const n = notes.season;
    if (month === null) { s -= 1; n.push("Travel dates are not clearly stated, so seasonal fit can't be confirmed."); }
    if (risks.snow.length) {
      s -= 3;
      n.push(`${monthName} is deep winter in ${list(risks.snow)}: sub-zero nights and snow on roads.`);
    }
    if (risks.closed.length) {
      s -= 3;
      flag("high", `${list(risks.closed)} usually closed in ${monthName}`, `These places/passes are normally cut off by snow in ${monthName}. Ask how the plan changes if they can't be reached.`);
    }
    for (const p of known) {
      const c = PLACES[p].caution;
      if (c && inMonths(month, c.months)) flag("medium", c.title, c.detail);
    }
    if (risks.rain.length) {
      s -= 3;
      // What the rain means depends on where you are: hill roads slide, seas get rough, cities flood.
      const effects = [];
      const slides = risks.rain.filter(landslideRisk);
      const beaches = risks.rain.filter((p) => typeOf(p) === "beach");
      if (slides.length) effects.push(`landslides and road closures are common around ${list(slides)}`);
      if (beaches.length) effects.push(`seas get rough at ${list(beaches)}, so boat trips and water sports are often cancelled`);
      if (!effects.length) effects.push("expect heavy downpours, flooding and delays");
      flag("medium", `Wet season travel (${monthName})`, `${list(risks.rain)} ${risks.rain.length > 1 ? "are" : "is"} in the rainy season in ${monthName}: ${effects.join("; ")}.`);
    }
    if (risks.heat.length) {
      s -= 2;
      flag("medium", `Extreme heat in ${monthName}`, `${list(risks.heat)} ${risks.heat.length > 1 ? "are" : "is"} very hot in ${monthName}. Outdoor sightseeing should be early morning or evening only.`);
    }
    if (roadRisk && !has(lower, /buffer day|spare day|contingency day|extra day for/)) {
      s -= 1.5;
      flag("medium", "No buffer day for weather or road closures", `${risks.snow.length ? "Snow" : "Heavy rain"} closes mountain roads at short notice, and there is no spare day before the return. One blocked road can derail the rest of the trip.`);
      recs.push("Ask for (or budget for) a buffer day, and what happens to bookings if a road is closed.");
    }
    if (peakHoliday) {
      s -= 1;
      n.push("Peak Christmas/New Year week: crowds, higher prices and busy roads.");
    }
    const seasonal = Object.values(risks).some((r) => r.length);
    if (month !== null && known.length && !seasonal) { s += 1; n.push(`${monthName} is a reasonable season for ${list(known.filter((p) => p !== gateway).length ? known.filter((p) => p !== gateway) : known)}.`); }
    if (month !== null && !known.length) n.push("These destinations aren't in the built-in climate table - check the local season for your dates.");
    if (has(lower, /oxygen/)) { s += 1; strengths.push("Oxygen cylinder carried for high-altitude emergencies."); }
    if (has(lower, /medical kit|first[- ]aid/)) { s += 0.5; n.push("Medical kit carried."); }
    if (has(lower, /trip (coordinator|leader|captain)|tour (manager|leader|escort)|guide/)) { s += 1; n.push("A trip coordinator/guide accompanies the group."); }
    if (has(lower, /24\s*[\/x]\s*7/)) { s += 0.5; n.push("24/7 support is offered."); }
    if (altitudeTrip && !has(lower, /oxygen|acclimati|altitude sickness|ams\b/)) { s -= 1.5; n.push("No altitude-sickness precautions mentioned."); }
    score.season = s;
  }

  // ---------- Accommodation (10) ----------
  {
    let s = 7;
    const n = notes.stays;
    const orSimilar = count(lower, /or similar/g);
    const named = count(text, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Hotel|Hotels|Homestay|Home Stay|Resort|Retreat|Inn|Cottage|Nest|Camp|Villa|Regency|Residency|Lodge|Paradise|Palace|Suites|Hostel|Guest ?House|Houseboat)\b|\bHotel\s+[A-Z][a-z]+/g);
    if (named >= 3) { s += 1; n.push(`${named} named properties listed.`); }
    else if (named === 0) { s -= 3; n.push("No hotel names given."); recs.push("Ask for the confirmed hotel names and booking confirmations before paying the balance."); }
    if (orSimilar >= 2) {
      s -= 1.5;
      n.push(`Hotels are 'or similar' in ${orSimilar} places - the actual property isn't guaranteed.`);
      recs.push(`Get the final hotel names in writing, and agree what counts as 'similar' (category, location${cold ? ", heating" : ""}).`);
    }
    if (has(lower, /\b[3-5]\s*(?:\*|star)|deluxe|premium|luxury|boutique|superior room/)) { s += 1; n.push("Hotel category/star rating is stated."); }
    else { s -= 1; n.push("No star rating or room category stated."); }
    if (has(lower, /homestay|home stay/) && cold) n.push("Includes homestays - authentic, but basic in sub-zero weather.");
    if (has(lower, /twin|double|triple|quad|sharing/)) n.push("Room-sharing basis is specified.");
    else { s -= 0.5; recs.push("Confirm room sharing (twin/double/triple) - it changes the real price."); }
    score.stays = s;
  }

  // ---------- Experiences (10) ----------
  {
    let s = 6;
    const n = notes.experiences;
    const highlightLines = text.match(/(?:day )?highlights[^\n]*/gi) ?? [];
    const highlightItems = highlightLines.join(" ").replace(/(?:day )?highlights/gi, "").split(/\s{2,}|,|·|•|\|/).filter((x) => x.trim().length > 3).length;
    const sights = new Set([...known, ...visited]).size;
    if (sights >= 10 || highlightItems >= 15) { s += 2.5; n.push(`Covers a wide range of sights (${Math.max(sights, highlightItems)}+ places/highlights).`); }
    else if (sights >= 5) { s += 1; n.push(`Covers ${sights} named places.`); }
    else n.push("Few specific sights named.");
    if (has(lower, /monaster|temple|church|cathedral|mosque|fort|palace|museum|heritage|castle|old town|ruins/)) { s += 0.5; n.push("Includes culture and heritage stops."); }
    if (has(lower, /dhaba|local (food|cuisine|market|village)|homestay|cooking|village walk|market|street food|food tour|wine tasting/)) { s += 1; n.push("Some local food/village experiences."); }
    if (has(lower, /\b(trek|hike|rafting|safari|paragliding|snorkell?ing|scuba|diving|camel ride|kayaking|skiing|zip ?line|canyoning|bungee|surfing)\b/)) { s += 0.5; n.push("Includes adventure activities."); }
    const tp = count(lower, /time permitting|on your own|optional/g);
    if (tp >= 2) { s -= 1; n.push(`${tp} items are optional, 'on your own' or 'time permitting'.`); }
    if (has(lower, /sightseeing/) && has(lower, /entry fees?[^\n]*(not included|excluded)|exclusions[\s\S]{0,400}entry fee/)) n.push("Entry fees for sights are extra.");
    score.experiences = s;
  }

  // ---------- Inclusions & exclusions (10) ----------
  {
    let s = 6;
    const n = notes.inclusions;
    const INC_RE = /inclusions?|what'?s included|(?:package|price|tour|cost) includes|(?:^|\.)\s*includes\b/m;
    const EXC_RE = /exclusions?|not included|(?:package|price|tour|cost) excludes|(?:^|\.)\s*excludes\b/m;
    const hasInc = has(lower, INC_RE);
    const hasExc = has(lower, EXC_RE);
    if (hasInc && hasExc) { s += 2; n.push("Separate inclusions and exclusions lists."); }
    else { s -= 3; flag("medium", "Inclusions/exclusions not clearly listed", "Without both lists it's hard to know what you'll pay for on the ground."); }
    const mealsCount = [...text.matchAll(/(\d{1,2})\s*meals/gi)].sort((a, b) => b[1] - a[1])[0];
    if (mealsCount || has(lower, /\b(map|cp|ap|map plan|cp plan|half board|full board|all[- ]inclusive|bed (?:and|&) breakfast)\b|breakfast\s*(?:&|and|,)\s*dinner|all meals|daily breakfast/)) { s += 1; n.push(mealsCount ? `Meal count stated (${mealsCount[1]} meals).` : "Meal plan stated."); }
    else { s -= 1; recs.push("Ask exactly which meals are included each day."); }
    const excStart = lower.search(EXC_RE);
    const incStart = lower.search(INC_RE);
    const excl = excStart >= 0 ? lower.slice(excStart) : "";
    const incl = incStart >= 0 ? lower.slice(incStart, excStart > incStart ? excStart : undefined) : "";
    if (has(incl, /toll|parking|driver allowance|state tax/)) { s += 0.5; n.push("Tolls, parking and driver allowances included."); }
    if (has(lower, /permit/)) { s += 0.5; n.push("Permits are addressed."); }
    if (/heater|heating/.test(excl) && cold) {
      s -= 1.5;
      flag("high", "Room heaters cost extra in sub-zero weather", `Heating is excluded and paid to the host. In winter it isn't optional, so expect ${price?.currency === "₹" || !price ? "roughly ₹300-800" : "a surcharge"} per room per night on top of the package price.`);
      recs.push("Ask for heater charges to be included, or get the per-night rate in writing.");
    }
    if (/4\s*x\s*4|snow[- ]?chain/.test(excl)) {
      s -= 1.5;
      flag("high", "4x4 / snow-chained vehicle is extra", "If it snows, a 4x4 or snow-chained vehicle is needed and it is excluded. That's a large, open-ended surcharge exactly when the trip is most likely to need it.");
      recs.push("Get a written cap on the 4x4/snow-chain surcharge, or ask for it to be included.");
    }
    const payLocal = [...new Set((excl.match(/resort fee|city tax|tourism (?:fee|dirham|tax)|green tax|national park fee|park fee|port tax|surcharge|supplement|payable (?:directly|locally|on spot|at the hotel)|tips|gratuit\w*/g) ?? []))];
    if (payLocal.length >= 2) {
      s -= 0.5;
      n.push(`Several charges are payable locally (${payLocal.slice(0, 4).join(", ")}).`);
      recs.push("Ask for an estimate of all charges payable locally so you know the real total.");
    }
    if (/entry fee|monument|ticket/.test(excl)) n.push("Entry fees and tickets are excluded.");
    if (count(lower, /anything not (specifically )?mentioned|not mentioned in inclusions/g)) n.push("A catch-all 'anything not mentioned' exclusion is present.");
    if (international && /air ?fare|flights?|airline tickets/.test(excl)) n.push("International flights are not included in the price.");
    if (international && !has(lower, /visa/)) recs.push("Visa isn't mentioned - check the visa requirements and who arranges it.");
    if (/insurance/.test(excl) || !has(lower, /insurance/)) {
      recs.push(altitudeTrip
        ? "Buy travel insurance that covers high-altitude travel and emergency evacuation."
        : "Buy travel insurance that covers medical emergencies and trip cancellation.");
    }
    score.inclusions = s;
  }

  // ---------- Value for money (10) ----------
  {
    let s = 6;
    const n = notes.value;
    const nights = duration?.nights ?? (totalDays ? totalDays - 1 : null);
    const fmt = (v, cur) => `${cur}${v.toLocaleString(cur === "₹" ? "en-IN" : "en-US")}`;
    if (!price) { s -= 2; recs.push("Ask for a per-person price with taxes, in writing."); n.push("No clear per-person price found."); }
    else if (nights) {
      const perNight = Math.round(price.amount / nights);
      const inrPerNight = price.inr / nights;
      n.push(`${fmt(price.amount, price.currency)} per person ≈ ${fmt(perNight, price.currency)} per night.`);
      // Bands in ₹ per person per night; international trips cost more for the same standard.
      const [low, fair, mid] = international ? [3000, 9000, 18000] : [1500, 4000, 8000];
      if (inrPerNight < low) { s -= 1; n.push("Very low per-night price - check stay quality and what's really included."); }
      else if (inrPerNight <= fair) { s += 2; n.push("Competitive price for stays, meals and transport."); }
      else if (inrPerNight <= mid) { s += 1; n.push("Mid-range price."); }
      else n.push("Premium pricing - make sure hotel quality matches.");
      if (overnightJourneys) n.push(`Part of the price buys ${overnightJourneys} night(s) in transit, not hotel nights.`);
    }
    if (has(lower, /(gst|vat|tax(es)?) (included|inclusive)|inclusive of (gst|vat|all taxes|taxes)|including (all )?taxes|incl\.? (gst|taxes)/)) { s += 1; n.push("Taxes are included in the price."); }
    else if (price) { s -= 1; recs.push("Confirm whether taxes (GST/VAT) are included in the quoted price."); }
    const extras = flags.filter((f) => f.severity === "high" && /extra|cost/.test(f.title.toLowerCase())).length;
    if (extras) { s -= extras; n.push(`${extras} significant cost(s) sit outside the package price.`); }
    score.value = s;
  }

  // ---------- Policies (5) ----------
  {
    let s = 3;
    const n = notes.policies;
    if (has(lower, /cancell?ation/)) { s += 1; n.push("Cancellation policy is written down."); }
    else { s -= 2; flag("medium", "No cancellation policy", "There's no written refund/cancellation terms."); recs.push("Get the cancellation and refund policy in writing before paying."); }
    const fromBooking = text.match(/(\d{1,3})\s*%[^\n]*(?:once|as soon as|at the time of|upon)[^\n]*book/i);
    if (fromBooking) { s -= 1; n.push(`${fromBooking[1]}% is lost as soon as you book - even if you cancel months ahead.`); }
    const noRefund = text.match(/no refund[^\n]*?(\d{1,2})\s*days/i);
    if (noRefund && +noRefund[1] >= 15) { s -= 0.5; n.push(`No refund within ${noRefund[1]} days of departure.`); }
    const liability = count(lower, /extra bill will be raised|not (be )?responsible|no refund is applicable|at (your|guest'?s|client'?s) own (cost|expense)|borne by (the )?(guest|client|traveller)/g);
    if (liability >= 3) {
      s -= 1;
      flag("medium", "Costs from weather and delays fall on you", `The terms say extra hotel, transport and meal costs from weather, delays or roadblocks will be billed to travellers.${mountainous ? " That's a real risk on mountain routes." : ""}`);
    }
    if (has(lower, /balance[^\n]*\d+\s*days before|remaining amount[^\n]*\d+\s*days before/)) n.push("Clear payment schedule.");
    score.policies = s;
  }

  // ---------- Accuracy & consistency (5) ----------
  {
    let s = 4;
    const n = notes.accuracy;
    if (duration && duration.days !== duration.nights + 1) { s -= 1; flag("low", "Days/nights don't add up", `The document says ${duration.days}D/${duration.nights}N.`); }
    if (duration && maxLabelled > duration.days) { s -= 1; flag("low", "Day plan longer than the stated duration", `The day-wise plan runs to Day ${maxLabelled}, but the trip is ${duration.days} days.`); }
    const stayNights = [...text.matchAll(/\b0?(\d)\s*nights?\s+(?:in\s+|at\s+)?(?!days?\b)([A-Z][a-z]+)/g)].reduce((a, m) => a + +m[1], 0);
    if (duration && stayNights && stayNights + overnightJourneys === duration.nights) { s += 0.5; n.push(`Hotel nights (${stayNights}) + journey nights (${overnightJourneys}) match ${duration.nights}N.`); }
    // A big vehicle promised up front but a small car in the fine print for small groups.
    const BIG = ["tempo traveller", "coach", "mini bus", "minibus", "traveller"];
    const SMALL = ["innova", "crysta", "ertiga", "sedan", "xylo", "bolero", "suv", "car"];
    const big = BIG.find((v) => lower.includes(v));
    const small = SMALL.filter((v) => new RegExp(`\\b${v}\\b`).test(lower));
    const threshold = +(lower.match(/(?:less than|below|under|fewer than|up ?to)\s*(\d{1,2})\s*(?:pax|people|guests|travell?ers|persons|members)/)?.[1] ?? 10);
    if (big && small.length && travellers && travellers < threshold) {
      s -= 1.5;
      const an = (w) => (/^[aeiou]/i.test(w) ? `an ${cap(w)}` : `a ${cap(w)}`);
      flag("medium", "Vehicle promised doesn't match group size", `The document mentions ${an(big)}, but also ${an(small[0])}${small.slice(1).map((v) => ` or ${cap(v)}`).join("")} for smaller groups. With ${travellers} travellers you'll likely get the smaller vehicle.`);
      recs.push(`Confirm the exact vehicle in writing - ${an(small[0])} with luggage on the roof is very different from ${an(big)}.`);
    }
    // Largest "N meals" is the package total (smaller ones are often OCR'd meal icons).
    const mealsStated = [...text.matchAll(/(\d{1,2})\s*meals/gi)].sort((a, b) => b[1] - a[1])[0];
    const mealLines = (text.match(/meals\s*:\s*[^\n]*/gi) ?? []).filter((l) => !/from day|to day/i.test(l));
    const counted = mealLines.reduce((a, l) => a + count(l.toLowerCase(), /breakfast|lunch|dinner/g), 0);
    if (mealsStated && counted) {
      if (+mealsStated[1] === counted) { s += 0.5; n.push(`Meal count (${counted}) matches the day-wise plan.`); }
      else { s -= 1; flag("low", "Meal count mismatch", `Inclusions say ${mealsStated[1]} meals, but the day-wise plan lists ${counted}.`); }
    }
    if (has(lower, /photos? (are )?for reference|images? (are )?for (reference|illustration)/)) n.push("Photos are 'for reference' only.");
    if (has(lower, /group departure/) && travellers && travellers < 6) n.push(`Called a 'group departure' with ${travellers} travellers - check if others join.`);
    score.accuracy = s;
  }

  // ---------- Strengths from positives ----------
  if (Object.keys(dayMap).length >= (totalDays || 1) * 0.6) strengths.push("Clear day-by-day plan with named places for each day.");
  if (has(lower, /exclusions?|not included/) && has(lower, /inclusions?|what'?s included/)) strengths.push("Separate, detailed inclusions and exclusions lists.");
  if (has(lower, /trip (coordinator|leader)|tour (manager|leader)/)) strengths.push("A trip coordinator travels with the group.");
  if (has(lower, /toll|parking|driver allowance/) && has(lower, /permit/)) strengths.push("Tolls, parking, driver allowances and permits are included.");
  if (notes.value.includes("Taxes are included in the price.")) strengths.push("Price is quoted inclusive of taxes.");
  if (has(lower, /things to carry|packing list|what to pack/)) strengths.push("Comes with a packing list for the season.");
  if (notes.accuracy.some((x) => x.includes("matches"))) strengths.push("Meal and night counts are internally consistent.");

  const categories = RUBRIC.map((r) => ({
    key: r.key,
    name: r.name,
    max: r.max,
    score: clamp(score[r.key], r.max),
    reasoning: notes[r.key].join(" ") || "Nothing notable found.",
  }));
  const total = Math.round(categories.reduce((a, c) => a + c.score, 0));
  flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const high = flags.filter((f) => f.severity === "high");
  const band = total >= 80 ? "Strong itinerary" : total >= 70 ? "Good plan with a few gaps" : total >= 60 ? "Workable, but read the fine print" : "Risky plan - needs changes";
  const verdict = high.length ? `${band}: watch out for ${high[0].title.toLowerCase()}.` : `${band}.`;
  const destination = topPlaces.join(", ");
  const summary = [
    `This ${duration ? `${duration.days}-day ` : ""}itinerary${destination ? ` covers ${destination}` : ""}${start ? ` starting ${start.raw}` : ""}.`,
    heavyDays ? `${heavyDays} of ${totalDays} days involve heavy travel${overnightJourneys ? `, including ${overnightJourneys} overnight journey(s)` : ""}.` : "",
    high.length ? `The biggest concerns: ${high.map((f) => f.title.toLowerCase()).join("; ")}.` : flags.length ? `Main concern: ${flags[0].title.toLowerCase()}.` : "No major red flags found.",
    strengths.length ? `On the plus side: ${strengths[0].charAt(0).toLowerCase()}${strengths[0].slice(1)}` : "",
  ].filter(Boolean).join(" ");

  return {
    is_itinerary: isItinerary,
    engine: "Rule-based engine (offline)",
    score: total,
    verdict,
    summary,
    trip: {
      title: destination ? `${destination} trip` : "Travel itinerary",
      destination,
      duration: duration ? `${duration.days} days / ${duration.nights} nights` : totalDays ? `${totalDays} days` : "",
      travel_dates: start?.raw ?? "",
      travellers: travellers ? `${travellers}` : "",
      price: price ? `${price.currency}${price.amount.toLocaleString(price.currency === "₹" ? "en-IN" : "en-US")} per person` : "",
      operator: operator ? cap(operator) : "",
    },
    categories,
    red_flags: flags,
    strengths: [...new Set(strengths)],
    recommendations: [...new Set(recs)],
    days,
  };
}
