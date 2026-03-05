import { CarrierData, User, InsurancePolicy, BasicScore, OosRate, EquinoxData } from '../types';
import { fetchCarrierFromBackend, fetchSafetyFromBackend, fetchInsuranceFromBackend } from './backendService';

// === HELPER FUNCTIONS ===

const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\u00a0/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
};

/** Decodes Cloudflare-protected emails [cite: 142, 143] */
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

/** Extracts text while preserving spaces between elements to prevent address mangling [cite: 146, 147] */
const getTextWithSpaces = (element: Element | null): string => {
  if (!element) return '';
  let text = '';
  element.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) text += (node.nodeValue || '').trim() + ' ';
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = (node as Element).tagName.toLowerCase();
      if (tagName !== 'script' && tagName !== 'style') text += getTextWithSpaces(node as Element);
    }
  });
  return text.replace(/\s+/g, ' ').trim();
};

// === NETWORK LAYER ===

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<string | null> => {
  if (!useProxy) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return await response.text(); [cite: 149]
    } catch (error) { return null; }
  }

  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, [cite: 151]
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, [cite: 151]
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` [cite: 151]
  ];

  for (const generateProxyUrl of proxyGenerators) {
    try {
      const proxyUrl = generateProxyUrl(targetUrl); [cite: 152]
      const response = await fetch(proxyUrl); [cite: 153]
      if (!response.ok) continue;
      
      if (proxyUrl.includes('api.allorigins.win/get')) {
        const data = await response.json(); [cite: 154]
        if (data.contents) return data.contents; [cite: 155]
      } else {
        const text = await response.text(); [cite: 155]
        if (text && text.length > 0) return text; [cite: 156]
      }
    } catch (error) {}
  }
  return null;
};

// === CORE SCRAPER LOGIC ===

/** Fetches Detailed Safety and BASIC Scores [cite: 174, 188] */
export const fetchSafetyData = async (dot: string, useProxy: boolean = true) => {
  const backendResult = await fetchSafetyFromBackend(dot);
  if (backendResult) return backendResult;

  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`; [cite: 174]
  const html = await fetchUrl(url, useProxy);
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Basic Scores [cite: 176, 177]
  const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
  const basicScores: BasicScore[] = [];
  const measureRow = doc.querySelector('tr.sumData');
  
  if (measureRow) {
    measureRow.querySelectorAll('td').forEach((cell, i) => {
      if (i < categories.length) {
        const val = cell.querySelector('span.val')?.textContent?.trim() || cell.textContent?.trim();
        basicScores.push({ category: categories[i], measure: val || 'N/A' }); [cite: 179]
      }
    });
  }

  // OOS Rates [cite: 183, 184]
  const oosRates: OosRate[] = [];
  const oosTable = doc.getElementById('SafetyRating')?.querySelector('table');
  if (oosTable) {
    oosTable.querySelectorAll('tr').forEach(row => {
      const cols = row.querySelectorAll('th, td');
      if (cols.length >= 3 && cols[0].textContent?.trim() !== 'Type') {
        oosRates.push({
          type: cols[0].textContent?.trim() || '', [cite: 186]
          oosPercent: cols[1].textContent?.trim() || '', [cite: 186]
          nationalAvg: cols[2].textContent?.trim() || '' [cite: 187]
        });
      }
    });
  }

  return {
    safetyRating: doc.getElementById('Rating')?.textContent?.trim() || "N/A", [cite: 181]
    safetyRatingDate: doc.getElementById('RatingDate')?.textContent?.trim().replace(/Rating Date:|\(|\)/g, '').trim() || "N/A", [cite: 182, 183]
    basicScores,
    oosRates
  };
};

