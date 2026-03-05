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
  if (targetTh && targetTh.nextElementSibling) {
    const nextTd = targetTh.nextElementSibling;
    if (nextTd instanceof HTMLElement) return cleanText(nextTd.innerText);
    return cleanText(nextTd.textContent);
  }
  return '';
};

// === NETWORK LAYER WITH PROXY & LATENCY ===

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<{ html: string, latency: number } | null> => {
  const startTime = performance.now();
  
  // Your Specific Proxy Credentials
  const proxyAuth = btoa("ublgpuwb:2odgwm27cgt5");
  
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        ...(useProxy && {
          'Authorization': `Basic ${proxyAuth}`,
          'X-Proxy-Host': '23.95.150.145',
          'X-Proxy-Port': '6114'
        }),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });

    const latency = Math.round(performance.now() - startTime);

    if (response.ok) {
      const html = await response.text();
      return { html, latency };
    }
    
    // Fallback logic for browser-side CORS bypass if direct fails
    const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    const fallbackRes = await fetch(fallbackUrl);
    const fallbackHtml = await fallbackRes.text();
    return { html: fallbackHtml, latency: Math.round(performance.now() - startTime) };
    
  } catch (error) {
    console.error("Fetch Error:", error);
    return null;
  }
};

// === SCRAPER LOGIC ===

