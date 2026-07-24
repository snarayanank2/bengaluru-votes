const pptxgen = require("pptxgenjs");

const INK = "0E1F2B";
const INK2 = "173243";
const PAPER = "F7F5F0";
const WHITE = "FFFFFF";
const TEAL = "0B6E6E";
const TEALLT = "3D9A97";
const AMBER = "B85416";
const AMBERLT = "E8A87C";
const MUTED = "4E5F6D";
const DIM = "8FA3B3";
const RULE = "D9D3C8";

const HEAD = "Georgia";
const BODY = "Calibri";

const H = 5.625;

// ── One grid for the whole deck ────────────────────────────────
const CX = 0.62;          // left content edge
const CW = 8.74;          // content width  → right edge 9.36 (0.64" margin)
const G = 0.2;            // gutter
const C3W = 2.78, C3 = (i) => CX + i * (C3W + G);
const C2W = 4.27, C2 = (i) => CX + i * (C2W + G);
const CY = 1.56;          // content top

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Oorvani Foundation";
pres.title = "Bengaluru votes. Then what?";

const INTERNAL = process.env.INTERNAL === "1";

let pageNo = 0;

const shadow = () => ({ type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.10 });
const LIT = [4, 21, 38, 52, 68, 85, 97];

function wardGrid(slide, { x, y }) {
  const cols = 9, rows = 12, size = 0.26, gap = 0.075;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const lit = LIT.includes(i);
      slide.addShape(pres.shapes.RECTANGLE, {
        x: x + c * (size + gap), y: y + r * (size + gap), w: size, h: size,
        fill: { color: lit ? AMBER : TEALLT, transparency: lit ? 0 : 78 },
        line: { type: "none" },
      });
    }
  }
}

function darkSlide({ kicker, title, sub, titleSize = 25 }) {
  pageNo += 1;
  const s = pres.addSlide();
  s.background = { color: INK };
  wardGrid(s, { x: 6.42, y: 0.62 });
  s.addText(kicker.toUpperCase(), {
    x: 0.65, y: 0.8, w: 5.6, h: 0.28, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 11, bold: true, color: TEALLT, charSpacing: 3,
  });
  s.addText(title, {
    x: 0.65, y: 1.22, w: 5.65, h: 2.25, margin: 0, valign: "top",
    fontFace: HEAD, fontSize: titleSize, bold: true, color: WHITE, lineSpacingMultiple: 1.12,
  });
  if (sub) {
    s.addText(sub, {
      x: 0.65, y: 3.45, w: 5.6, h: 1.5, margin: 0, valign: "top",
      fontFace: BODY, fontSize: 13, color: "C3D0DA", lineSpacingMultiple: 1.28,
    });
  }
  return s;
}

function slide({ kicker, title, footnote }) {
  pageNo += 1;
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.14, h: H, fill: { color: TEAL }, line: { type: "none" } });
  s.addText(kicker.toUpperCase(), {
    x: CX, y: 0.34, w: CW, h: 0.26, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 10, bold: true, color: TEAL, charSpacing: 3,
  });
  s.addText(title, {
    x: CX, y: 0.64, w: CW, h: 0.84, margin: 0, valign: "top",
    fontFace: HEAD, fontSize: 26, bold: true, color: INK, lineSpacingMultiple: 1.06,
  });
  s.addText(String(pageNo), {
    x: 9.0, y: 5.06, w: 0.36, h: 0.24, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 9, color: MUTED, align: "right",
  });
  if (footnote) {
    s.addText(footnote, {
      x: CX, y: 5.02, w: 8.2, h: 0.3, margin: 0, valign: "top",
      fontFace: BODY, fontSize: 9, italic: true, color: MUTED,
    });
  }
  return s;
}

// One deterministic card: title and body share a single top-aligned text box,
// so they cannot collide no matter how the copy changes.
function card(s, { x, y, w, h, title, body, accent = TEAL, big }) {
  s.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: WHITE }, line: { color: RULE, width: 0.75 }, shadow: shadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.07, h, fill: { color: accent }, line: { type: "none" } });
  let cy = y + 0.17;
  if (big) {
    s.addText(big, {
      x: x + 0.26, y: cy, w: w - 0.5, h: 0.46, margin: 0, valign: "top",
      fontFace: HEAD, fontSize: 25, bold: true, color: accent,
    });
    cy += 0.52;
  }
  const runs = [];
  if (title) runs.push({ text: title, options: { bold: true, fontSize: 12, color: INK, breakLine: !!body, paraSpaceAfter: body ? 5 : 0 } });
  if (body) runs.push({ text: body, options: { fontSize: 10.5, color: MUTED } });
  if (runs.length) {
    s.addText(runs, {
      x: x + 0.26, y: cy, w: w - 0.5, h: y + h - cy - 0.14, margin: 0, valign: "top",
      fontFace: BODY, lineSpacingMultiple: 1.16,
    });
  }
}

