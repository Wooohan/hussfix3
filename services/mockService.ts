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

// === ADMIN / USER MOCK DATA ===
export const MOCK_USERS: User[] = [
  {
    id: '1', name: 'Admin User', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise',
    dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: '192.168.1.1', isOnline: true
  },
  {
    id: '2', name: 'John Doe', email: 'john@logistics.com', role: 'user', plan: 'Pro',
    dailyLimit: 5000, recordsExtractedToday: 1240, lastActive: '5m ago', ipAddress: '45.22.19.112', isOnline: true
  },
  {
    id: '3', name: 'Sarah Smith', email: 'sarah@shipping.net', role: 'user', plan: 'Starter',
    dailyLimit: 1000, recordsExtractedToday: 980, lastActive: '2h ago', ipAddress: '67.11.90.221', isOnline: false
  },
  {
    id: '4', name: 'Mike Ross', email: 'mike@ross.com', role: 'user', plan: 'Pro',
    dailyLimit: 5000, recordsExtractedToday: 42, lastActive: 'Now', ipAddress: '98.12.33.11', isOnline: true
  }
];

// ============================================================
// FETCH — always routes through /api/proxy (Vercel datacenter IP)
// When moving to local server: change BASE_URL to http://localhost:3001
// ============================================================
const BASE_URL = ''; // empty = same domain (Vercel). For local: 'http://localhost:3001'