/** Main Scraper Logic: Integrated Parallel Fetching [cite: 189, 204] */
export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const backendResult = await fetchCarrierFromBackend(mcNumber);
  if (backendResult) return backendResult;

  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`; [cite: 189]
  const html = await fetchUrl(url, useProxy);
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const center = doc.querySelector('center');
  if (!center) return null; [cite: 191]

  const info = getTextWithSpaces(center); [cite: 193]
  const extract = (pattern: RegExp): string => {
    const match = info.match(pattern);
    return match && match[1] ? match[1].trim() : ''; [cite: 197]
  };

  const dotNumber = extract(/USDOT Number:(.*?)State Carrier ID Number/); [cite: 198]
  
  // PARALLEL EXECUTION: Get email and safety metrics at once [cite: 204]
  const [safetyRes, emailRes] = await Promise.all([
    dotNumber ? fetchSafetyData(dotNumber, useProxy) : null,
    dotNumber ? findDotEmail(dotNumber, useProxy) : ''
  ]);

  return {
    mcNumber,
    dotNumber,
    legalName: extract(/Legal Name:(.*?)DBA/), [cite: 197]
    dbaName: extract(/DBA Name:(.*?)Physical Address/), [cite: 197]
    entityType: extract(/Entity Type:(.*?)Operating/), [cite: 194, 199]
    status: extract(/Operating Authority Status:(.*?)Out of Service/).replace(/(\*Please Note)[\s\S]*/i, '').trim(), [cite: 194, 195]
    email: emailRes.replace(/Â|\[|\]/g, '').trim(), [cite: 205]
    phone: extract(/Phone:(.*?)Mailing Address/), [cite: 198]
    powerUnits: extract(/Power Units:(.*?)Drivers/), [cite: 199]
    drivers: extract(/Drivers:(.*?)MCS-150 Form Date/), [cite: 199]
    physicalAddress: extract(/Physical Address:(.*?)Phone/), [cite: 197]
    mailingAddress: extract(/Mailing Address:(.*?)USDOT/), [cite: 198]
    dateScraped: new Date().toLocaleDateString(), [cite: 191]
    mcs150Date: extract(/MCS-150 Form Date:(.*?)MCS/), [cite: 200]
    mcs150Mileage: extract(/MCS-150 Mileage \(Year\):(.*?)(?:Operation Classification|$)/).replace('Operation Classification:', '').trim(), [cite: 200]
    operationClassification: [], 
    carrierOperation: [],
    cargoCarried: [],
    outOfServiceDate: extract(/Out of Service Date:(.*?)Legal Name/), [cite: 201]
    stateCarrierId: extract(/State Carrier ID Number:(.*?)MC\/MX\/FF Number/), [cite: 199]
    dunsNumber: extract(/DUNS Number:(.*?)Power Units/), [cite: 201]
    safetyRating: safetyRes?.safetyRating || 'N/A', [cite: 206]
    safetyRatingDate: safetyRes?.safetyRatingDate || 'N/A', [cite: 206]
    basicScores: safetyRes?.basicScores || [], [cite: 207]
    oosRates: safetyRes?.oosRates || [] [cite: 207]
  };
};

/** Advanced Email Extraction from DOT Registration [cite: 159, 160] */
const findDotEmail = async (dotNumber: string, useProxy: boolean): Promise<string> => {
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CarrierRegistration.aspx`; [cite: 160]
  const html = await fetchUrl(url, useProxy);
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const labels = Array.from(doc.querySelectorAll('label'));
  
  for (const label of labels) {
    if (label.textContent?.includes('Email:')) { [cite: 161]
      const sibling = label.nextElementSibling;
      if (sibling) {
        const cf = sibling.getAttribute('data-cfemail') || sibling.querySelector('[data-cfemail]')?.getAttribute('data-cfemail'); [cite: 162, 163]
        if (cf) return cfDecodeEmail(cf); [cite: 164]
        const text = sibling.textContent?.trim();
        if (text && !text.toLowerCase().includes('email protected')) return text; [cite: 166]
      }
    }
  }
  return '';
};

// === EXPORT LOGIC ===

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['Date', 'MC', 'DOT', 'Legal Name', 'Email', 'Phone', 'Status', 'Safety Rating', 'BASIC Scores']; [cite: 209]
  const escape = (val: any) => `"${String(val || '').replace(/"/g, '""')}"`; [cite: 211]

  const csvRows = data.map(row => [
    escape(row.dateScraped),
    row.mcNumber,
    row.dotNumber,
    escape(row.legalName),
    escape(row.email),
    escape(row.phone),
    escape(row.status),
    escape(row.safetyRating),
    escape(row.basicScores?.map(s => `${s.category}: ${s.measure}`).join(' | ')) [cite: 212]
  ]);

  const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n'); [cite: 213]
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); [cite: 214]
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fmcsa_export_${new Date().toISOString().slice(0,10)}.csv`; [cite: 215]
  link.click();
};
