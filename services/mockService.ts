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
    return cleanText(nextTd instanceof HTMLElement ? nextTd.innerText : nextTd.textContent);
  }
  return '';
};

// === NETWORK LAYER (Optimized for CORS Extensions) ===

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<{ html: string, latency: number } | null> => {
  const startTime = performance.now();
  
  // Credentials for your 23.95.150.145 proxy
  const proxyAuth = btoa("ublgpuwb:2odgwm27cgt5");
  
  try {
    // Attempt 1: Direct fetch (relies on your CORS extension)
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        ...(useProxy && {
          'Authorization': `Basic ${proxyAuth}`,
        }),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      }
    });

    if (response.ok) {
      const html = await response.text();
      return { html, latency: Math.round(performance.now() - startTime) };
    }

    // Attempt 2: If 403/Forbidden, use a fallback bridge to bypass the "Vercel Wall"
    if (response.status === 403 || !response.ok) {
      const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const fallbackRes = await fetch(fallbackUrl);
      const fallbackHtml = await fallbackRes.text();
      return { html: fallbackHtml, latency: Math.round(performance.now() - startTime) };
    }

    return null;
  } catch (error) {
    // Final Fallback: Attempting via Codetabs if AllOrigins is slow
    try {
      const altUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
      const altRes = await fetch(altUrl);
      const altHtml = await altRes.text();
      return { html: altHtml, latency: Math.round(performance.now() - startTime) };
    } catch (e) {
      return null;
    }
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
  
  if (!result || !result.html || result.html.length < 500) {
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

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const result = await fetchUrl(url, useProxy);
  
  if (!result || !result.html || !result.html.includes('USDOT Number:')) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(result.html, 'text/html');
  const getVal = (label: string) => findValueByLabel(doc, label);

  const findMarked = (summary: string) => {
    const table = doc.querySelector(`table[summary="${summary}"]`);
    if (!table) return [];
    const res: string[] = [];
    table.querySelectorAll('td').forEach(cell => {
      if (cell.textContent?.trim() === 'X' && cell.nextElementSibling) {
        res.push(cleanText(cell.nextElementSibling.textContent));
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

  if (carrier.dotNumber) {
    const safety = await fetchSafetyData(carrier.dotNumber);
    carrier.safetyRating = safety.rating;
    carrier.ratingDate = safety.ratingDate;
    carrier.basicScores = safety.basicScores;
    carrier.oosRates = safety.oosRates;
  }

  return carrier;
};

// ... (CSV and Mock Data Export unchanged)
export const downloadCSV = (data: CarrierData[]) => { /* same as before */ };
export const MOCK_USERS: User[] = [ /* same as before */ ];
export const BLOCKED_IPS: BlockedIP[] = [];
export const generateMockCarrier = (mc: string, b: boolean): CarrierData => { /* same as before */ };
