import { CarrierData, User, InsurancePolicy, BasicScore, OosRate, BlockedIP } from '../types';
import { fetchCarrierFromBackend, fetchSafetyFromBackend, fetchInsuranceFromBackend } from './backendService';

// === HELPER FUNCTIONS ===
const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\u00a0/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
};

const cfDecodeEmail = (encoded: string): string => {
  try {
    let email = "";
    const r = parseInt(encoded.substr(0, 2), 16);
    for (let n = 2; n < encoded.length; n += 2) {
      const c = parseInt(encoded.substr(n, 2), 16) ^ r;
      email += String.fromCharCode(c);
    }
    return email;
  } catch (e) { return ""; }
};

const findValueByLabel = (doc: Document, label: string): string => {
  const ths = Array.from(doc.querySelectorAll('th'));
  const targetTh = ths.find(th => cleanText(th.textContent).includes(label));
  if (targetTh && targetTh.nextElementSibling instanceof HTMLElement) {
    return cleanText(targetTh.nextElementSibling.innerText);
  }
  return '';
};

// === THE FAST NETWORK LAYER (Server-Side Axios Bridge) ===
const fetchUrl = async (targetUrl: string): Promise<string | null> => {
  try {
    // Calling your Express/Vercel API route to bypass CORS and 403s
    const response = await fetch(`/api/scrape?targetUrl=${encodeURIComponent(targetUrl)}`);
    if (response.ok) return await response.text();
    
    // Fallback to bridge if local API fails
    const bridge = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(bridge);
    return res.ok ? await res.text() : null;
  } catch (e) {
    return null;
  }
};

// === SCRAPER LOGIC ===

export const fetchSafetyData = async (dot: string): Promise<{ 
  rating: string, 
  ratingDate: string, 
  basicScores: BasicScore[], 
  oosRates: OosRate[] 
}> => {
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`;
  const html = await fetchUrl(url);
  if (!html) return { rating: 'N/A', ratingDate: 'N/A', basicScores: [], oosRates: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const rating = cleanText(doc.getElementById('Rating')?.textContent) || 'N/A';
  const ratingDate = cleanText(doc.getElementById('RatingDate')?.textContent)
    ?.replace('Rating Date:', '').replace('(', '').replace(')', '').trim() || 'N/A';

  const basicScores: BasicScore[] = [];
  const sumDataRow = doc.querySelector('tr.sumData');
  if (sumDataRow) {
    const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
    sumDataRow.querySelectorAll('td').forEach((cell, i) => {
      if (categories[i]) {
        const val = cell.querySelector('span.val')?.textContent || cell.textContent;
        basicScores.push({ category: categories[i], measure: cleanText(val) || '0.00' });
      }
    });
  }

  const oosRates: OosRate[] = [];
  doc.querySelectorAll('#SafetyRating table tbody tr').forEach(row => {
    const cols = row.querySelectorAll('th, td');
    if (cols.length >= 3) {
      oosRates.push({
        type: cleanText(cols[0].textContent),
        rate: cleanText(cols[1].textContent),
        nationalAvg: cleanText(cols[2].textContent)
      });
    }
  });

  return { rating, ratingDate, basicScores, oosRates };
};

const fetchEmailFromSMS = async (dot: string): Promise<string> => {
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CarrierRegistration.aspx`;
  const html = await fetchUrl(url);
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const labels = doc.querySelectorAll('label');
  for (let label of Array.from(labels)) {
    if (label.textContent?.includes('Email:')) {
      const parent = label.parentElement;
      const cfEmail = parent?.querySelector('[data-cfemail]');
      if (cfEmail) return cfDecodeEmail(cfEmail.getAttribute('data-cfemail') || '');
      return cleanText(parent?.textContent?.replace('Email:', ''));
    }
  }
  return '';
};