function bullets(s, items, opts) {
  s.addText(
    items.map((t, i) => ({
      text: t,
      options: { bullet: { indent: 14 }, breakLine: i < items.length - 1, paraSpaceAfter: 7 },
    })),
    Object.assign({ fontFace: BODY, fontSize: 12, color: INK2, lineSpacingMultiple: 1.15, margin: 0, valign: "top" }, opts)
  );
}

function keyline(s, text, y, color = AMBER) {
  s.addText(text, {
    x: CX, y, w: 8.2, h: 0.4, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 11.5, bold: true, color, lineSpacingMultiple: 1.15,
  });
}

function table(s, rows, opts) {
  s.addTable(rows, Object.assign({
    fontFace: BODY, fontSize: 10.5, color: INK2,
    border: { type: "solid", pt: 0.5, color: RULE },
    fill: { color: WHITE }, valign: "middle", autoPage: false,
  }, opts));
}

const hdr = (t) => ({ text: t, options: { fill: { color: INK }, color: WHITE, bold: true, fontSize: 10.5 } });

/* ───────────── 1 · Title ───────────── */
{
  pageNo += 1;
  const s = pres.addSlide();
  s.background = { color: INK };
  wardGrid(s, { x: 6.42, y: 0.62 });
  s.addText("OORVANI FOUNDATION", {
    x: 0.65, y: 0.92, w: 5.5, h: 0.28, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 11, bold: true, color: TEALLT, charSpacing: 3,
  });
  s.addText("Bengaluru votes.\nThen what?", {
    x: 0.65, y: 1.38, w: 5.5, h: 1.8, margin: 0, valign: "top",
    fontFace: HEAD, fontSize: 38, bold: true, color: WHITE, lineSpacingMultiple: 1.06,
  });
  s.addText(
    "A ward accountability platform for India's third-largest city — built through an election, and designed to outlast it.",
    { x: 0.65, y: 3.3, w: 5.4, h: 0.9, margin: 0, valign: "top", fontFace: BODY, fontSize: 13.5, color: "C3D0DA", lineSpacingMultiple: 1.26 }
  );
  s.addShape(pres.shapes.RECTANGLE, { x: 0.65, y: 4.36, w: 2.62, h: 0.6, fill: { color: AMBER }, line: { type: "none" } });
  s.addText("₹2.30 crore · two years", {
    x: 0.65, y: 4.36, w: 2.62, h: 0.6, margin: 0,
    fontFace: BODY, fontSize: 13, bold: true, color: WHITE, align: "center", valign: "middle",
  });
  s.addText("July 2026", {
    x: 3.45, y: 4.36, w: 2.2, h: 0.6, margin: 0,
    fontFace: BODY, fontSize: 11, color: DIM, valign: "middle",
  });
}

/* ───────────── 2 · The moment ───────────── */
{
  const s = slide({ kicker: "The moment", title: "Eleven years without an elected council" });
  [
    { big: "2015", title: "Last ward election", body: "August. The only one this decade." },
    { big: "2020", title: "Council term expired", body: "10 September. No elected corporators since — the longest gap in the city's history." },
    { big: "369", title: "Wards, newly drawn", body: "Across five corporations under the Greater Bengaluru Authority." },
  ].forEach((t, i) => card(s, Object.assign({ x: C3(i), y: CY, w: C3W, h: 1.74 }, t)));

  card(s, {
    x: C2(0), y: 3.52, w: C2W, h: 1.46, accent: TEAL,
    big: "88,95,361", title: "Registered voters",
    body: "Across 8,023 polling stations. GBA final electoral roll, 18 April 2026.",
  });
  card(s, {
    x: C2(1), y: 3.52, w: C2W, h: 1.46, accent: AMBER,
    big: "31 Dec 2026", title: "Supreme Court deadline",
    body: "The third. Two earlier deadlines passed unmet, and the Chief Justice has ruled out a fourth.",
  });
}

/* ───────────── 3 · Citizen's problem ───────────── */
{
  const s = slide({ kicker: "The problem", title: "Three things stop people voting" });
  s.addText("We interviewed citizens before designing anything. People were willing to vote.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, italic: true, color: MUTED,
  });
  [
    { title: "“Which ward am I even in?”", body: "Delimitation moved every line. No accessible tool tells a resident where they landed." },
    { title: "“Who are these candidates?”", body: "Sworn affidavits are public record — sitting in scanned PDFs on a government portal, in English, indexed by nothing." },
    { title: "“Who can I actually trust?”", body: "Every accessible source on a local candidate is published by someone with a stake in the outcome." },
  ].forEach((t, i) => card(s, Object.assign({ x: C3(i), y: 2.02, w: C3W, h: 1.7 }, t)));
  s.addText(
    "The platform answers all three: a ward finder, sourced report cards built from affidavits, and side-by-side comparison — with the logistics as a checklist a first-time voter can follow end to end.",
    { x: CX, y: 3.9, w: CW, h: 0.85, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, color: INK2, lineSpacingMultiple: 1.2 }
  );
}

