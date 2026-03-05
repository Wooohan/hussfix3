

import { CarrierData, User } from '../types';

// === MOCK DATA GENERATION (Fallback/Demo) ===
const FIRST_NAMES = ['Logistics', 'Freight', 'Transport', 'Carrier', 'Hauling', 'Shipping', 'Express', 'Roadway'];
const LAST_NAMES = ['Solutions', 'LLC', 'Inc', 'Group', 'Systems', 'Lines', 'Brothers', 'Global'];
const CITIES = ['Chicago', 'Dallas', 'Atlanta', 'Los Angeles', 'Miami', 'New York'];
const STATES = ['IL', 'TX', 'GA', 'CA', 'FL', 'NY'];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

export const generateMockCarrier = (mcNumber: string, isBroker: boolean): CarrierData => {
  const isCompany = Math.random() > 0.3;
  const name1 = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const name2 = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const companyName = isCompany ? `${name1} ${name2}` : `${name1} Services`;
  const city = CITIES[randomInt(0, CITIES.length - 1)];
  const state = STATES[randomInt(0, STATES.length - 1)];

  return {
    mcNumber: mcNumber,
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

// === ADMIN / USER MOCK DATA ===.

export const MOCK_USERS: User[] = [
  {
    id: '1',
    name: 'Admin User',
    email: 'wooohan3@gmail.com',
    role: 'admin',
    plan: 'Enterprise',
    dailyLimit: 100000,
    recordsExtractedToday: 450,
    lastActive: 'Now',
    ipAddress: '192.168.1.1',
    isOnline: true
  },
  {
    id: '2',
    name: 'John Doe',
    email: 'john@logistics.com',
    role: 'user',
    plan: 'Pro',
    dailyLimit: 5000,
    recordsExtractedToday: 1240,
    lastActive: '5m ago',
    ipAddress: '45.22.19.112',
    isOnline: true
  },
  {
    id: '3',
    name: 'Sarah Smith',
    email: 'sarah@shipping.net',
    role: 'user',
    plan: 'Starter',
    dailyLimit: 1000,
    recordsExtractedToday: 980,
    lastActive: '2h ago',
    ipAddress: '67.11.90.221',
    isOnline: false
  },
  {
    id: '4',
    name: 'Mike Ross',
    email: 'mike@ross.com',
    role: 'user',
    plan: 'Pro',
    dailyLimit: 5000,
    recordsExtractedToday: 42,
    lastActive: 'Now',
    ipAddress: '98.12.33.11',
    isOnline: true
  }
];

// === REAL SCRAPER IMPLEMENTATION ===

const cfDecodeEmail = (encoded: string): string => {
  try {
    let email = "";
    const r = parseInt(encoded.substr(0, 2), 16);
    for (let n = 2; n < encoded.length; n += 2) {
      const c = parseInt(encoded.substr(n, 2), 16) ^ r;
      email += String.fromCharCode(c);
    }
    return email;
  } catch (e) {
    console.error("Error decoding CF email", e);
    return "";
  }
};

const getTextWithSpaces = (element: Element | null): string => {
  if (!element) return '';
  let text = '';
  element.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.nodeValue || '').trim() + ' ';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = (node as Element).tagName.toLowerCase();
      if (tagName !== 'script' && tagName !== 'style') {
        text += getTextWithSpaces(node as Element);
      }
    }
  });
  return text.replace(/\s+/g, ' ').trim();
};

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<string | null> => {
  if (!useProxy) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      console.warn("Direct fetch failed (likely CORS). Switching to fallback if available.", error);
      return null;
    }
  }

  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
  ];

  for (const generateProxyUrl of proxyGenerators) {
    try {
      const proxyUrl = generateProxyUrl(targetUrl);
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        continue;
      }

      if (proxyUrl.includes('api.allorigins.win/get')) {
        const data = await response.json();
        if (data.contents) return data.contents;
      } else {
        const text = await response.text();
        if (text && text.length > 0) return text;
      }
    } catch (error) {
    }
  }
  return null;
};

const findMarkedLabels = (doc: Document, summary: string): string[] => {
  const table = doc.querySelector(`table[summary="${summary}"]`);
  if (!table) return [];
  
  const labels: string[] = [];
  const cells = table.querySelectorAll('td');
  cells.forEach(cell => {
    if (cell.textContent?.trim() === 'X') {
      const nextSibling = cell.nextElementSibling;
      if (nextSibling) {
        labels.push(nextSibling.textContent?.trim() || '');
      }
    }
  });
  return labels;
};