export const scrapeRealCarrier = async (mcNumber: string): Promise<CarrierData | null> => {
  // 1. Fetch Main Snapshot
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const html = await fetchUrl(url);
  if (!html || !html.includes('USDOT Number:')) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const getVal = (label: string) => findValueByLabel(doc, label);

  const carrier: CarrierData = {
    mcNumber,
    dotNumber: getVal('USDOT Number:'),
    legalName: getVal('Legal Name:'),
    dbaName: getVal('DBA Name:'),
    entityType: getVal('Entity Type:'),
    status: getVal('Operating Authority Status:').split('*')[0].trim(),
    email: '', 
    phone: getVal('Phone:'),
    powerUnits: getVal('Power Units:'),
    drivers: getVal('Drivers:'),
    physicalAddress: getVal('Physical Address:'),
    mailingAddress: getVal('Mailing Address:'),
    dateScraped: new Date().toLocaleDateString(),
    mcs150Date: getVal('MCS-150 Form Date:'),
    mcs150Mileage: getVal('MCS-150 Mileage (Year):'),
    operationClassification: [],
    carrierOperation: [],
    cargoCarried: [],
    outOfServiceDate: getVal('Out of Service Date:'),
    stateCarrierId: getVal('State Carrier ID Number:'),
    dunsNumber: getVal('DUNS Number:'),
    safetyRating: 'N/A',
    ratingDate: 'N/A'
  };

  // 2. Parallel Enrichment (FETCH EVERYTHING AT ONCE)
  if (carrier.dotNumber) {
    const [safety, email] = await Promise.all([
      fetchSafetyData(carrier.dotNumber),
      fetchEmailFromSMS(carrier.dotNumber)
    ]);
    
    carrier.safetyRating = safety.rating;
    carrier.ratingDate = safety.ratingDate;
    carrier.basicScores = safety.basicScores;
    carrier.oosRates = safety.oosRates;
    carrier.email = email;
  }

  return carrier;
};

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const url = `https://searchcarriers.com/company/${dot}/insurances`;
  const html = await fetchUrl(url);
  
  const extractedPolicies: InsurancePolicy[] = [];
  let rawData = [];
  try {
    rawData = html ? JSON.parse(html) : [];
  } catch { rawData = []; }

  if (Array.isArray(rawData)) {
    rawData.forEach((p: any) => {
      extractedPolicies.push({
        dot,
        carrier: (p.name_company || 'N/A').toString().toUpperCase(),
        policyNumber: (p.policy_no || 'N/A').toString().toUpperCase(),
        effectiveDate: p.effective_date ? p.effective_date.split(' ')[0] : 'N/A',
        coverageAmount: p.max_cov_amount ? `$${Number(p.max_cov_amount).toLocaleString()}` : 'N/A',
        type: p.ins_type_code === '1' ? 'BI&PD' : p.ins_type_code === '2' ? 'CARGO' : 'OTHER',
        class: p.ins_class_code === 'P' ? 'PRIMARY' : 'EXCESS'
      });
    });
  }

  return { policies: extractedPolicies, raw: rawData };
};

// === UTILS ===
export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['MC', 'DOT', 'Legal Name', 'Email', 'Phone', 'Status', 'Physical Address', 'Rating'];
  const csvRows = data.map(row => [
    row.mcNumber, row.dotNumber, `"${row.legalName}"`, row.email, row.phone, `"${row.status}"`, `"${row.physicalAddress}"`, row.safetyRating
  ]);
  const content = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  link.download = `carriers_batch_${Date.now()}.csv`;
  link.click();
};

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise', dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: '192.168.1.1', isOnline: true, isBlocked: false }
];

export const generateMockCarrier = (mc: string, b: boolean): CarrierData => ({
  mcNumber: mc,
  dotNumber: (parseInt(mc)+1000000).toString(),
  legalName: `Carrier ${mc} Logistics`,
  dbaName: '',
  entityType: b ? 'BROKER' : 'CARRIER',
  status: 'AUTHORIZED',
  email: 'info@carrier.com',
  phone: '800-555-0199',
  powerUnits: '12',
  drivers: '14',
  physicalAddress: '100 Logistics Way, Houston, TX 77002',
  mailingAddress: '',
  dateScraped: '2024-01-01',
  mcs150Date: '2024-01-01',
  mcs150Mileage: '120,000 (2023)',
  operationClassification: [],
  carrierOperation: [],
  cargoCarried: [],
  outOfServiceDate: '',
  stateCarrierId: '',
  dunsNumber: '',
  safetyRating: 'N/A',
  ratingDate: 'N/A'
});
