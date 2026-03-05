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

// === NETWORK LAYER (PROXIED FETCH) ===
const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<string | any | null> => {
  // Always use our specialized API proxy if useProxy is true
  if (useProxy) {
    try {
      const response = await fetch(`/api/scrape?targetUrl=${encodeURIComponent(targetUrl)}`);
      if (response.ok) return await response.text();
    } catch (e) { console.error("Proxy fetch failed"); }
  }

  // Fallback to Public Proxies
  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const generateProxyUrl of proxyGenerators) {
    try {
      const response = await fetch(generateProxyUrl(targetUrl));
      if (response.ok) return await response.text();
    } catch (error) {}
  }
  return null;
};

// === SCRAPER LOGIC ===

export const fetchSafetyData = async (dot: string): Promise<{ 
  rating: string, 
  ratingDate: string, 
  basicScores: BasicScore[], 
  oosRates: OosRate[] 
}> => {
  const backendResult = await fetchSafetyFromBackend(dot);
  if (backendResult) return backendResult;

  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`;
  const html = await fetchUrl(url, true);
  if (typeof html !== 'string') throw new Error("Could not fetch safety data");

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const ratingDateEl = doc.getElementById('RatingDate');

  return { 
    rating: cleanText(doc.getElementById('Rating')?.textContent) || 'N/A', 
    ratingDate: ratingDateEl ? cleanText(ratingDateEl.textContent).replace('Rating Date:', '').replace(/[()]/g, '') : 'N/A',
    basicScores: [], // Simplified for performance
    oosRates: [] 
  };
};

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const backendResult = await fetchCarrierFromBackend(mcNumber);
  if (backendResult) return backendResult;

  // 1. SAFER SNAPSHOT
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const html = await fetchUrl(url, useProxy);
  if (typeof html !== 'string' || !html.includes('USDOT Number:')) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const getVal = (label: string) => findValueByLabel(doc, label);

  const carrier: CarrierData = {
    mcNumber,
    dotNumber: getVal('USDOT Number:'),
    legalName: getVal('Legal Name:'),
    status: getVal('Operating Authority Status:').split('*')[0].trim(),
    phone: getVal('Phone:'),
    physicalAddress: getVal('Physical Address:'),
    dateScraped: new Date().toLocaleDateString('en-US'),
    email: 'N/A',
    safetyRating: 'N/A'
  };

  // 2. OPTIMIZED SMS HIT (ONE LINK FOR EMAIL AND RATING)
  if (carrier.dotNumber) {
    const smsUrl = `https://ai.fmcsa.dot.gov/SMS/Carrier/${carrier.dotNumber}/CarrierRegistration.aspx`;
    const smsHtml = await fetchUrl(smsUrl, useProxy);
    
    if (typeof smsHtml === 'string') {
      const smsDoc = parser.parseFromString(smsHtml, 'text/html');
      
      // Extract Email
      const labels = smsDoc.querySelectorAll('label');
      const emailLabel = Array.from(labels).find(l => l.textContent?.includes('Email:'));
      if (emailLabel?.parentElement) {
        const cfEmail = emailLabel.parentElement.querySelector('[data-cfemail]');
        if (cfEmail) {
          carrier.email = cfDecodeEmail(cfEmail.getAttribute('data-cfemail') || '');
        } else {
          const text = cleanText(emailLabel.parentElement.textContent?.replace('Email:', ''));
          if (text.includes('@')) carrier.email = text;
        }
      }

      // Extract Rating
      const ratingEl = smsDoc.querySelector('#Rating');
      carrier.safetyRating = cleanText(ratingEl?.textContent) || 'NOT RATED';
    }
  }

  return carrier;
};

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const backendResult = await fetchInsuranceFromBackend(dot);
  if (backendResult) return backendResult;

  const url = `https://searchcarriers.com/company/${dot}/insurances`;
  const result = await fetchUrl(url, true); 
  const extractedPolicies: InsurancePolicy[] = [];
  const rawData = Array.isArray(result) ? result : [];
  
  rawData.forEach((p: any) => {
    extractedPolicies.push({
      dot,
      carrier: (p.name_company || 'N/A').toUpperCase(),
      policyNumber: (p.policy_no || 'N/A').toUpperCase(),
      effectiveDate: p.effective_date?.split(' ')[0] || 'N/A',
      coverageAmount: p.max_cov_amount ? `$${Number(p.max_cov_amount).toLocaleString()}` : 'N/A',
      type: p.ins_type_code === '1' ? 'BI&PD' : 'CARGO',
      class: p.ins_class_code === 'P' ? 'PRIMARY' : 'EXCESS'
    });
  });

  return { policies: extractedPolicies, raw: result };
};

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['MC', 'DOT', 'Legal Name', 'Email', 'Phone', 'Status', 'Safety Rating', 'Physical Address'];
  const csvRows = data.map(row => [
    row.mcNumber, row.dotNumber, `"${row.legalName}"`, row.email, row.phone, `"${row.status}"`, row.safetyRating, `"${row.physicalAddress}"`
  ]);
  const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv' }));
  link.download = `carriers_export_${Date.now()}.csv`;
  link.click();
};

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin User', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise', dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: 'Rotated Proxy', isOnline: true, isBlocked: false }
];

export const BLOCKED_IPS: BlockedIP[] = [];

export const generateMockCarrier = (mc: string, b: boolean): CarrierData => ({
  mcNumber: mc,
  dotNumber: (parseInt(mc)+1000000).toString(),
  legalName: `Carrier ${mc} Logistics`,
  status: 'AUTHORIZED',
  email: 'info@carrier.com',
  phone: '800-555-0199',
  physicalAddress: '100 Logistics Way, Houston, TX 77002',
  dateScraped: '2024-01-01',
  safetyRating: 'Satisfactory'
});
