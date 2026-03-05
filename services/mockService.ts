import { 
  CarrierData, 
  User, 
  InsurancePolicy, 
  BasicScore, 
  OosRate 
} from '../types';
import { 
  fetchCarrierFromBackend, 
  fetchSafetyFromBackend, 
  fetchInsuranceFromBackend 
} from './backendService';

// === HELPERS (VERCEL BUILD-SAFE) ===

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
    return cleanText(nextTd.textContent || '');
  }
  return '';
};

const findMarkedLabels = (doc: Document, summary: string): string[] => {
  const table = doc.querySelector(`table[summary="${summary}"]`);
  if (!table) return [];
  const labels: string[] = [];
  table.querySelectorAll('td').forEach(cell => {
    if (cell.textContent?.trim() === 'X' && cell.nextElementSibling) {
      labels.push(cleanText(cell.nextElementSibling.textContent));
    }
  });
  return labels;
};

// === NETWORK LAYER ===

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<any> => {
  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const gen of proxyGenerators) {
    try {
      const response = await fetch(gen(targetUrl));
      if (!response.ok) continue;
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return json.contents || json;
      } catch { return text; }
    } catch (e) {}
  }
  return null;
};

// === MOCK DATA GENERATOR (Restored for Scraper.tsx) ===

export const generateMockCarrier = (mcNumber: string, isBroker: boolean): CarrierData => {
  return {
    mcNumber,
    dotNumber: (parseInt(mcNumber) + 1000000).toString(),
    legalName: `Mock ${isBroker ? 'Broker' : 'Carrier'} ${mcNumber} LLC`,
    dbaName: '',
    entityType: isBroker ? 'BROKER' : 'CARRIER',
    status: 'AUTHORIZED FOR PROPERTY',
    email: `contact@mock${mcNumber}.com`,
    phone: '(555) 000-0000',
    powerUnits: isBroker ? '0' : '15',
    drivers: isBroker ? '0' : '12',
    physicalAddress: '123 Logistics Way, Chicago, IL 60601',
    mailingAddress: 'PO Box 123, Chicago, IL 60601',
    dateScraped: new Date().toLocaleDateString(),
    mcs150Date: '01/01/2024',
    mcs150Mileage: '500,000',
    operationClassification: ['Auth. For Hire'],
    carrierOperation: ['Interstate'],
    cargoCarried: ['General Freight'],
    outOfServiceDate: '',
    stateCarrierId: '',
    dunsNumber: '',
    insurancePolicies: [],
    safetyRating: 'SATISFACTORY',
    basicScores: [],
    oosRates: []
  };
};

// === DEEP DATA ENGINES ===

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const backend = await fetchInsuranceFromBackend(dot);
  if (backend) return backend;

  const result = await fetchUrl(`https://searchcarriers.com/company/${dot}/insurances`, true); 
  const policies: InsurancePolicy[] = [];
  const rawData = result?.data || (Array.isArray(result) ? result : []);
  
  if (Array.isArray(rawData)) {
    rawData.forEach((p: any) => {
      policies.push({
        dot,
        carrier: (p.name_company || 'N/A').toString().toUpperCase(),
        policyNumber: (p.policy_no || 'N/A').toString().toUpperCase(),
        effectiveDate: p.effective_date?.split(' ')[0] || 'N/A',
        coverageAmount: p.max_cov_amount ? `$${Number(p.max_cov_amount).toLocaleString()}` : 'N/A',
        type: p.ins_type_code === '1' ? 'BI&PD' : p.ins_type_code === '2' ? 'CARGO' : 'BOND',
        class: p.ins_class_code === 'P' ? 'PRIMARY' : 'EXCESS'
      });
    });
  }
  return { policies, raw: result };
};

export const fetchSafetyData = async (dot: string): Promise<{ rating: string, ratingDate: string, basicScores: BasicScore[], oosRates: OosRate[] }> => {
  const backend = await fetchSafetyFromBackend(dot);
  if (backend) return backend;

  const html = await fetchUrl(`https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`, true);
  if (typeof html !== 'string') throw new Error("Safety fetch failed");

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
  
  return {
    rating: cleanText(doc.getElementById('Rating')?.textContent) || 'N/A',
    ratingDate: cleanText(doc.getElementById('RatingDate')?.textContent).replace('Rating Date:', '').replace(/[()]/g, '') || 'N/A',
    basicScores: Array.from(doc.querySelectorAll('tr.sumData td')).map((cell, i) => ({
      category: categories[i] || 'N/A',
      measure: cleanText(cell.querySelector('span.val')?.textContent || cell.textContent)
    })).slice(0, 7),
    oosRates: Array.from(doc.querySelectorAll('#SafetyRating table tr')).slice(1).map(row => {
      const cols = row.querySelectorAll('th, td');
      return { 
        type: cleanText(cols[0]?.textContent), 
        rate: cleanText(cols[1]?.textContent), 
        nationalAvg: cleanText(cols[2]?.textContent) 
      };
    }).filter(r => r.type)
  };
};