/* ───────────── 4 · Problem that outlasts ───────────── */
{
  const s = slide({ kicker: "The larger problem", title: "And then the loop never closes" });
  s.addText("Ask a Bengaluru resident:", {
    x: CX, y: CY + 0.17, w: C2W, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12.5, bold: true, color: INK,
  });
  bullets(s, [
    "What was your ward's budget last year?",
    "What works were sanctioned in it?",
    "Who is the engineer responsible for your road?",
    "What did your corporator actually do?",
  ], { x: CX + 0.06, y: 1.94, w: C2W - 0.1, h: 1.7 });
  s.addText(
    "Almost nobody can answer. The information mostly exists — scattered across tenders, work orders, RTI replies and portals never built to be read by residents.",
    { x: CX, y: 3.72, w: C2W, h: 1.15, margin: 0, valign: "top", fontFace: BODY, fontSize: 11.5, color: MUTED, lineSpacingMultiple: 1.2 }
  );
  card(s, {
    x: C2(1), y: CY, w: C2W, h: 2.85, accent: AMBER,
    title: "So the accountability loop never closes",
    body: "A corporator is elected on local promises, then becomes invisible for five years, because there is no place a resident can go to see what happened to the money.\n\nThe next election arrives, and the same citizen votes on the same absence of information.\n\nFixing that is the actual goal. The election is how we get the audience to show up.",
  });
}

/* ───────────── 5 · The insight ───────────── */
darkSlide({
  kicker: "The insight",
  title: "The tier of government that affects a citizen most, and interests them least — until an election.",
  titleSize: 24,
  sub: "For roughly eight weeks before a ward poll, people go looking for information about their corporator, unprompted. Attention arrives free, on a date known in advance.\n\nThat window is the cheapest acquisition in civic technology. And every Indian city has one coming.",
});

/* ───────────── 6 · Phase 1 ───────────── */
{
  const s = slide({ kicker: "Phase one · built and running", title: "The election platform" });
  s.addText("This is not a proposal for software. It is a request to operate and extend software that exists.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, italic: true, color: MUTED,
  });
  [
    ["Ward finder", "Enter an address, get your new GBA ward. All 369, with real delimitation boundaries."],
    ["Candidate report cards", "Cases, assets, education and track record, drawn from sworn EC affidavits."],
    ["Side-by-side comparison", "Same fields, same sourcing standard applied to every candidate."],
    ["Ward issue voting", "Residents pick their top three local issues. Results public, including to non-voters."],
    ["Voting logistics", "Roll check, voter ID, how to vote, booth locator — ordered as a checklist."],
    ["Bilingual throughout", "Every page in English and Kannada, each at its own shareable URL."],
  ].forEach(([t, b], i) => {
    card(s, { x: C3(i % 3), y: 2.02 + Math.floor(i / 3) * 1.52, w: C3W, h: 1.4, title: t, body: b });
  });
}

/* ───────────── 7 · Phase 2 ───────────── */
{
  const s = slide({ kicker: "Phase two · what this grant funds", title: "The ward accountability layer" });
  s.addText("The same ward page a citizen used to choose a candidate becomes the page that tracks what that candidate does.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, italic: true, color: MUTED,
  });
  [
    ["Ward budget", "Allocation, spend to date, and what it was spent on."],
    ["Works", "Projects sanctioned, under way and completed — with cost and status."],
    ["Officials", "Who is responsible for what in this ward, and how to reach them."],
    ["Community", "A link to the ward's residents' WhatsApp or community group."],
    ["Ward statistics", "Road length, population, area, civic assets."],
    ["Corporator report cards", "The candidate report card, carried forward for whoever won."],
  ].forEach(([t, b], i) => {
    card(s, { x: C3(i % 3), y: 2.02 + Math.floor(i / 3) * 1.44, w: C3W, h: 1.3, title: t, body: b, accent: AMBER });
  });
}

/* ───────────── 8 · The arc ───────────── */
{
  const s = slide({
    kicker: "The two-year arc",
    title: "Anchored to the poll, not the calendar",
  });
  table(s, [
    [hdr("Period"), hdr("Bengaluru"), hdr("Second city")],
    ["Now → E", "Election platform at full load: ward finder, report cards, issue voting, booth logistics, poll day", "—"],
    ["E → E+6", "Results. Candidate report cards become corporator report cards. Ward budget and works layer ships", "Election calendar assessed; city named by month 12"],
    ["E+6 → E+12", "Accountability layer in daily operation; first annual ward scorecards", "Newsroom briefed, curators recruited, ward data acquired"],
    ["E+12 → E+18", "Second annual cycle", "Platform live in city two, through its own election"],
    ["E+18 → E+24", "Replication playbook published", "Handover to steady-state operation"],
  ], { x: CX, y: CY, w: CW, colW: [1.35, 4.02, 3.37], rowH: 0.5 });
  keyline(s, "E is the Bengaluru poll, ordered by the Supreme Court to happen by 31 December 2026. The election phase is already under way, and it is short.", 4.68);
}