const fetchFmcsa = async (
  targetUrl: string,
  retries = 2,
  delayMs = 300
): Promise<string | null> => {
  const proxyUrl = `${BASE_URL}/api/proxy?url=${encodeURIComponent(targetUrl)}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(15000)
      });

      // 4xx from FMCSA = MC doesn't exist, don't retry
      if (res.status >= 400 && res.status < 500) return null;

      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) return text;
      }
    } catch (e) {
      // Timeout or network error
    }

    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  return null;
};

// ============================================================
// HTML HELPERS
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
// EMAIL FETCHER (ai.fmcsa.dot.gov/CarrierRegistration)
// ============================================================
const findDotEmail = async (dotNumber: string): Promise<string> => {
  if (!dotNumber) return '';
  const html = await fetchFmcsa(
    `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CarrierRegistration.aspx`
  );
  if (!html) return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const labels = doc.querySelectorAll('label');

  for (let i = 0; i < labels.length; i++) {
    if (!labels[i].textContent?.includes('Email:')) continue;

    const sibling = labels[i].nextElementSibling;
    if (sibling) {
      if (sibling.hasAttribute('data-cfemail'))
        return cfDecodeEmail(sibling.getAttribute('data-cfemail')!);
      const cfChild = sibling.querySelector('[data-cfemail]');
      if (cfChild) return cfDecodeEmail(cfChild.getAttribute('data-cfemail')!);
      const txt = sibling.textContent?.trim();
      if (txt && txt.length > 4 && !txt.toLowerCase().includes('email protected')) return txt;
    }

    let next = labels[i].nextSibling;
    while (next && next.nodeType !== Node.TEXT_NODE && next.nodeType !== Node.ELEMENT_NODE)
      next = next.nextSibling;

    if (next?.nodeType === Node.ELEMENT_NODE) {
      const el = next as Element;
      if (el.hasAttribute('data-cfemail')) return cfDecodeEmail(el.getAttribute('data-cfemail')!);
      const nested = el.querySelector('[data-cfemail]');
      if (nested) return cfDecodeEmail(nested.getAttribute('data-cfemail')!);
      const val = el.textContent?.trim();
      if (val && !val.toLowerCase().includes('email protected')) return val;
    } else if (next?.nodeType === Node.TEXT_NODE) {
      const val = next.textContent?.trim();
      if (val && val.length > 4 && !val.toLowerCase().includes('email protected')) return val;
    }
  }
  return '';
};

// ============================================================
// SAFETY PROFILE FETCHER (ai.fmcsa.dot.gov/CompleteProfile)
// ============================================================
const scrapeFmcsaComplete = async (dotNumber: string) => {
  if (!dotNumber) return null;
  const html = await fetchFmcsa(
    `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CompleteProfile.aspx`
  );
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // BASIC Scores
  const categories = [
    'Unsafe Driving', 'Crash Indicator', 'HOS Compliance',
    'Vehicle Maintenance', 'Controlled Substances', 'Hazmat Compliance', 'Driver Fitness'
  ];
  const basicScores: { category: string; measure: string }[] = [];
  const measureRow = doc.querySelector('tr.sumData');
  if (measureRow) {
    measureRow.querySelectorAll('td').forEach((cell, i) => {
      if (i < categories.length) {
        const val = cell.querySelector('span.val')?.textContent?.trim()
          || cell.textContent?.trim()
          || 'N/A';
        basicScores.push({ category: categories[i], measure: val });
      }
    });
  }

  // Safety Rating
  const safetyRating = doc.getElementById('Rating')?.textContent?.trim() || 'NOT RATED';
  const safetyRatingDate = (doc.getElementById('RatingDate')?.textContent || '')
    .replace('Rating Date:', '').replace(/[()]/g, '').trim();

  // OOS Rates
  const oosRates: { type: string; oosPercent: string; nationalAvg: string }[] = [];
  const oosTable = doc.getElementById('SafetyRating')?.querySelector('table');
  if (oosTable) {
    oosTable.querySelectorAll('tr').forEach(row => {
      const cols = row.querySelectorAll('th, td');
      if (cols.length >= 3) {
        const type = cols[0].textContent?.trim() || '';
        if (type && type !== 'Type') {
          oosRates.push({
            type,
            oosPercent: cols[1].textContent?.trim() || '',
            nationalAvg: cols[2].textContent?.trim() || ''
          });
        }
      }
    });
  }

  return { safetyRating, safetyRatingDate, basicScores, oosRates };
};

// ============================================================
// MAIN SCRAPER — called by Scraper.tsx per MC
// ============================================================
export const scrapeRealCarrier = async (
  mcNumber: string,
  _useProxy: boolean  // ignored — always uses /api/proxy now
): Promise<CarrierData | null> => {

  // ── Request 1: MC Snapshot ──
  const html = await fetchFmcsa(
    `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`
  );
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const center = doc.querySelector('center');
  if (!center) return null; // 4.7kb = MC doesn't exist, totally normal

  // Crawl date
  let crawlDate = new Date().toLocaleDateString('en-US');
  doc.querySelectorAll('b').forEach(b => {
    const match = (b.textContent || '').match(/as of(.*?)\./);
    if (match?.[1]) {
      let d = match[1].trim();
      if (d.length > 15) d = d.split('.')[0];
      crawlDate = d.trim();
    }
  });

  // Entity type & status
  let entityType = '', status = '';
  doc.querySelectorAll('th').forEach(th => {
    const h = th.textContent?.trim() || '';
    if (h === 'Entity Type:') entityType = th.nextElementSibling?.textContent?.trim() || '';
    if (h === 'Operating Authority Status:') status = th.nextElementSibling?.textContent?.trim() || '';
  });
  status = status
    .replace(/(\*Please Note|Please Note|For Licensing)[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const info = getTextWithSpaces(center);
  const ex = (p: RegExp) => info.match(p)?.[1]?.trim() || '';

  const dotNumber = ex(/USDOT Number:\s*(.*?)(?:State Carrier ID Number:|$)/);

  // ── Requests 2 & 3: Email + Safety (parallel) ──
  const [email, safety] = dotNumber
    ? await Promise.all([
        findDotEmail(dotNumber),
        scrapeFmcsaComplete(dotNumber)
      ])
    : ['', null];

  const cleanEmail = email.replace(/Â|\[|\]/g, '').trim();

  return {
    mcNumber,
    dotNumber,
    legalName:   ex(/Legal Name:\s*(.*?)(?:DBA Name:|Physical Address:|$)/),
    dbaName:     ex(/DBA Name:\s*(.*?)(?:Physical Address:|$)/),
    entityType,
    status,
    email: cleanEmail.toLowerCase().includes('email protected') ? '' : cleanEmail,
    phone:       ex(/Phone:\s*(.*?)(?:Mailing Address:|$)/),
    powerUnits:  ex(/Power Units:\s*(\d+)/),
    drivers:     ex(/Drivers:\s*(\d+)/),
    physicalAddress: ex(/Physical Address:\s*(.*?)(?:Phone:|$)/),
    mailingAddress:  ex(/Mailing Address:\s*(.*?)(?:USDOT Number:|$)/),
    dateScraped: crawlDate,
    mcs150Date:    ex(/MCS-150 Form Date:\s*(.*?)(?:MCS-150 Mileage|$)/),
    mcs150Mileage: ex(/MCS-150 Mileage \(Year\):\s*(.*?)(?:Operation Classification:|$)/),
    operationClassification: findMarkedLabels(doc, 'Operation Classification'),
    carrierOperation:        findMarkedLabels(doc, 'Carrier Operation'),
    cargoCarried:            findMarkedLabels(doc, 'Cargo Carried'),
    outOfServiceDate: ex(/Out of Service Date:\s*(.*?)(?:Legal Name:|$)/),
    stateCarrierId:   ex(/State Carrier ID Number:\s*(.*?)(?:MC\/MX\/FF Number\(s\):|$)/),
    dunsNumber:       ex(/DUNS Number:\s*(.*?)(?:Power Units:|$)/),
    safetyRating:     safety?.safetyRating     || 'NOT RATED',
    safetyRatingDate: safety?.safetyRatingDate || '',
    basicScores:      safety?.basicScores      || [],
    oosRates:         safety?.oosRates         || []
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

  const escape = (val: string | number | undefined) => {
    if (!val) return '""';
    return `"${String(val).replace(/"/g, '""')}"`;
  };

  const csvRows = data.map(row => [
    escape(row.dateScraped), row.mcNumber, escape(row.email),
    escape(row.entityType), escape(row.status), escape(row.outOfServiceDate),
    escape(row.legalName), escape(row.dbaName), escape(row.physicalAddress),
    escape(row.phone), escape(row.mailingAddress), escape(row.dotNumber),
    escape(row.stateCarrierId), escape(row.powerUnits), escape(row.drivers),
    escape(row.dunsNumber), escape(row.mcs150Date), escape(row.mcs150Mileage),
    escape(row.operationClassification.join(', ')),
    escape(row.carrierOperation.join(', ')),
    escape(row.cargoCarried.join(', ')),
    escape(row.safetyRating), escape(row.safetyRatingDate),
    escape(row.basicScores?.map(s => `${s.category}: ${s.measure}`).join(' | ')),
    escape(row.oosRates?.map(r => `${r.type}: ${r.oosPercent} (Avg: ${r.nationalAvg})`).join(' | '))
  ]);

  const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fmcsa_export_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
