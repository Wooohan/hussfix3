import { CarrierData, User } from '../types';

// === MOCK DATA GENERATION ===
const FIRST_NAMES = ['Logistics', 'Freight', 'Transport', 'Carrier', 'Hauling', 'Shipping', 'Express', 'Roadway'];
const LAST_NAMES = ['Solutions', 'LLC', 'Inc', 'Group', 'Systems', 'Lines', 'Brothers', 'Global'];
const CITIES = ['Chicago', 'Dallas', 'Atlanta', 'Los Angeles', 'Miami', 'New York'];
const STATES = ['IL', 'TX', 'GA', 'CA', 'FL', 'NY'];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

export const generateMockCarrier = (mcNumber: string, isBroker: boolean): CarrierData => {
  const name1 = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const name2 = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const companyName = Math.random() > 0.3 ? `${name1} ${name2}` : `${name1} Services`;
  const city = CITIES[randomInt(0, CITIES.length - 1)];
  const state = STATES[randomInt(0, STATES.length - 1)];
  return {
    mcNumber,
    dotNumber: (parseInt(mcNumber) + 1000000).toString(),
    legalName: companyName,
    dbaName: Math.random() > 0.7 ? `${companyName} DBA` : '',
    entityType: isBroker ? 'BROKER' : 'CARRIER',
    status: Math.random() > 0.1 ? 'AUTHORIZED FOR Property' : 'NOT AUTHORIZED',
    email: `contact@${companyName.toLowerCase().replace(/\s/g, '')}.com`,
    phone: `(${randomInt(200, 900)}) ${randomInt(100, 999)}-${randomInt(1000, 9999)}`,
    powerUnits: isBroker ? '0' : randomInt(1, 50).toString(),
    drivers: isBroker ? '0' : randomInt(1, 60).toString(),
    physicalAddress: `${randomInt(100, 9999)} Main St, ${city}, ${state}`,
    mailingAddress: `${randomInt(100, 9999)} PO Box, ${city}, ${state}`,
    dateScraped: new Date().toLocaleDateString(),
    mcs150Date: '01/01/2023',
    mcs150Mileage: '100000',
    operationClassification: ['Auth. For Hire'],
    carrierOperation: ['Interstate'],
    cargoCarried: ['General Freight'],
    outOfServiceDate: '',
    stateCarrierId: '',
    dunsNumber: '',
    safetyRating: Math.random() > 0.2 ? 'SATISFACTORY' : (Math.random() > 0.5 ? 'UNSATISFACTORY' : 'NONE'),
    safetyRatingDate: '05/12/2022',
    basicScores: [
      { category: 'Unsafe Driving', measure: `${randomInt(0, 100)}%` },
      { category: 'HOS Compliance', measure: `${randomInt(0, 100)}%` },
      { category: 'Vehicle Maintenance', measure: `${randomInt(0, 100)}%` },
      { category: 'Driver Fitness', measure: `${randomInt(0, 100)}%` }
    ],
    oosRates: [
      { type: 'Vehicle', oosPercent: `${randomInt(5, 25)}%`, nationalAvg: '21.4%' },
      { type: 'Driver', oosPercent: `${randomInt(1, 10)}%`, nationalAvg: '5.5%' },
      { type: 'Hazmat', oosPercent: '0%', nationalAvg: '4.5%' }
    ]
  };
};

// === MOCK USERS ===
export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin User', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise', dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: '192.168.1.1', isOnline: true },
  { id: '2', name: 'John Doe', email: 'john@logistics.com', role: 'user', plan: 'Pro', dailyLimit: 5000, recordsExtractedToday: 1240, lastActive: '5m ago', ipAddress: '45.22.19.112', isOnline: true },
  { id: '3', name: 'Sarah Smith', email: 'sarah@shipping.net', role: 'user', plan: 'Starter', dailyLimit: 1000, recordsExtractedToday: 980, lastActive: '2h ago', ipAddress: '67.11.90.221', isOnline: false },
  { id: '4', name: 'Mike Ross', email: 'mike@ross.com', role: 'user', plan: 'Pro', dailyLimit: 5000, recordsExtractedToday: 42, lastActive: 'Now', ipAddress: '98.12.33.11', isOnline: true }
];

// ============================================================
// UTILITIES
// ============================================================

const cfDecodeEmail = (encoded: string): string => {
  try {
    let email = '';
    const r = parseInt(encoded.substr(0, 2), 16);
    for (let n = 2; n < encoded.length; n += 2)
      email += String.fromCharCode(parseInt(encoded.substr(n, 2), 16) ^ r);
    return email;
  } catch { return ''; }
};