/* ───────────── 9 · What travels ───────────── */
{
  const s = slide({ kicker: "Why a second city is cheap", title: "What travels, and what does not" });
  card(s, { x: C2(0), y: CY, w: C2W, h: 3.0, accent: TEAL, title: "Travels — built once, reused" });
  bullets(s, [
    "The platform itself",
    "The ward and candidate data model",
    "The affidavit extraction pipeline",
    "The curator handbook and training",
    "The flag-and-correct workflow",
    "Audit and rollback machinery",
    "Comms templates and partner kits",
    "A Citizen Matters newsroom already there",
  ], { x: C2(0) + 0.3, y: 2.02, w: C2W - 0.55, h: 2.45, fontSize: 10.5 });

  card(s, { x: C2(1), y: CY, w: C2W, h: 3.0, accent: AMBER, title: "Does not travel — bought fresh" });
  bullets(s, [
    "Ward boundary and delimitation data",
    "Local curators",
    "Local partner organisations",
    "Translation into the local language",
    "Relationships with the local election office and municipal body",
  ], { x: C2(1) + 0.3, y: 2.02, w: C2W - 0.55, h: 2.45, fontSize: 10.5 });

  keyline(s, "Software is the expensive half, and it is already paid for. A new city costs people and data.", 4.74, INK);
}

/* ───────────── 10 · City two ───────────── */
{
  const s = slide({
    kicker: "The second city", title: "The constraint is a calendar",
    footnote: "Positions as of July 2026. Every date is an expectation, not a notified schedule.",
  });
  s.addText("Citizen Matters already runs newsrooms in Chennai, Mumbai, Delhi/NCR and Hyderabad.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 11.5, color: INK2,
  });
  table(s, [
    [hdr("City"), hdr("Wards"), hdr("Position")],
    [{ text: "Chennai (GCC)", options: { bold: true, color: TEAL } }, "200", "Term runs to March 2027; statewide Tamil Nadu local body polls expected February–March 2027."],
    ["Delhi (MCD)", "250", "Elected December 2022; next general election due 2027."],
    ["Hyderabad (GHMC)", "150 + 76 + 74", "Term expired February 2026; since split into three corporations. Delimitation under High Court challenge."],
    ["Mumbai (BMC)", "227", "Polled January 2026. Out of scope until 2031."],
  ], { x: CX, y: 2.0, w: CW, colW: [1.85, 1.3, 5.59], rowH: 0.46 });
  s.addText([
    { text: "Chennai is the strongest candidate", options: { bold: true, color: INK } },
    { text: " — its poll falls inside the grant window, its newsroom is our second-strongest, and Tamil Nadu votes statewide, so one engagement reaches well beyond one city. We name the city by month 12.", options: { color: INK2 } },
  ], { x: CX, y: 4.5, w: 8.2, h: 0.5, margin: 0, valign: "top", fontFace: BODY, fontSize: 11, lineSpacingMultiple: 1.18 });
}

/* ───────────── 11 · Why Oorvani ───────────── */
{
  const s = slide({ kicker: "Why us", title: "We have already done this, four times" });
  card(s, {
    x: C2(0), y: CY, w: C2W, h: 1.78, accent: AMBER, big: "21",
    title: "Constituencies covered in 2024",
    body: "Across Chennai, Bengaluru, Mumbai and Delhi — candidate profiles, maps, past results, booth lookup, key issues. With Mumbai Votes and Praja Foundation.",
  });
  s.addText("The GBA platform is not our first election project. It is the ward-level version of something we have already built four times, in four cities.", {
    x: CX, y: 3.66, w: C2W, h: 0.8, margin: 0, valign: "top", fontFace: BODY, fontSize: 11.5, bold: true, color: INK, lineSpacingMultiple: 1.2,
  });
  s.addText("Citizen Matters since 2008 · Oorvani Foundation since 2013 · Open City since 2016", {
    x: CX, y: 4.56, w: C2W, h: 0.5, margin: 0, valign: "top", fontFace: BODY, fontSize: 10.5, italic: true, color: MUTED, lineSpacingMultiple: 1.18,
  });

  const SW = 2.035;
  [
    ["505", "articles in FY25, across 9 cities"],
    ["3.4M", "page views on articles and data"],
    ["₹1.07cr", "total annual spend, FY 2024-25"],
    ["400+", "open datasets on Open City"],
  ].forEach(([n, l], i) => {
    const x = C2(1) + (i % 2) * (SW + G), y = CY + Math.floor(i / 2) * 1.12;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: SW, h: 1.0, fill: { color: WHITE }, line: { color: RULE, width: 0.75 } });
    s.addText(n, { x: x + 0.16, y: y + 0.13, w: SW - 0.3, h: 0.42, margin: 0, valign: "top", fontFace: HEAD, fontSize: 21, bold: true, color: TEAL });
    s.addText(l, { x: x + 0.16, y: y + 0.55, w: SW - 0.3, h: 0.4, margin: 0, valign: "top", fontFace: BODY, fontSize: 9, color: MUTED, lineSpacingMultiple: 1.1 });
  });
  card(s, {
    x: C2(1), y: 3.9, w: C2W, h: 1.1, accent: TEAL,
    title: "Already funded by",
    body: "Rohini Nilekani Philanthropies · Rainmatter Foundation · Unboxing BLR · Bengaluru Sustainability Forum",
  });
}