export const fetchSafetyData = async (dot: string): Promise<{ 
  rating: string, 
  ratingDate: string, 
  basicScores: BasicScore[], 
  oosRates: OosRate[],
  latency: number
}> => {
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`;
  const result = await fetchUrl(url, true);
  
  if (!result || !result.html) {
    return { rating: 'N/A', ratingDate: 'N/A', basicScores: [], oosRates: [], latency: 0 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.html, 'text/html');

  const ratingEl = doc.getElementById('Rating');
  const rating = ratingEl ? cleanText(ratingEl.textContent) : 'N/A';
  
  const ratingDateEl = doc.getElementById('RatingDate');
  const ratingDate = ratingDateEl 
    ? cleanText(ratingDateEl.textContent).replace('Rating Date:', '').replace('(', '').replace(')', '') 
    : 'N/A';

  const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
  const basicScores: BasicScore[] = [];
  const sumDataRow = doc.querySelector('tr.sumData');
  
  if (sumDataRow) {
    const cells = Array.from(sumDataRow.querySelectorAll('td'));
    cells.forEach((cell, i) => {
      const valSpan = cell.querySelector('span.val');
      const val = valSpan ? cleanText(valSpan.textContent) : cleanText(cell.textContent);
      if (categories[i]) basicScores.push({ category: categories[i], measure: val || '0.00' });
    });
  }

  const oosRates: OosRate[] = [];
  const safetyDiv = doc.getElementById('SafetyRating');
  const oosTable = safetyDiv?.querySelector('table');
  if (oosTable) {
    const rows = Array.from(oosTable.querySelectorAll('tbody tr'));
    rows.forEach(row => {
      const cols = Array.from(row.querySelectorAll('th, td'));
      if (cols.length >= 3) {
        oosRates.push({
          type: cleanText(cols[0].textContent),
          rate: cleanText(cols[1].textContent),
          nationalAvg: cleanText(cols[2].textContent)
        });
      }
    });
  }

  return { rating, ratingDate, basicScores, oosRates, latency: result.latency };
};

const fetchCarrierEmailFromSMS = async (dotNumber: string, useProxy: boolean): Promise<string> => {
  if (!dotNumber || dotNumber === 'UNKNOWN') return '';
  const smsUrl = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CarrierRegistration.aspx`;
  const result = await fetchUrl(smsUrl, useProxy);
  if (!result || !result.html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.html, 'text/html');
  const labels = doc.querySelectorAll('label');
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].textContent?.includes('Email:')) {
      const parent = labels[i].parentElement;
      if (parent) {
        const cfEmail = parent.querySelector('[data-cfemail]');
        if (cfEmail) return cfDecodeEmail(cfEmail.getAttribute('data-cfemail') || '');
        const text = cleanText(parent.textContent?.replace('Email:', ''));
        if (text && text.includes('@')) return text;
      }
    }
  }
  return '';
};

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const result = await fetchUrl(url, useProxy);
  
  if (!result || !result.html || result.html.includes('Please try again later')) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.html, 'text/html');
  if (!doc.querySelector('center')) return null;

  const getVal = (label: string) => findValueByLabel(doc, label);

  const findMarked = (summary: string) => {
    const table = doc.querySelector(`table[summary="${summary}"]`);
    if (!table) return [];
    const res: string[] = [];
    table.querySelectorAll('td').forEach(cell => {
      if (cell.textContent?.trim() === 'X') {
        const next = cell.nextElementSibling;
        if (next) res.push(cleanText(next.textContent));
      }
    });
    return res;
  };

  const carrier: CarrierData = {
    mcNumber,
    dotNumber: getVal('USDOT Number:'),
    legalName: getVal('Legal Name:'),
    dbaName: getVal('DBA Name:'),
    entityType: getVal('Entity Type:'),
    status: getVal('Operating Authority Status:'),
    email: '', 
    phone: getVal('Phone:'),
    powerUnits: getVal('Power Units:'),
    drivers: getVal('Drivers:'),
    physicalAddress: getVal('Physical Address:'),
    mailingAddress: getVal('Mailing Address:'),
    dateScraped: new Date().toLocaleDateString('en-US'),
    mcs150Date: getVal('MCS-150 Form Date:'),
    mcs150Mileage: getVal('MCS-150 Mileage (Year):'),
    operationClassification: findMarked("Operation Classification"),
    carrierOperation: findMarked("Carrier Operation"),
    cargoCarried: findMarked("Cargo Carried"),
    outOfServiceDate: getVal('Out of Service Date:'),
    stateCarrierId: getVal('State Carrier ID Number:'),
    dunsNumber: getVal('DUNS Number:'),
    safetyRating: 'N/A',
    ratingDate: 'N/A'
  };

  if (carrier.dotNumber && carrier.dotNumber !== '') {
    try {
      const [email, safety] = await Promise.all([
        fetchCarrierEmailFromSMS(carrier.dotNumber, useProxy),
        fetchSafetyData(carrier.dotNumber)
      ]);
      carrier.email = email;
      carrier.safetyRating = safety.rating;
      carrier.ratingDate = safety.ratingDate;
      carrier.basicScores = safety.basicScores;
      carrier.oosRates = safety.oosRates;
      // You can store safety.latency in a log if needed
    } catch (e) {
      console.error("Enrichment failed");
    }
  }

  return carrier;
};

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const url = `https://searchcarriers.com/company/${dot}/insurances`;
  const result = await fetchUrl(url, true); 

  const extractedPolicies: InsurancePolicy[] = [];
  const rawData = result?.html ? JSON.parse(result.html) : [];
  
  if (Array.isArray(rawData)) {
    rawData.forEach((p: any) => {
      extractedPolicies.push({
        dot,
        carrier: (p.name_company || 'NOT SPECIFIED').toString().toUpperCase(),
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

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['MC', 'DOT', 'Legal Name', 'Safety Rating', 'Email', 'Phone', 'Status', 'Physical Address', 'MCS-150 Date'];
  const csvRows = data.map(row => [
    row.mcNumber,
    row.dotNumber,
    `"${row.legalName.replace(/"/g, '""')}"`,
    row.safetyRating || 'N/A',
    row.email,
    row.phone,
    `"${row.status.replace(/"/g, '""')}"`,
    `"${row.physicalAddress.replace(/"/g, '""')}"`,
    row.mcs150Date
  ]);
  const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `carriers_export_${Date.now()}.csv`;
  link.click();
};

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin User', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise', dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: '192.168.1.1', isOnline: true, isBlocked: false }
];

export const BLOCKED_IPS: BlockedIP[] = [];

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
  safetyRating: 'Satisfactory',
  ratingDate: '01/01/2024'
});