const getTextWithSpaces = (element: Element | null): string => {
  if (!element) return '';
  let text = '';
  element.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.nodeValue || '').trim() + ' ';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag !== 'script' && tag !== 'style')
        text += getTextWithSpaces(node as Element);
    }
  });
  return text.replace(/\s+/g, ' ').trim();
};

// Fetch with proxy fallback.
// 1. Tries direct first (works with CORS extension + VPN).
// 2. If that fails (mixed-content block: HTTPS page -> HTTP target), falls back to proxies.
const fetchUrl = async (url: string): Promise<string | null> => {
  // Direct attempt
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) return text;
    }
  } catch { /* fall through */ }

  // Proxy fallback (handles HTTPS->HTTP mixed content and CORS blocks)
  const proxies = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  for (const makeProxy of proxies) {
    try {
      const proxyUrl = makeProxy(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;
      if (proxyUrl.includes('/get?')) {
        const data = await res.json();
        if (data?.contents && data.contents.length > 100) return data.contents;
      } else {
        const text = await res.text();
        if (text && text.length > 100) return text;
      }
    } catch { /* try next */ }
  }

  return null;
};

const findMarkedLabels = (doc: Document, summary: string): string[] => {
  const table = doc.querySelector(`table[summary="${summary}"]`);
  if (!table) return [];
  const labels: string[] = [];
  table.querySelectorAll('td').forEach(cell => {
    if (cell.textContent?.trim() === 'X') {
      const next = cell.nextElementSibling;
      if (next) labels.push(next.textContent?.trim() || '');
    }
  });
  return labels;
};

// ============================================================
// REQUEST 2: SMS Overview page — replaces BOTH old sub-requests
//
// Old code:  3 requests per MC
//   1. safer.fmcsa.dot.gov           → name, address, status
//   2. ai.fmcsa.dot.gov/SMS/CarrierRegistration.aspx  → email only
//   3. ai.fmcsa.dot.gov/SMS/CompleteProfile.aspx       → safety + OOS + BASIC
//
// New code:  2 requests per MC
//   1. safer.fmcsa.dot.gov           → name, address, status
//   2. ai.fmcsa.dot.gov/SMS/Overview.aspx → email + safety rating + OOS rates
//
// The Overview page contains all of #2 and #3's data in one load.
// BASIC numeric scores are NOT on Overview (only icons) — they remain N/A
// unless you re-add CompleteProfile, which is an optional 3rd call.
// ============================================================