/* ───────────── 12 · Neutrality ───────────── */
{
  const s = slide({ kicker: "Trust", title: "Neutrality is machinery, not a promise" });
  [
    ["A source on every field", "Official affidavit data is distinguished from curator-compiled context. A reader can always reach the original document."],
    ["An immutable audit log", "Every change records who, when and from what source — and can be rolled back."],
    ["Anyone can flag anything", "Across every ward, not just their own. Submitters see whether the flag was accepted, and why."],
    ["No paid acquisition, ever", "Buying political-adjacent advertising would destroy the only asset the platform has."],
    ["Funders named publicly", "For a platform whose value is neutrality, the funding cannot be opaque."],
    ["We go dark before the poll", "No message in the final 48 hours. It costs us the highest-converting send in any campaign."],
  ].forEach(([t, b], i) => {
    card(s, { x: C2(i % 2), y: CY + Math.floor(i / 2) * 1.2, w: C2W, h: 1.02, title: t, body: b });
  });
}

/* ───────────── 13 · Distribution ───────────── */
{
  const s = slide({ kicker: "Distribution", title: "No advertising budget" });
  s.addText("Distribution runs through people who already have the audience.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, italic: true, color: MUTED,
  });
  [
    ["Apartment federations and RWAs", "The Bangalore Apartments' Federation and ADDA are existing Oorvani collaborators. The unit of distribution is a message pasted into a building's WhatsApp group."],
    ["Colleges, employers, youth orgs", "The RWA cascade misses students, paying guests and young renters entirely — the largest first-time cohort in a decade, and the least likely to be on the roll."],
    ["Press", "Journalists arrive at the Election Commission's notification, so the press kit ships months before it."],
  ].forEach(([t, b], i) => card(s, { x: C3(i), y: 2.02, w: C3W, h: 1.78, title: t, body: b }));
  card(s, {
    x: CX, y: 3.96, w: CW, h: 1.0, accent: AMBER,
    title: "Ward coverage is the operating dashboard",
    body: "Partners and registrations tracked per ward against all 369. The uncovered set is the work queue — and the early warning for the failure mode where a Bengaluru civic project quietly becomes a central-Bengaluru one.",
  });
}

/* ───────────── 14 · Targets ───────────── */
{
  const s = slide({ kicker: "What we are targeting", title: "Two numbers, because one can be gamed" });
  [
    ["300,000", "unique visitors", TEAL],
    ["25,000", "registered citizens with a home ward set", TEAL],
    ["300 of 369", "wards carrying at least 50 registrations each", AMBER],
  ].forEach(([n, l, a], i) => {
    const x = C3(i);
    s.addShape(pres.shapes.RECTANGLE, { x, y: CY, w: C3W, h: 1.55, fill: { color: WHITE }, line: { color: RULE, width: 0.75 }, shadow: shadow() });
    s.addShape(pres.shapes.RECTANGLE, { x, y: CY, w: C3W, h: 0.08, fill: { color: a }, line: { type: "none" } });
    s.addText(n, { x: x + 0.24, y: CY + 0.22, w: C3W - 0.45, h: 0.6, margin: 0, valign: "top", fontFace: HEAD, fontSize: 26, bold: true, color: a });
    s.addText(l, { x: x + 0.24, y: CY + 0.88, w: C3W - 0.45, h: 0.58, margin: 0, valign: "top", fontFace: BODY, fontSize: 11, color: MUTED, lineSpacingMultiple: 1.15 });
  });
  s.addText(
    "The registration target is deliberately two numbers. A city-wide total is satisfiable entirely out of a dozen affluent central wards — we would hit the number and have failed the mission. The breadth figure encodes what we are actually trying to do, and it is the one to look at first when the two disagree.",
    { x: CX, y: 3.34, w: CW, h: 0.95, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, color: INK2, lineSpacingMultiple: 1.22 }
  );
  s.addText(
    "Both are built bottom-up from what an unpaid partner cascade can plausibly deliver. One percent of the electorate would be about 90,000 — a better number to say out loud, and a worse one to steer by.",
    { x: CX, y: 4.4, w: CW, h: 0.6, margin: 0, valign: "top", fontFace: BODY, fontSize: 11, italic: true, color: MUTED, lineSpacingMultiple: 1.2 }
  );
}

