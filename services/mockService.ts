

import { CarrierData, User, EquinoxData } from '../types';

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

// === EQUINOX REAL LOGIC PORT ===

const toInt = (v: any) => {
  try {
    return parseInt(v) || 0;
  } catch {
    return 0;
  }
};

const statsFromCompanyAndEquipment = (company: any, equipments: any[], inspections: any[]) => {
    // Safe access to nested properties
    const safeCompany = company || {};
    
    let trucks = toInt(safeCompany.truck_units);
    let power_units = toInt(safeCompany.power_units);
    let total_units = toInt(safeCompany.total_units) || (trucks + power_units);
    let owned_trailers = toInt(safeCompany.owned_trailers);
    let leased_trailers = toInt(safeCompany.leased_trailers);
    let cdl_drivers = toInt(safeCompany.total_cdl);
    let total_drivers = toInt(safeCompany.total_drivers) || cdl_drivers;
    let interstate = toInt(safeCompany.interstate) || (safeCompany.interstate ? 1 : 0);
    let intrastate = toInt(safeCompany.intrastate) || 0;

    // Fallback logic if company stats are missing but equipment list exists
    if (!trucks && !owned_trailers && !leased_trailers && !total_units) {
        trucks = equipments.filter(e => (e.equipment_type || '').toUpperCase().includes('TRUCK')).length;
        const trailers = equipments.filter(e => (e.equipment_type || '').toUpperCase().includes('TRAILER'));
        owned_trailers = trailers.length;
        power_units = trucks;
        total_units = trucks + owned_trailers;
        cdl_drivers = 0;
        total_drivers = 0;
    }

    return `Trucks | ${trucks} | Owned Trailers | ${owned_trailers} | Leased Trailers | ${leased_trailers} | Power Units | ${power_units} | Total Units | ${total_units} | CDL Drivers | ${cdl_drivers} | Non-CDL Drivers | ${Math.max(0, total_drivers - cdl_drivers)} | Interstate | ${interstate} | Intrastate | ${intrastate}`;
};