const scrapeOverviewPage = async (dotNumber: string): Promise<{
  email: string;
  safetyRating: string;
  safetyRatingDate: string;
  basicScores: { category: string; measure: string }[];
  oosRates: { type: string; oosPercent: string; nationalAvg: string }[];
} | null> => {
  if (!dotNumber) return null;

  const html = await fetchUrl(`https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/Overview.aspx`);
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── EMAIL ──
  let email = '';
  const readEmailEl = (el: Element | null): string => {
    if (!el) return '';
    if (el.hasAttribute('data-cfemail')) return cfDecodeEmail(el.getAttribute('data-cfemail')!);
    const cf = el.querySelector('[data-cfemail]');
    if (cf) return cfDecodeEmail(cf.getAttribute('data-cfemail')!);
    const t = el.textContent?.trim() || '';
    return t.toLowerCase().includes('email protected') ? '' : t;
  };

  for (const label of Array.from(doc.querySelectorAll('label'))) {
    if (!label.textContent?.includes('Email:')) continue;
    const v = readEmailEl(label.nextElementSibling);
    if (v) { email = v; break; }
    let node: ChildNode | null = label.nextSibling;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const v2 = readEmailEl(node as Element);
        if (v2) { email = v2; break; }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const v2 = node.textContent?.trim() || '';
        if (v2.length > 2 && !v2.toLowerCase().includes('email protected')) { email = v2; break; }
      }
      node = node.nextSibling;
    }
    if (email) break;
  }
  email = email.replace(/Â|\[|\]/g, '').trim();
  if (email.toLowerCase().includes('email protected')) email = '';

  // ── SAFETY RATING ──
  // On the Overview page the rating text ("Not Rated", "SATISFACTORY", etc.)
  // appears directly after the "Safety Rating & OOS Rates" h3.
  let safetyRating = 'Not Rated';
  let safetyRatingDate = '';

  const ratingEl = doc.getElementById('Rating') ?? doc.querySelector('.ratingValue');
  if (ratingEl) {
    safetyRating = ratingEl.textContent?.trim().split(/Rating Date/i)[0].trim() || 'Not Rated';
  } else {
    // Fallback: scan headings for "Safety Rating" and read the next text block
    const headings = Array.from(doc.querySelectorAll('h2, h3, h4'));
    for (const h of headings) {
      if (h.textContent?.includes('Safety Rating')) {
        let sib: Element | null = h.nextElementSibling;
        while (sib) {
          const t = sib.textContent?.trim() || '';
          // Skip the date line and OOS table header
          if (t && t.length > 2 && !t.includes('As of') && !t.includes('Out of Service') && !t.includes('OOS')) {
            safetyRating = t.split('\n')[0].trim();
            break;
          }
          sib = sib.nextElementSibling;
        }
        break;
      }
    }
  }

  const ratingDateEl = doc.getElementById('RatingDate');
  if (ratingDateEl) {
    safetyRatingDate = ratingDateEl.textContent
      ?.replace('Rating Date:', '').replace(/[()]/g, '').trim() || '';
  }

  // ── OOS RATES ──
  // Identified by having "OOS %" or "National Avg %" column headers
  const oosRates: { type: string; oosPercent: string; nationalAvg: string }[] = [];
  doc.querySelectorAll('table').forEach(table => {
    const headerText = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim() || '').join(' ');
    if (!headerText.includes('OOS') && !headerText.includes('National')) return;
    table.querySelectorAll('tr').forEach(row => {
      const cols = row.querySelectorAll('td');
      if (cols.length >= 2) {
        const type = cols[0].textContent?.trim() || '';
        if (type && type !== 'Type') {
          oosRates.push({
            type,
            oosPercent: cols[1].textContent?.trim() || '',
            nationalAvg: cols[2]?.textContent?.trim() || ''
          });
        }
      }
    });
  });

  // BASIC scores are icon-only on Overview — numeric values need CompleteProfile.
  // Returning empty here keeps things fast. Re-add CompleteProfile call if needed.
  const basicScores: { category: string; measure: string }[] = [];

  return { email, safetyRating, safetyRatingDate, basicScores, oosRates };
};

// ============================================================
// MAIN SCRAPER
// Now only 2 HTTP requests per MC (was 3).
// ============================================================