/* ───────────── 15 · Reporting ───────────── */
{
  const s = slide({ kicker: "Accountability to you", title: "What we will report, quarterly" });
  bullets(s, [
    "Unique visitors, registrations, and registrations by ward against all 369",
    "Wards with published candidate data — and later, wards with published budget and works data",
    "Active curators, sources cited, flags raised, flags resolved, median time to resolve",
    "Partner organisations recruited, and what each one's forwarding achieved",
    "Spend against budget",
  ], { x: CX + 0.06, y: CY, w: CW - 0.1, h: 2.2, fontSize: 13 });
  card(s, {
    x: CX, y: 3.72, w: CW, h: 1.2, accent: TEAL,
    title: "Most of this is already public",
    body: "These figures publish continuously on the platform's own /data page. A platform that publishes other people's records should publish its own. Funders receive the same figures with spend attached.",
  });
}

/* ───────────── 16 · Team ───────────── */
{
  const s = slide({ kicker: "The team", title: "An organisation, not a project team" });
  card(s, {
    x: C2(0), y: CY, w: C2W, h: 1.5, accent: TEAL,
    title: "Meera K — Co-founder and Managing Trustee",
    body: "Gene Burd Award for Urban Journalism, 2025. Ashoka Fellow. Works on cities, community media, urban governance and civic technology.",
  });
  card(s, {
    x: C2(1), y: CY, w: C2W, h: 1.5, accent: TEAL,
    title: "Satarupa Bhattacharya — Programme Director",
    body: "Twenty years in editorial and content. Oversees programmes and editorial policy at Citizen Matters.",
  });
  card(s, {
    x: C2(0), y: 3.18, w: C2W, h: 1.45, accent: AMBER,
    title: "What this grant hires",
    body: "Two engineers, a half-time product and programme lead, two curator operations managers, a bilingual content editor, a partnerships lead, contract design, and honoraria for the ward curator network.",
  });
  card(s, {
    x: C2(1), y: 3.18, w: C2W, h: 1.45, accent: AMBER,
    title: "Said plainly",
    body: "Our bench is strong in journalism and urban data, thinner in software engineering — which is why engineering is the largest line in this budget. Open City is a civic-tech platform we already run.",
  });
  s.addText("Roughly fourteen people across editorial, programmes, design and operations. Trustees include Ashwin Mahesh, Meenakshi Ramesh and Vikram Rai.", {
    x: CX, y: 4.78, w: 8.2, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 10.5, italic: true, color: MUTED,
  });
}

/* ───────────── 17 · Use of funds ───────────── */
{
  const s = slide({
    kicker: "Use of funds · costed at Oorvani's consultancy rates, not market salaries",
    title: "Two years — ₹2.30 crore",
  });
  const sub = (t) => ({ text: t, options: { fill: { color: "EDE8DE" }, bold: true, fontSize: 10.5 } });
  const tot = (t) => ({ text: t, options: { fill: { color: INK }, color: WHITE, bold: true, fontSize: 10.5 } });
  table(s, [
    [hdr("Year one — the election, and the accountability foundations"), hdr("What it buys"), hdr("₹")],
    ["Engineering (2)", "Election platform, then the ward accountability layer", "24L"],
    ["Curator honoraria", "~150 curators across the active election months", "18L"],
    ["Curator operations (2)", "Recruiting, training and quality across 369 wards", "14L"],
    ["Product, editorial and design", "Bilingual product direction; every page and message in EN/KN", "16L"],
    ["Infrastructure, WhatsApp, AI, legal", "Hosting, 25,000 users × 7 messages, affidavit parsing, DPDP compliance", "19L"],
    ["Partnerships, field and ward data", "RWAs, colleges, employers, press; RTI, digitisation, geodata", "15L"],
    [sub("Year one total"), sub("The election run, and the accountability layer begun"), sub("1.06 Cr")],
    ["Year two — Bengaluru", "Accountability layer in operation; engineering tapers, data work rises", "85L"],
    ["Year two — second city", "Curators, ward data, translation, local partnerships", "39L"],
    [tot("Two-year total"), tot("Bengaluru ₹1.91 Cr · second city ₹39 L"), tot("2.30 Cr")],
  ], { x: CX, y: CY, w: CW, colW: [2.85, 4.49, 1.4], rowH: 0.28 });
}