// === MAIN SCRAPE ENGINE ===

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const backend = await fetchCarrierFromBackend(mcNumber);
  if (backend) return backend;

  const html = await fetchUrl(`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`, useProxy);
  if (typeof html !== 'string') return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const getVal = (label: string) => findValueByLabel(doc, label);
  const dot = getVal('USDOT Number:');

  const carrier: CarrierData = {
    mcNumber,
    dotNumber: dot,
    legalName: getVal('Legal Name:'),
    dbaName: getVal('DBA Name:'),
    entityType: Array.from(doc.querySelectorAll('th')).find(th => th.textContent?.includes('Entity Type:'))?.nextElementSibling?.textContent?.trim() || '',
    status: getVal('Operating Authority Status:').split('*')[0].trim(),
    email: '',
    phone: getVal('Phone:'),
    powerUnits: getVal('Power Units:'),
    drivers: getVal('Drivers:'),
    physicalAddress: getVal('Physical Address:'),
    mailingAddress: getVal('Mailing Address:'),
    dateScraped: new Date().toLocaleDateString('en-US'),
    mcs150Date: getVal('MCS-150 Form Date:'),
    mcs150Mileage: getVal('MCS-150 Mileage (Year):').replace('Operation Classification:', '').trim(),
    operationClassification: findMarkedLabels(doc, "Operation Classification"),
    carrierOperation: findMarkedLabels(doc, "Carrier Operation"),
    cargoCarried: findMarkedLabels(doc, "Cargo Carried"),
    outOfServiceDate: getVal('Out of Service Date:'),
    stateCarrierId: getVal('State Carrier ID Number:'),
    dunsNumber: getVal('DUNS Number:'),
    insurancePolicies: [],
    safetyRating: 'N/A',
    basicScores: [],
    oosRates: []
  };

  if (dot) {
    const [smsHtml, safety, insurance] = await Promise.allSettled([
      fetchUrl(`https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CarrierRegistration.aspx`, true),
      fetchSafetyData(dot),
      fetchInsuranceData(dot)
    ]);

    if (smsHtml.status === 'fulfilled' && typeof smsHtml.value === 'string') {
      const smsDoc = new DOMParser().parseFromString(smsHtml.value, 'text/html');
      const emailLabel = Array.from(smsDoc.querySelectorAll('label')).find(l => l.textContent?.includes('Email:'));
      const cf = emailLabel?.parentElement?.querySelector('[data-cfemail]');
      carrier.email = cf ? cfDecodeEmail(cf.getAttribute('data-cfemail') || '') : '';
    }

    if (safety.status === 'fulfilled' && safety.value) {
      carrier.safetyRating = safety.value.rating;
      carrier.safetyRatingDate = safety.value.ratingDate;
      carrier.basicScores = safety.value.basicScores;
      carrier.oosRates = safety.value.oosRates;
    }

    if (insurance.status === 'fulfilled' && insurance.value) {
      carrier.insurancePolicies = insurance.value.policies;
    }
  }

  return carrier;
};

// === CSV EXPORT ===

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['Date', 'MC', 'Email', 'Legal Name', 'Address', 'Safety', 'Insurance Info'];
  const escape = (val: any) => `"${String(val || '').replace(/"/g, '""')}"`;

  const csvRows = data.map(row => [
    escape(row.dateScraped),
    row.mcNumber,
    escape(row.email),
    escape(row.legalName),
    escape(row.physicalAddress),
    escape(row.safetyRating),
    escape(row.insurancePolicies?.map(p => `${p.type}: ${p.coverageAmount}`).join('|'))
  ]);

  const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fmcsa_export_${Date.now()}.csv`;
  link.click();
};

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Admin', email: 'wooohan3@gmail.com', role: 'admin', plan: 'Enterprise', dailyLimit: 100000, recordsExtractedToday: 450, lastActive: 'Now', ipAddress: '127.0.0.1', isOnline: true }
];