export const scrapeEquinoxReal = async (
  dot: string,
  auth: { xsrf: string; session: string },
  useProxy: boolean,
  onDebugLog?: (msg: string) => void
): Promise<EquinoxData> => {
  const BASE = "https://searchcarriers.com";
  
  const log = (msg: string) => {
    if (onDebugLog) onDebugLog(`[${dot}] ${msg}`);
  };

  // Helper sleep function for throttling
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Add a random start delay to reduce burstiness
  await sleep(randomInt(500, 2000));

  const headers: any = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
  };

  if (auth.xsrf) headers["X-XSRF-TOKEN"] = auth.xsrf;

  const fetchJson = async (endpoint: string) => {
    const targetUrl = `${BASE}${endpoint}`;
    // log(`Fetching ${endpoint}...`);

    if (!useProxy) {
      try {
        const directHeaders = { ...headers };
        if (auth.session && auth.xsrf) {
            (directHeaders as any)['Cookie'] = `XSRF-TOKEN=${auth.xsrf}; searchcarriers_session=${auth.session}`;
        }
        const res = await fetch(targetUrl, { headers: directHeaders });
        if (res.ok) {
            // log(`Direct fetch ${endpoint} success.`);
            return await res.json();
        } else {
            log(`Direct fetch ${endpoint} failed: ${res.status}`);
        }
      } catch (e) {
        // Fallthrough
      }
    } else {
      // Prioritize proxies that handle headers better for JSON
      const proxyGenerators = [
        { name: 'corsproxy', fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
        { name: 'codetabs', fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
        { name: 'thingproxy', fn: (url: string) => `https://thingproxy.freeboard.io/fetch/${url}` },
        { name: 'allorigins', fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` }
      ];

      for (const gen of proxyGenerators) {
        try {
          const proxyUrl = gen.fn(targetUrl);
          
          // Small delay between proxy attempts
          if (gen.name !== 'corsproxy') await sleep(500);

          const res = await fetch(proxyUrl);
          if (res.ok) {
            const text = await res.text();
            try {
                // Critical: Ensure it's JSON. Proxies often return HTML error pages with 200 OK.
                const json = JSON.parse(text);
                // Basic validation that it looks like an API response
                if (json && (json.data || json.current_page || Array.isArray(json))) {
                   // log(`Proxy ${gen.name} success for ${endpoint}`);
                   return json;
                } else {
                   log(`Proxy ${gen.name} returned JSON missing data structure.`);
                }
            } catch {
                // If it fails to parse as JSON, check for WAF keywords
                const lowerText = text.toLowerCase();
                if (lowerText.includes('cloudflare') || lowerText.includes('just a moment') || lowerText.includes('challenge') || lowerText.includes('security check')) {
                   log(`Proxy ${gen.name} [Blocked] Cloudflare/WAF detected. Try slower speed or tokens.`);
                } else {
                   const preview = text.substring(0, 50).replace(/[\n\r]+/g, ' ');
                   log(`Proxy ${gen.name} invalid JSON. Start: ${preview}...`);
                }
                continue;
            }
          } else {
             if (res.status === 403 || res.status === 503) {
                 log(`Proxy ${gen.name} [Blocked] returned status ${res.status}`);
             } else {
                 log(`Proxy ${gen.name} returned status ${res.status}`);
             }
          }
        } catch (e: any) {
           log(`Proxy ${gen.name} failed: ${e.message}`);
        }
      }
    }
    log(`Failed to fetch ${endpoint} after all attempts.`);
    return null;
  };

  // OPTIMIZED: Fetch Main Profile, Initial Data AND First Page of Equipment Parallel
  const [mainProfile, inspectionsJ, insurancesJ, authoritiesJ, eqPage1] = await Promise.all([
    fetchJson(`/company/${dot}`),
    fetchJson(`/company/${dot}/inspections?page=1&perPage=5`),
    fetchJson(`/company/${dot}/insurances`),
    fetchJson(`/company/${dot}/authorities`),
    fetchJson(`/company/${dot}/equipment?page=1&perPage=5`),
  ]);

  // OPTIMIZED: Fetch Remaining Equipment Pages in Parallel
  let allEquipment = eqPage1?.data || [];
  const lastPage = eqPage1?.meta?.last_page || 1;

  if (lastPage > 1) {
    const pagePromises = [];
    const maxPages = Math.min(lastPage, 10);
    for (let p = 2; p <= maxPages; p++) {
      pagePromises.push(fetchJson(`/company/${dot}/equipment?page=${p}&perPage=5`));
    }
    
    if (pagePromises.length > 0) {
       const pageResults = await Promise.all(pagePromises);
       pageResults.forEach(res => {
         if (res && res.data) {
           allEquipment = [...allEquipment, ...res.data];
         }
       });
    }
  }

  // --- PROCESSING LOGIC ---
  let company = "";
  let email = "";
  let phone = "";
  let officers = "";

  const officerCandidates: { value: string, score: number }[] = [];
  
  const cleanStr = (s: any) => {
      if (!s) return "";
      const str = String(s).trim();
      return (str === "null" || str === "undefined") ? "" : str;
  };

  // Helper: Deeply extract strings from an object/array
  const deepExtractStrings = (obj: any): string[] => {
      const results: string[] = [];
      const traverse = (o: any) => {
          if (!o) return;
          if (typeof o === 'string') {
              const s = o.trim();
              // Relaxed filter: Allow numbers (e.g. 3rd, or addresses inside name fields), 
              // just ensure length and no email/url to avoid junk
              if (s.length > 1 && !s.includes('@') && !s.includes('http') && s.length < 100) {
                   const lower = s.toLowerCase();
                   if (lower !== 'null' && lower !== 'undefined' && lower !== 'none' && lower !== '[]') {
                       results.push(s);
                   }
              }
              return;
          }
          if (Array.isArray(o)) {
              o.forEach(traverse);
          } else if (typeof o === 'object') {
              Object.values(o).forEach(traverse);
          }
      };
      traverse(obj);
      return results;
  };

  const parseOfficers = (raw: any, isHighConfidence = false): string => {
      if (!raw) return '';
      if (typeof raw === 'string') {
          const s = raw.trim();
          return (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s === '[]') ? '' : s;
      }
      
      // If we are sure this is the officers key, perform deep extraction
      if (isHighConfidence && typeof raw === 'object' && !Array.isArray(raw)) {
          // Sometimes it's a single object {name: 'Bob', title: 'CEO'}
          if (raw.name || raw.officer_name || raw.party_name) {
              const name = raw.name || raw.officer_name || raw.party_name;
              if (name && typeof name === 'string') return name.trim();
          }
      }

      if (isHighConfidence && typeof raw === 'object') {
          const deepNames = deepExtractStrings(raw);
          const unique = Array.from(new Set(deepNames));
          if (unique.length > 0) return unique.join(', ');
      }

      let arr: any[] = [];
      try {
        arr = Array.isArray(raw) ? raw : [raw];
      } catch {
        return '';
      }
      
      const names = arr.map((item: any) => {
          if (!item) return '';
          if (typeof item === 'string') return item.trim();
          if (typeof item === 'object') {
              const keys = ['name', 'officer_name', 'party_name', 'full_name', 'person_name', 'member_name'];
              for (const k of keys) {
                  if (item[k]) return String(item[k]).trim();
              }
              if (item.first_name || item.last_name) {
                  return `${item.first_name || ''} ${item.last_name || ''}`.trim();
              }
              const values = Object.values(item).filter(v => typeof v === 'string' && v.length > 2 && !v.includes('@') && !v.includes('http'));
              if (values.length > 0) return values.join(' ');
          }
          return '';
      }).filter(s => s && s.length > 1 && s.toLowerCase() !== 'null' && s !== '[]');
      
      return Array.from(new Set(names)).join(', ');
  };

  const sources = [mainProfile, inspectionsJ, insurancesJ, authoritiesJ];

  // 1. MIRROR COLAB LOGIC EXACTLY (Enhanced)
  const checkEndpointForOfficers = (jsonResponse: any, endpointName: string) => {
      if (!jsonResponse || !jsonResponse.data) {
          log(`Skipping ${endpointName}, no data or empty response.`);
          return;
      }
      
      // FIX: Handle data as Object OR Array
      let item: any = null;
      if (Array.isArray(jsonResponse.data)) {
          if (jsonResponse.data.length > 0) item = jsonResponse.data[0];
          else log(`${endpointName}.data is empty array`);
      } else if (typeof jsonResponse.data === 'object') {
          item = jsonResponse.data;
      } else {
          log(`${endpointName}.data is unknown type: ${typeof jsonResponse.data}`);
      }

      if (!item) return;

      // Sometimes company is nested, sometimes it is the item itself. Check both.
      // Also check 'carrier' key which sometimes appears.
      const targets = [item.company, item, item.carrier].filter(i => i && typeof i === 'object');
      
      const fields = ["company_officers", "officers", "primary_officer", "owner", "owners", "related_parties", "members", "contact"];
      
      for (const companyObj of targets) {
          // log(`Scanning object in ${endpointName} keys: ${Object.keys(companyObj).join(',')}`);
          for (const f of fields) {
              if (companyObj[f]) {
                  const val = parseOfficers(companyObj[f], true);
                  if (val && val.length > 2) {
                      log(`Found HIGH PRIORITY officer in ${endpointName}.${f}: ${val}`);
                      officerCandidates.push({ value: val, score: 9000 }); // Highest priority
                  }
              }
          }
      }
  };

  checkEndpointForOfficers(inspectionsJ, 'inspections');
  checkEndpointForOfficers(mainProfile, 'profile');
  checkEndpointForOfficers(authoritiesJ, 'authorities');

  // 2. RECURSIVE AGGRESSIVE SCAN (Fallback)
  const scanForOfficers = (obj: any, depth = 0) => {
      if (!obj || depth > 15) return;
      if (typeof obj !== 'object') return;

      // Check immediate keys first
      for (const key of Object.keys(obj)) {
          const lowerKey = key.toLowerCase();
          
          const isHighValue = lowerKey === 'company_officers' || lowerKey === 'officers' || lowerKey === 'owners' || lowerKey === 'related_parties' || lowerKey === 'relations' || lowerKey === 'primary_officer';
          const isMediumValue = lowerKey.includes('officer') || lowerKey === 'contact' || lowerKey === 'contacts' || lowerKey === 'members';

          if (isHighValue || isMediumValue) {
              // If high value, force deep extraction
              const val = parseOfficers(obj[key], isHighValue);
              if (val && val.length > 2) {
                  const score = isHighValue ? 1000 : 100;
                  log(`Recursive scan match: ${key} -> ${val}`);
                  officerCandidates.push({ value: val, score });
              }
          }
      }

      // Recurse into children
      if (Array.isArray(obj)) {
          obj.forEach(item => scanForOfficers(item, depth + 1));
      } else {
          Object.values(obj).forEach(val => {
              if (val && typeof val === 'object') {
                  scanForOfficers(val, depth + 1);
              }
          });
      }
  };
  
  // Execute scan on all sources
  sources.forEach(src => {
      if (src) scanForOfficers(src);
  });

  // 3. Find Best Company Object for other details
  const findBestCompanyObj = (responses: any[]) => {
      for (const res of responses) {
          if (!res || typeof res !== 'object') continue;
          
          if (res.legal_name || res.company_name || res.company_officers || res.phone_number) {
            return res;
          }
          if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
            if (res.data.legal_name || res.data.company_name || res.data.company_officers) return res.data;
          }
          const data = res.data;
          if (Array.isArray(data) && data.length > 0) {
              const first = data[0];
              const comp = (first.company && typeof first.company === 'object') ? first.company : first;
              if (comp && (comp.legal_name || comp.phone || comp.insp_carrier_name || comp.company_officers)) {
                  return comp;
              }
          }
      }
      return null;
  };

  const bestComp = findBestCompanyObj(sources);
  
  if (bestComp) {
      company = cleanStr(bestComp.legal_name || bestComp.insp_carrier_name || bestComp.company_name);
      email = cleanStr(bestComp.email_address || bestComp.email);
      phone = cleanStr(bestComp.phone || bestComp.phone_number);
  }

  // Resolve Officers
  officerCandidates.sort((a, b) => b.score - a.score);
  
  const bestScore = officerCandidates.length > 0 ? officerCandidates[0].score : 0;
  const topCandidates = officerCandidates.filter(c => c.score >= bestScore).map(c => c.value);
  const uniqueOfficers = Array.from(new Set(topCandidates));
  
  if (uniqueOfficers.length > 0) {
      officers = uniqueOfficers.join(', ');
      log(`Final Officer Selection: ${officers}`);
  } else {
      log(`No officers found. Candidates were: ${officerCandidates.length}`);
  }

  // Final fallback
  if (!company || !email || !phone) {
      const traverse = (obj: any) => {
          if (!obj || typeof obj !== 'object') return;
          if ((!company && obj.legal_name) || (!email && obj.email) || (!phone && obj.phone)) {
               if (!company) company = cleanStr(obj.legal_name || obj.company_name);
               if (!email) email = cleanStr(obj.email || obj.email_address);
               if (!phone) phone = cleanStr(obj.phone || obj.phone_number);
          }
          if (obj.data && Array.isArray(obj.data)) obj.data.forEach(traverse);
          if (obj.company) traverse(obj.company);
      };
      sources.forEach(traverse);
  }

  const equipmentStatus = (allEquipment.length > 0 || (bestComp?.truck_units > 0)) ? "Yes" : "No";
  const stats = statsFromCompanyAndEquipment(bestComp, allEquipment, inspectionsJ?.data || []);

  return {
    dot,
    company,
    email,
    phone,
    officers,
    equipmentStatus,
    stats
  };
};

export const scrapeEquinoxMock = async (dot: string): Promise<EquinoxData> => {
  await new Promise(r => setTimeout(r, 100));

  const name1 = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const name2 = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const companyName = `${name1} ${name2} Logistics`;
  
  const equipmentCount = randomInt(0, 15);
  const equipment = Array.from({length: equipmentCount}, () => ({
    equipment_type: Math.random() > 0.4 ? 'TRUCK TRACTOR' : 'TRAILER'
  }));

  const companyObj = {
    legal_name: companyName,
    email_address: `dispatch@${companyName.toLowerCase().replace(/\s/g, '')}.com`,
    phone: `(${randomInt(200, 900)}) ${randomInt(100, 999)}-${randomInt(1000, 9999)}`,
    company_officers: ['John Smith', 'Jane Doe'],
    truck_units: randomInt(5, 50),
    power_units: randomInt(5, 50),
    owned_trailers: randomInt(10, 100),
    leased_trailers: randomInt(0, 20),
    total_cdl: randomInt(5, 60),
    interstate: 1,
    intrastate: 0
  };

  const stats = statsFromCompanyAndEquipment(companyObj, equipment, []);
  const hasEquipment = equipmentCount > 0 || companyObj.truck_units > 0;

  return {
    dot,
    company: companyName,
    email: companyObj.email_address,
    phone: companyObj.phone,
    officers: companyObj.company_officers.join(', '),
    equipmentStatus: hasEquipment ? 'Yes' : 'No',
    stats: stats
  };
};

// === ADMIN / USER MOCK DATA ===

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