/* ───────────── 18 · Marginal cost ───────────── */
{
  const s = slide({ kicker: "The number that makes scale credible", title: "What a second city costs" });
  const big = (x, num, label, color) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y: CY, w: C2W, h: 1.8, fill: { color: WHITE }, line: { color: RULE, width: 0.75 }, shadow: shadow() });
    s.addShape(pres.shapes.RECTANGLE, { x, y: CY, w: C2W, h: 0.09, fill: { color: color }, line: { type: "none" } });
    s.addText(num, { x: x + 0.3, y: CY + 0.32, w: C2W - 0.6, h: 0.82, margin: 0, valign: "top", fontFace: HEAD, fontSize: 40, bold: true, color });
    s.addText(label, { x: x + 0.3, y: CY + 1.2, w: C2W - 0.6, h: 0.4, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, color: MUTED });
  };
  big(C2(0), "₹1.91 cr", "Bengaluru, over two years", INK);
  big(C2(1), "₹39 lakh", "The second city", AMBER);
  s.addText(
    "To be precise: ₹39 lakh is the incremental cost of adding a city to a platform and core team already funded by this grant — not the standalone cost of running a city from zero. We state that plainly, because a number that quietly omits its shared costs is a number designed to flatter. The comparison holds anyway.",
    { x: CX, y: 3.62, w: CW, h: 0.95, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, color: INK2, lineSpacingMultiple: 1.22 }
  );
  keyline(s, "This is the argument for funding Bengaluru at full cost. The expensive city is the first one.", 4.66, INK);
}

/* ───────────── 19 · Risks ───────────── */
{
  const s = slide({ kicker: "Risks", title: "What could go wrong" });
  table(s, [
    [hdr("Risk"), hdr("What we do about it")],
    ["The election date slips again. Three court deadlines have already passed unmet.", "Our calendar is anchored to relative dates. A delay lengthens the accountability phase rather than cancelling it."],
    ["Ward budget and works data proves hard to obtain.", "Delimitation data is in hand. Budget and works data is pursued through RTI, with digitisation funded as an explicit line. Where a ward's data cannot be obtained, we publish that fact."],
    ["We are accused of partisanship.", "A source on every field, an audit log on every change, no paid advertising, funders named, and a blackout during the legal silence period."],
    ["The election audience does not stay.", "Consent to contact people about civic tools beyond this election is collected at registration, today. Corporator report cards give returning citizens a reason they already understand."],
    ["The grant doubles Oorvani's budget.", "A scoped programme with named roles and a defined end — not general expansion. Most added cost is honoraria and data, not permanent headcount."],
    ["No second city has a poll in the window.", "The constraint is a calendar, not a partnership. Those funds are ring-fenced and returned or redeployed by agreement."],
  ], { x: CX, y: 1.5, w: CW, colW: [3.4, 5.34], rowH: 0.47, fontSize: 9.5 });
}

/* ───────────── 20 · The ask ───────────── */
{
  const s = slide({ kicker: "The ask", title: "₹2.30 crore — of which ₹25 lakh cannot wait" });
  s.addText(
    "Bengaluru votes by 31 December 2026. A grant of this size takes three to six months to disburse, so most of this money will arrive at or after the election — which is the plan, because the election is the acquisition event and accountability is the product. But one part cannot wait.",
    { x: CX, y: CY, w: CW, h: 0.72, margin: 0, valign: "top", fontFace: BODY, fontSize: 11.5, color: INK2, lineSpacingMultiple: 1.2 }
  );
  card(s, {
    x: C2(0), y: 2.42, w: C2W, h: 1.98, accent: AMBER, big: "₹25 lakh",
    title: "The bridge — needed now",
    body: "Drawn forward from the total, not added to it. Curator honoraria through the election months, the comms programme at election scale including the electoral roll deadline alert, and final engineering and legal. A single donor can write this quickly.",
  });
  s.addText("The programme — ₹2.05 crore over two years", {
    x: C2(1), y: 2.42, w: C2W, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 12, bold: true, color: INK,
  });
  table(s, [
    ["Ward accountability layer", "70L"],
    ["The curator network", "55L"],
    ["Bilingual reach", "41L"],
    ["Second-city pilot", "39L"],
  ], { x: C2(1), y: 2.8, w: C2W, colW: [3.07, 1.2], rowH: 0.34 });
  s.addText("Each component stands alone, with its own price and its own outcome. We seek one lead funder and two or three co-funders.", {
    x: C2(1), y: 4.7, w: C2W, h: 0.45, margin: 0, valign: "top", fontFace: BODY, fontSize: 10, italic: true, color: MUTED, lineSpacingMultiple: 1.15,
  });
  s.addText("Beyond money: introductions to apartment federations, colleges and large employers — distribution is our binding constraint, not engineering.", {
    x: C2(0), y: 4.7, w: C2W, h: 0.45, margin: 0, valign: "top", fontFace: BODY, fontSize: 10, italic: true, color: MUTED, lineSpacingMultiple: 1.15,
  });
}

