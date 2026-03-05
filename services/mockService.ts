import { CarrierData, User, InsurancePolicy, BasicScore, OosRate } from '../types';
import { fetchCarrierFromBackend, fetchSafetyFromBackend, fetchInsuranceFromBackend } from './backendService';

// === HELPERS FROM YOUR FAST VARIANT ===

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

// === HYBRID NETWORK LAYER (FAST + PROXY) ===

const fetchUrl = async (targetUrl: string, useProxy: boolean): Promise<string | any | null> => {
  const proxyGenerators = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
  ];

  for (const gen of proxyGenerators) {
    try {
      const response = await fetch(gen(targetUrl));
      if (!response.ok) continue;
      const text = await response.text();
      try { return JSON.parse(text).contents || JSON.parse(text); } catch { return text; }
    } catch (error) {}
  }
  return null;
};

// === DEEP DATA EXTRACTION (INSURANCE & SAFETY) ===

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const backendResult = await fetchInsuranceFromBackend(dot);
  if (backendResult) return backendResult;

  const url = `https://searchcarriers.com/company/${dot}/insurances`;
  const result = await fetchUrl(url, true); 
  const extractedPolicies: InsurancePolicy[] = [];
  const rawData = result?.data || (Array.isArray(result) ? result : []);
  
  if (Array.isArray(rawData)) {
    rawData.forEach((p: any) => {
      let type = (p.ins_type_code || '1').toString();
      type = type === '1' ? 'BI&PD' : type === '2' ? 'CARGO' : 'BOND';
      extractedPolicies.push({
        dot,
        carrier: (p.name_company || 'N/A').toUpperCase(),
        policyNumber: (p.policy_no || 'N/A').toUpperCase(),
        effectiveDate: p.effective_date?.split(' ')[0] || 'N/A',
        coverageAmount: `$${(Number(p.max_cov_amount) || 0).toLocaleString()}`,
        type,
        class: p.ins_class_code === 'P' ? 'PRIMARY' : 'EXCESS'
      });
    });
  }
  return { policies: extractedPolicies, raw: result };
};

export const fetchSafetyData = async (dot: string) => {
  const backendResult = await fetchSafetyFromBackend(dot);
  if (backendResult) return backendResult;

  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`;
  const html = await fetchUrl(url, true);
  if (typeof html !== 'string') return null;

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
      return { type: cleanText(cols[0].textContent), rate: cleanText(cols[1].textContent), nationalAvg: cleanText(cols[2].textContent) };
    })
  };
};

// === THE MAIN ENGINE (SCRAPE REAL CARRIER) ===

export const scrapeRealCarrier = async (mcNumber: string, useProxy: boolean): Promise<CarrierData | null> => {
  const backendResult = await fetchCarrierFromBackend(mcNumber);
  if (backendResult) return backendResult;

  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const html = await fetchUrl(url, useProxy);
  if (typeof html !== 'string') return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const getVal = (label: string) => findValueByLabel(doc, label);

  const carrier: CarrierData = {
    mcNumber,
    dotNumber: getVal('USDOT Number:'),
    legalName: getVal('Legal Name:'),
    dbaName: getVal('DBA Name:'),
    entityType: Array.from(doc.querySelectorAll('th')).find(th => th.textContent?.includes('Entity Type:'))?.nextElementSibling?.textContent?.trim() || '',
    status: getVal('Operating Authority Status:').split('*')[0].trim(),
    phone: getVal('Phone:'),
    physicalAddress: getVal('Physical Address:'),
    mailingAddress: getVal('Mailing Address:'),
    powerUnits: getVal('Power Units:'),
    drivers: getVal('Drivers:'),
    dateScraped: new Date().toLocaleDateString('en-US'),
    mcs150Date: getVal('MCS-150 Form Date:'),
    mcs150Mileage: getVal('MCS-150 Mileage (Year):').replace('Operation Classification:', '').trim(),
    operationClassification: [], // Logic from fast variant
    carrierOperation: [],
    cargoCarried: [],
    email: '', safetyRating: 'N/A', basicScores: [], oosRates: [], insurancePolicies: []
  };

  if (carrier.dotNumber) {
    // RUN ALL IN PARALLEL FOR MAXIMUM SPEED
    const [smsEmail, safety, insurance] = await Promise.all([
      fetchUrl(`https://ai.fmcsa.dot.gov/SMS/Carrier/${carrier.dotNumber}/CarrierRegistration.aspx`, true),
      fetchSafetyData(carrier.dotNumber),
      fetchInsuranceData(carrier.dotNumber)
    ]);

    // Email Decoding from SMS
    if (typeof smsEmail === 'string') {
      const smsDoc = new DOMParser().parseFromString(smsEmail, 'text/html');
      const emailLabel = Array.from(smsDoc.querySelectorAll('label')).find(l => l.textContent?.includes('Email:'));
      const cf = emailLabel?.parentElement?.querySelector('[data-cfemail]');
      carrier.email = cf ? cfDecodeEmail(cf.getAttribute('data-cfemail') || '') : '';
    }

    if (safety) {
      carrier.safetyRating = safety.rating;
      carrier.basicScores = safety.basicScores;
      carrier.oosRates = safety.oosRates;
    }
    
    if (insurance) carrier.insurancePolicies = insurance.policies;
  }

  return carrier;
};
