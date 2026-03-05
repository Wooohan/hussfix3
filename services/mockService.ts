import { CarrierData, User } from '../types';

// === DATA SANITIZATION UTILITY ===
// This fixes the issue where extra text like "Non-CMV Units:" or 
// "OPERATING AUTHORITY INFORMATION..." was being saved into simple fields.
const sanitizeCarrierData = (raw: any): CarrierData => {
  const extractNumber = (val: string) => (val?.match(/\d+/) ? val.match(/\d+/)![0] : '0');

  // Clean the Mileage: Extract "100,000 (2024)" and stop before the noise
  const mileageMatch = raw.mcs150Mileage?.match(/[\d,]+\s\(\d{4}\)/);
  const cleanMileage = mileageMatch ? mileageMatch[0] : (raw.mcs150Mileage?.split(' ')[0] || '0');

  // Clean Status: Take only the relevant prefix (e.g., "AUTHORIZED")
  let cleanStatus = raw.status || 'UNKNOWN';
  if (cleanStatus.includes('AUTHORIZED')) {
    cleanStatus = cleanStatus.includes('NOT AUTHORIZED') ? 'NOT AUTHORIZED' : 'AUTHORIZED';
  }

  return {
    ...raw,
    powerUnits: extractNumber(raw.powerUnits),
    drivers: extractNumber(raw.drivers),
    mcs150Mileage: cleanMileage,
    status: cleanStatus,
    // Ensure nested data is handled if coming from stringified JSON
    basicScores: typeof raw.basicScores === 'string' ? JSON.parse(raw.basicScores) : (raw.basicScores || []),
    oosRates: typeof raw.oosRates === 'string' ? JSON.parse(raw.oosRates) : (raw.oosRates || [])
  };
};

// === MOCK DATA GENERATION ===
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

export const generateMockCarrier = (mcNumber: string, isBroker: boolean): CarrierData => {
  return sanitizeCarrierData({
    mcNumber,
    dotNumber: (parseInt(mcNumber) + 1000000).toString(),
    legalName: `Mock ${isBroker ? 'Broker' : 'Carrier'} Inc`,
    dbaName: '',
    entityType: isBroker ? 'BROKER' : 'CARRIER',
    status: 'AUTHORIZED FOR Property',
    email: `contact@mc${mcNumber}.com`,
    phone: '(555) 000-0000',
    powerUnits: '5 Non-CMV Units:', // Test sanitizer
    drivers: '3',
    physicalAddress: '123 Test Lane, City, ST',
    mailingAddress: '123 Test Lane, City, ST',
    dateScraped: new Date().toLocaleDateString(),
    mcs150Date: '02/10/2024',
    mcs150Mileage: '50,000 (2023) PLUS EXTRA NOISE', // Test sanitizer
    operationClassification: ['Auth. For Hire'],
    carrierOperation: ['Interstate'],
    cargoCarried: ['General Freight'],
    outOfServiceDate: 'None',
    stateCarrierId: '',
    dunsNumber: '',
    safetyRating: 'SATISFACTORY',
    safetyRatingDate: '01/01/2024',
    basicScores: [],
    oosRates: []
  });
};

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
  } catch (e) { return ""; }
};

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<string | null> => {
  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const gen of proxyGenerators) {
    try {
      const response = await fetch(gen(targetUrl));
      if (response.ok) return await response.text();
    } catch (e) { continue; }
  }
  return null;
};

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const html = await fetchUrl(url, useProxy);
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const center = doc.querySelector('center');
  if (!center) return null;

  const info = center.innerText || '';

  // Improved Extraction using specific Regex to stop at the next field
  const extract = (regex: RegExp) => {
    const match = info.match(regex);
    return match ? match[1].trim() : '';
  };

  const rawData = {
    mcNumber,
    dotNumber: extract(/USDOT Number:\s*(\d+)/),
    legalName: extract(/Legal Name:\s*(.*?)\s*DBA Name:/),
    dbaName: extract(/DBA Name:\s*(.*?)\s*Physical Address:/),
    entityType: extract(/Entity Type:\s*(.*?)\s*Operating Authority Status:/),
    status: extract(/Operating Authority Status:\s*(.*?)\s*(?:MC\/MX\/FF|$)/),
    physicalAddress: extract(/Physical Address:\s*(.*?)\s*Phone:/),
    phone: extract(/Phone:\s*(.*?)\s*Mailing Address:/),
    mailingAddress: extract(/Mailing Address:\s*(.*?)\s*USDOT Number:/),
    powerUnits: extract(/Power Units:\s*(.*?)\s*Drivers:/),
    drivers: extract(/Drivers:\s*(.*?)\s*MCS-150 Form Date:/),
    mcs150Date: extract(/MCS-150 Form Date:\s*([\d\/]+)/),
    mcs150Mileage: extract(/MCS-150 Mileage \(Year\):\s*(.*?)\s*Operation Classification:/),
    dateScraped: new Date().toLocaleDateString(),
    operationClassification: [], // Logic to find 'X' marks would go here
    carrierOperation: [],
    cargoCarried: [],
    safetyRating: 'N/A',
    oosRates: [],
    basicScores: []
  };

  // Run the sanitizer before returning to the UI
  return sanitizeCarrierData(rawData);
};

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['MC', 'DOT', 'Legal Name', 'Status', 'Email', 'Power Units', 'Drivers', 'Mileage'];
  const rows = data.map(d => [
    d.mcNumber, d.dotNumber, `"${d.legalName}"`, d.status, d.email, d.powerUnits, d.drivers, `"${d.mcs150Mileage}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `carriers_${mcNumber}.csv`;
  a.click();
};