/* ───────────── 21 · Contact ───────────── */
{
  const s = darkSlide({
    kicker: "Contact",
    title: "Bengaluru is going to vote.\nThe question is what comes next.",
    titleSize: 24,
    sub: "Meera K — Co-founder and Managing Trustee, Oorvani Foundation\n\noorvani.org · citizenmatters.in · opencity.in",
  });
  if (INTERNAL) {
    s.addText("[ email · phone — MUST BE ADDED BEFORE SENDING ]", {
      x: 0.65, y: 4.55, w: 5.6, h: 0.3, margin: 0, valign: "top",
      fontFace: BODY, fontSize: 12, bold: true, color: AMBERLT,
    });
  }
  s.addText("Charitable trust BNG-BMH244/2013-14 · 12A and 80G current · CSR-1 registered", {
    x: 0.65, y: 4.95, w: 5.6, h: 0.3, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 9.5, color: DIM,
  });
}

/* ───────────── 22 · Appendix: governance ───────────── */
{
  const s = slide({ kicker: "Appendix", title: "Governance and compliance" });
  table(s, [
    [hdr("Item"), hdr("Detail")],
    ["Legal form", "Charitable trust, registered 6 August 2013 — BNG-BMH244/2013-14"],
    ["Tax exemption", "12A current (AAATO4080EE20214); 80G current (AAATO4080EF20212), renewed 23 September 2021"],
    ["CSR", "CSR-1 registered — Indian corporate CSR funding is available"],
    ["Foreign contributions", "No FCRA. International funders are out of scope for this raise."],
    ["Auditor", "P N R & Co., Chartered Accountants, Firm Regn. 002495S"],
    ["FY 2024-25", "Income ₹1,05,35,516 · Expenditure ₹1,06,58,444"],
    ["Disclosure record", "Twelve consecutive annual reports published, FY 2013-14 to FY 2024-25"],
    ["Trustees", "Meera K, Meenakshi Ramesh, Ashwin Mahesh"],
  ], { x: CX, y: CY, w: CW, colW: [2.4, 6.34], rowH: 0.36 });
}

/* ───────────── 23 · Appendix: comms ───────────── */
{
  const s = slide({ kicker: "Appendix", title: "The comms programme" });
  s.addText("Seven ward-scoped sends across the campaign, in the citizen's saved language.", {
    x: CX, y: CY, w: CW, h: 0.3, margin: 0, valign: "top", fontFace: BODY, fontSize: 11, color: INK2, lineSpacingMultiple: 1.18,
  });
  table(s, [
    [hdr("When"), hdr("Message")],
    ["On register", "Confirms ward, language, and what they will receive"],
    ["Roll close −7d", "Last date to join the electoral roll — the highest-value message we send"],
    ["Scrutiny complete", "Candidates have filed in your ward (provisional)"],
    ["E−3w", "Vote on your ward's top three issues"],
    ["E−2w", "Final candidate list; report cards complete"],
    ["E−1w", "Your ward's top issues; compare candidates; booth locator"],
    ["E−3d", "Booth, timings, ID to carry — then the campaign goes dark"],
  ], { x: CX, y: 1.96, w: CW, colW: [2.1, 6.64], rowH: 0.33 });
  keyline(s, "Missing the electoral roll deadline is the one failure in this funnel that cannot be undone.", 4.78);
}

/* ───────────── 24 · Internal (internal build only) ───────────── */
if (INTERNAL) {
  pageNo += 1;
  const s = pres.addSlide();
  s.background = { color: "3A2A1A" };
  s.addText("INTERNAL — NOT FOR CIRCULATION", {
    x: 0.65, y: 0.5, w: 8.7, h: 0.3, margin: 0, valign: "top",
    fontFace: BODY, fontSize: 11, bold: true, color: AMBERLT, charSpacing: 3,
  });
  s.addText("Before this deck goes to any donor", {
    x: 0.65, y: 0.9, w: 8.7, h: 0.6, margin: 0, valign: "top", fontFace: HEAD, fontSize: 26, bold: true, color: WHITE,
  });
  bullets(s, [
    "Confirm every rate in the budget — especially engineering, which Oorvani has not contracted before",
    "Confirm the ₹25 lakh bridge scope and amount; the sizing is not yet Oorvani's",
    "Confirm which Schedule VII head the programme is booked under — decides whether CSR money is really reachable",
    "Decide how to handle working capital: FY24 and FY25 both closed in deficit, ₹2.01 lakh in the bank at 31.03.2025",
    "Name the Oorvani staff working on this platform, and at what share of time",
    "Set year-two and second-city targets",
    "Re-check the voter figure after the SIR final roll on 7 October 2026",
    "Confirm existing funders are content to be named",
    "Add Meera K's email and phone to the contact slide",
  ], { x: 0.8, y: 1.7, w: 8.5, h: 3.4, fontSize: 12.5, color: "E4DACB" });
}

const OUT = INTERNAL
  ? "/tmp/oorvani-deck/Oorvani-GBA-Deck-INTERNAL.pptx"
  : "/tmp/oorvani-deck/Oorvani-GBA-Ward-Accountability-2026.pptx";
pres.writeFile({ fileName: OUT })
  .then((f) => console.log("WROTE", f, "· slides:", pageNo));