const findDotEmail = async (dotNumber: string, useProxy: boolean): Promise<string> => {
  if (!dotNumber) return '';
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CarrierRegistration.aspx`;
  const html = await fetchUrl(url, useProxy);
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const labels = doc.querySelectorAll('label');
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].textContent?.includes('Email:')) {
      
      let elementSibling = labels[i].nextElementSibling;
      if (elementSibling) {
        if (elementSibling.hasAttribute('data-cfemail')) {
           return cfDecodeEmail(elementSibling.getAttribute('data-cfemail') || '');
        }
        const cfChild = elementSibling.querySelector('[data-cfemail]');
        if (cfChild) {
           return cfDecodeEmail(cfChild.getAttribute('data-cfemail') || '');
        }
        const text = elementSibling.textContent?.trim();
        if (text && text.length > 2 && !text.toLowerCase().includes('email protected')) {
            return text;
        }
      }

      let next = labels[i].nextSibling;
      while (next && (next.nodeType !== Node.TEXT_NODE && next.nodeType !== Node.ELEMENT_NODE)) {
          next = next.nextSibling;
      }

      if (next) {
         if (next.nodeType === Node.ELEMENT_NODE) {
            const el = next as Element;
             if (el.hasAttribute('data-cfemail')) return cfDecodeEmail(el.getAttribute('data-cfemail') || '');
             const nested = el.querySelector('[data-cfemail]');
             if (nested) return cfDecodeEmail(nested.getAttribute('data-cfemail') || '');
             
             if (el.textContent?.trim() && !el.textContent.toLowerCase().includes('email protected')) return el.textContent.trim();
         } else if (next.nodeType === Node.TEXT_NODE) {
            const val = next.textContent?.trim();
            if (val && val.length > 2 && !val.toLowerCase().includes('email protected')) return val;
         }
      }
    }
  }
  return '';
};

const scrapeFmcsaComplete = async (dotNumber: string, useProxy: boolean) => {
  if (!dotNumber) return null;
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CompleteProfile.aspx`;
  const html = await fetchUrl(url, useProxy);
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // --- PART 1: BASIC SCORES ---
  const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", 
                    "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
  const basicScores: { category: string; measure: string }[] = [];
  const measureRow = doc.querySelector('tr.sumData');
  if (measureRow) {
    const cells = measureRow.querySelectorAll('td');
    cells.forEach((cell, i) => {
      if (i < categories.length) {
        const valSpan = cell.querySelector('span.val');
        const val = valSpan ? valSpan.textContent?.trim() : cell.textContent?.trim();
        basicScores.push({ category: categories[i], measure: val || 'N/A' });
      }
    });
  }

  // --- PART 2: SAFETY RATING ---
  const ratingDiv = doc.getElementById('Rating');
  const safetyRating = ratingDiv ? ratingDiv.textContent?.trim() : "N/A";

  const ratingDateDiv = doc.getElementById('RatingDate');
  let safetyRatingDate = "N/A";
  if (ratingDateDiv) {
    safetyRatingDate = ratingDateDiv.textContent?.trim()
      .replace('Rating Date:', '')
      .replace('(', '')
      .replace(')', '')
      .trim() || "N/A";
  }

  // --- PART 3: OOS RATES ---
  const oosRates: { type: string; oosPercent: string; nationalAvg: string }[] = [];
  const safetyDiv = doc.getElementById('SafetyRating');
  const oosTable = safetyDiv ? safetyDiv.querySelector('table') : null;
  if (oosTable) {
    const rows = oosTable.querySelectorAll('tr');
    rows.forEach(row => {
      const cols = row.querySelectorAll('th, td');
      if (cols.length >= 3) {
        const type = cols[0].textContent?.trim() || '';
        if (type && type !== 'Type') { // Skip header
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

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const html = await fetchUrl(url, useProxy);
  
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const center = doc.querySelector('center');
  
  if (!center) return null;

  let crawlDate = new Date().toLocaleDateString('en-US');
  const boldTags = doc.querySelectorAll('b');
  boldTags.forEach(b => {
    const text = b.textContent || '';
    if (text.includes('The information below reflects the content')) {
      const match = text.match(/as of(.*?)\./);
      if (match && match[1]) {
        let rawDate = match[1].trim();
        if (rawDate.length > 15) rawDate = rawDate.split('.')[0];
        crawlDate = rawDate.trim();
      }
    }
  });

  const information = getTextWithSpaces(center);

  let entityType = '';
  let status = '';
  
  const ths = doc.querySelectorAll('th');
  ths.forEach(th => {
    const headerText = th.textContent?.trim() || '';
    if (headerText === 'Entity Type:') {
      entityType = th.nextElementSibling?.textContent?.trim() || '';
    }
    if (headerText === 'Operating Authority Status:') {
      status = th.nextElementSibling?.textContent?.trim() || '';
    }
  });

  status = status.replace(/(\*Please Note|Please Note|For Licensing)[\s\S]*/i, '').trim();
  status = status.replace(/\s+/g, ' ').trim();

  const extract = (pattern: RegExp): string => {
    const match = information.match(pattern);
    return match && match[1] ? match[1].trim() : '';
  };

  const legalName = extract(/Legal Name:(.*?)DBA/);
  const dbaName = extract(/DBA Name:(.*?)Physical Address/);
  const physicalAddress = extract(/Physical Address:(.*?)Phone/);
  const phone = extract(/Phone:(.*?)Mailing Address/);
  const mailingAddress = extract(/Mailing Address:(.*?)USDOT/);
  const dotNumber = extract(/USDOT Number:(.*?)State Carrier ID Number/);
  const stateCarrierId = extract(/State Carrier ID Number:(.*?)MC\/MX\/FF Number/);
  const powerUnits = extract(/Power Units:(.*?)Drivers/);
  const drivers = extract(/Drivers:(.*?)MCS-150 Form Date/);
  const mcs150Date = extract(/MCS-150 Form Date:(.*?)MCS/);
  const mcs150MileageRaw = extract(/MCS-150 Mileage \(Year\):(.*?)(?:Operation Classification|$)/);
  const mcs150Mileage = mcs150MileageRaw.replace('Operation Classification:', '').trim();
  const outOfServiceDate = extract(/Out of Service Date:(.*?)Legal Name/);
  const dunsNumber = extract(/DUNS Number:(.*?)Power Units/);

  const operationClassification = findMarkedLabels(doc, "Operation Classification");
  const carrierOperation = findMarkedLabels(doc, "Carrier Operation");
  const cargoCarried = findMarkedLabels(doc, "Cargo Carried");

  let email = '';
  let safetyRating = 'N/A';
  let safetyRatingDate = 'N/A';
  let basicScores: { category: string; measure: string }[] = [];
  let oosRates: { type: string; oosPercent: string; nationalAvg: string }[] = [];

  if (dotNumber) {
    // Parallel fetch for speed
    const [emailRes, smsRes] = await Promise.all([
      findDotEmail(dotNumber, useProxy),
      scrapeFmcsaComplete(dotNumber, useProxy)
    ]);

    email = emailRes.replace(/Â|\[|\]/g, '').trim();
    if (email.toLowerCase().includes('email protected')) {
        email = ''; 
    }

    if (smsRes) {
      safetyRating = smsRes.safetyRating;
      safetyRatingDate = smsRes.safetyRatingDate;
      basicScores = smsRes.basicScores;
      oosRates = smsRes.oosRates;
    }
  }

  return {
    mcNumber,
    dotNumber,
    legalName,
    dbaName,
    entityType,
    status,
    email,
    phone,
    powerUnits,
    drivers,
    physicalAddress,
    mailingAddress,
    dateScraped: crawlDate,
    mcs150Date,
    mcs150Mileage,
    operationClassification,
    carrierOperation,
    cargoCarried,
    outOfServiceDate,
    stateCarrierId,
    dunsNumber,
    safetyRating,
    safetyRatingDate,
    basicScores,
    oosRates
  };
};

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
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvRows = data.map(row => [
    escape(row.dateScraped),
    row.mcNumber,
    escape(row.email),
    escape(row.entityType),
    escape(row.status),
    escape(row.outOfServiceDate),
    escape(row.legalName), 
    escape(row.dbaName),
    escape(row.physicalAddress),
    escape(row.phone),
    escape(row.mailingAddress),
    escape(row.dotNumber),
    escape(row.stateCarrierId),
    escape(row.powerUnits),
    escape(row.drivers),
    escape(row.dunsNumber),
    escape(row.mcs150Date),
    escape(row.mcs150Mileage),
    escape(row.operationClassification.join(', ')),
    escape(row.carrierOperation.join(', ')),
    escape(row.cargoCarried.join(', ')),
    escape(row.safetyRating),
    escape(row.safetyRatingDate),
    escape(row.basicScores?.map(s => `${s.category}: ${s.measure}`).join(' | ')),
    escape(row.oosRates?.map(r => `${r.type}: ${r.oosPercent} (Avg: ${r.nationalAvg})`).join(' | '))
  ]);

  const csvContent = [
    headers.join(','),
    ...csvRows.map(r => r.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `fmcsa_export_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