export const scrapeRealCarrier = async (
  mcNumber: string,
  _useProxy: boolean  // kept for API compatibility; direct fetch only
): Promise<CarrierData | null> => {

  // ── REQUEST 1: SAFER snapshot ──
  const html = await fetchUrl(
    `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`
  );
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.querySelector('center')) return null;

  // Crawl date
  let crawlDate = new Date().toLocaleDateString('en-US');
  doc.querySelectorAll('b').forEach(b => {
    const m = (b.textContent || '').match(/as of(.*?)\./);
    if (m?.[1]) crawlDate = m[1].trim().split('.')[0].trim();
  });

  // Entity type & status
  let entityType = '';
  let status = '';
  doc.querySelectorAll('th').forEach(th => {
    const h = th.textContent?.trim() || '';
    if (h === 'Entity Type:')
      entityType = th.nextElementSibling?.textContent?.trim() || '';
    if (h === 'Operating Authority Status:')
      status = th.nextElementSibling?.textContent?.trim() || '';
  });
  status = status.replace(/(\*Please Note|Please Note|For Licensing)[\s\S]*/i, '').replace(/\s+/g, ' ').trim();

  const information = getTextWithSpaces(doc.querySelector('center'));

  const extract = (startLabel: string, stopLabels: string[]): string => {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${esc(startLabel)}\\s*([\\s\\S]*?)(?:${stopLabels.map(esc).join('|')})`, 'i');
    return information.match(pattern)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  };

  const legalName        = extract('Legal Name:',              ['DBA Name:', 'Physical Address:']);
  const dbaName          = extract('DBA Name:',                ['Physical Address:']);
  const physicalAddress  = extract('Physical Address:',        ['Phone:']);
  const phone            = extract('Phone:',                   ['Mailing Address:']);
  const mailingAddress   = extract('Mailing Address:',         ['USDOT Number:']);
  const dotNumber        = extract('USDOT Number:',            ['State Carrier ID Number:']);
  const stateCarrierId   = extract('State Carrier ID Number:', ['MC/MX/FF Number']);
  const powerUnits       = extract('Power Units:',             ['Non-CMV Units:', 'Drivers:']);
  // Drivers comes AFTER Power Units and before MCS-150 Form Date in the page
  const drivers          = extract('Drivers:',                 ['MCS-150 Form Date:', 'Operation Classification:']);
  const mcs150Date       = extract('MCS-150 Form Date:',       ['MCS-150 Mileage']);
  // Mileage value is just the number — stop at OPERATING AUTHORITY or Out of Service block
  // The raw text looks like: "MCS-150 Mileage / VMT 20,000 (2025) OPERATING AUTHORITY"
  // so we extract only up to the next ALL-CAPS section header or known label
  const mcs150MileageRaw = extract('MCS-150 Mileage',         ['OPERATING AUTHORITY', 'Out of Service Date:', 'Operation Classification:']);
  // Strip any label prefix like "/ VMT" and keep just "20,000 (2025)"
  const mcs150Mileage    = mcs150MileageRaw.replace(/^[\s/VMT(Year):\s]*/i, '').trim();
  const outOfServiceDate = extract('Out of Service Date:',     ['Legal Name:']);
  const dunsNumber       = extract('DUNS Number:',             ['Power Units:']);

  const operationClassification = findMarkedLabels(doc, 'Operation Classification');
  const carrierOperation        = findMarkedLabels(doc, 'Carrier Operation');
  const cargoCarried            = findMarkedLabels(doc, 'Cargo Carried');

  // ── REQUEST 2: SMS Overview (email + safety rating + OOS) ──
  let email = '';
  let safetyRating = 'Not Rated';
  let safetyRatingDate = '';
  let basicScores: { category: string; measure: string }[] = [];
  let oosRates: { type: string; oosPercent: string; nationalAvg: string }[] = [];

  if (dotNumber) {
    const overview = await scrapeOverviewPage(dotNumber);
    if (overview) {
      email            = overview.email;
      safetyRating     = overview.safetyRating;
      safetyRatingDate = overview.safetyRatingDate;
      basicScores      = overview.basicScores;
      oosRates         = overview.oosRates;
    }
  }

  return {
    mcNumber, dotNumber, legalName, dbaName, entityType, status, email, phone,
    powerUnits, drivers, physicalAddress, mailingAddress, dateScraped: crawlDate,
    mcs150Date, mcs150Mileage, operationClassification, carrierOperation, cargoCarried,
    outOfServiceDate, stateCarrierId, dunsNumber, safetyRating, safetyRatingDate,
    basicScores, oosRates
  };
};

// ============================================================
// CSV EXPORT
// ============================================================

export const downloadCSV = (data: CarrierData[]) => {
  const headers = [
    'Date', 'MC', 'Email', 'Entity Type', 'Operating Authority Status', 'Out of Service Date',
    'Legal_Name', 'DBA Name', 'Physical Address', 'Phone', 'Mailing Address', 'USDOT Number',
    'State Carrier ID Number', 'Power Units', 'Drivers', 'DUNS Number',
    'MCS-150 Form Date', 'MCS-150 Mileage (Year)', 'Operation Classification',
    'Carrier Operation', 'Cargo Carried', 'Safety Rating', 'Rating Date',
    'BASIC Scores', 'OOS Rates'
  ];
  const esc = (val?: string | number) => val ? `"${String(val).replace(/"/g, '""')}"` : '""';
  const csvRows = data.map(row => [
    esc(row.dateScraped), row.mcNumber, esc(row.email), esc(row.entityType),
    esc(row.status), esc(row.outOfServiceDate), esc(row.legalName), esc(row.dbaName),
    esc(row.physicalAddress), esc(row.phone), esc(row.mailingAddress), esc(row.dotNumber),
    esc(row.stateCarrierId), esc(row.powerUnits), esc(row.drivers), esc(row.dunsNumber),
    esc(row.mcs150Date), esc(row.mcs150Mileage),
    esc(row.operationClassification.join(', ')), esc(row.carrierOperation.join(', ')),
    esc(row.cargoCarried.join(', ')), esc(row.safetyRating), esc(row.safetyRatingDate),
    esc(row.basicScores?.map(s => `${s.category}: ${s.measure}`).join(' | ')),
    esc(row.oosRates?.map(r => `${r.type}: ${r.oosPercent} (Avg: ${r.nationalAvg})`).join(' | '))
  ]);
  const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  link.download = `fmcsa_export_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
