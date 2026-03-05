import { CarrierData, User, InsurancePolicy, BasicScore, OosRate } from '../types';

// === HELPER UTILS ===

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const clean = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\u00a0/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
};

/**
 * Decodes Cloudflare-obfuscated email addresses found in FMCSA HTML
 */
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
    return "";
  }
};

const findValueByLabel = (doc: Document, label: string): string => {
  const ths = Array.from(doc.querySelectorAll('th'));
  const targetTh = ths.find(th => clean(th.textContent).includes(label));
  if (targetTh && targetTh.nextElementSibling instanceof HTMLElement) {
    return clean(targetTh.nextElementSibling.innerText);
  }
  return '';
};

// === NETWORK LAYER ===

const fetchFromProxy = async (targetUrl: string): Promise<string | null> => {
  try {
    const response = await fetch(`/api/scrape?targetUrl=${encodeURIComponent(targetUrl)}`);
    if (response.ok) return await response.text();
    return null;
  } catch (e) {
    return null;
  }
};

// === MAIN SCRAPER LOGIC ===

export const scrapeRealCarrier = async (mcNumber: string): Promise<CarrierData | null> => {
  // 1. Fetch SAFER Snapshot (Get DOT Number and basic status)
  const saferUrl = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mcNumber}`;
  const saferHtml = await fetchFromProxy(saferUrl);
  
  if (!saferHtml || !saferHtml.includes('USDOT Number:')) return null;

  const parser = new DOMParser();
  const sDoc = parser.parseFromString(saferHtml, 'text/html');
  
  const dot = findValueByLabel(sDoc, 'USDOT Number:');
  const carrier: CarrierData = {
    mcNumber,
    dotNumber: dot,
    legalName: findValueByLabel(sDoc, 'Legal Name:'),
    dbaName: findValueByLabel(sDoc, 'DBA Name:'),
    entityType: findValueByLabel(sDoc, 'Entity Type:'),
    status: findValueByLabel(sDoc, 'Operating Authority Status:').split('*')[0].trim(),
    phone: findValueByLabel(sDoc, 'Phone:'),
    physicalAddress: findValueByLabel(sDoc, 'Physical Address:'),
    mailingAddress: findValueByLabel(sDoc, 'Mailing Address:'),
    powerUnits: findValueByLabel(sDoc, 'Power Units:'),
    drivers: findValueByLabel(sDoc, 'Drivers:'),
    dateScraped: new Date().toLocaleDateString(),
    safetyRating: 'N/A',
    email: 'N/A',
    ratingDate: '—'
  };

  // 2. Fetch SMS Registration Page (One single trip for Email + Rating)
  if (dot) {
    const smsUrl = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CarrierRegistration.aspx`;
    const smsHtml = await fetchFromProxy(smsUrl);
    
    if (smsHtml) {
      const smsDoc = parser.parseFromString(smsHtml, 'text/html');

      // Extract Email (Handle Cloudflare or plain text)
      const emailLabel = Array.from(smsDoc.querySelectorAll('label')).find(l => l.textContent?.includes('Email:'));
      if (emailLabel) {
        const parent = emailLabel.parentElement;
        const cfEmail = parent?.querySelector('[data-cfemail]');
        if (cfEmail) {
          carrier.email = cfDecodeEmail(cfEmail.getAttribute('data-cfemail') || '');
        } else {
          const rawEmail = clean(parent?.textContent?.replace('Email:', ''));
          carrier.email = rawEmail.includes('@') ? rawEmail : 'N/A';
        }
      }

      // Extract Safety Rating & Date from the same page
      const ratingEl = smsDoc.querySelector('#Rating');
      const ratingDateEl = smsDoc.querySelector('#RatingDate');
      
      carrier.safetyRating = clean(ratingEl?.textContent) || 'NOT RATED';
      carrier.ratingDate = clean(ratingDateEl?.textContent)?.replace('(', '').replace(')', '') || 'N/A';
    }
  }

  return carrier;
};

// === INSURANCE & EXPORT ===

export const fetchInsuranceData = async (dot: string): Promise<{policies: InsurancePolicy[], raw: any}> => {
  const url = `https://searchcarriers.com/company/${dot}/insurances`;
  const html = await fetchFromProxy(url);
  const policies: InsurancePolicy[] = [];
  let rawData = [];
  
  try {
    rawData = html ? JSON.parse(html) : [];
    if (Array.isArray(rawData)) {
      rawData.forEach((p: any) => {
        policies.push({
          dot,
          carrier: (p.name_company || 'N/A').toUpperCase(),
          policyNumber: (p.policy_no || 'N/A').toUpperCase(),
          effectiveDate: p.effective_date ? p.effective_date.split(' ')[0] : 'N/A',
          coverageAmount: p.max_cov_amount ? `$${Number(p.max_cov_amount).toLocaleString()}` : 'N/A',
          type: p.ins_type_code === '1' ? 'BI&PD' : p.ins_type_code === '2' ? 'CARGO' : 'OTHER',
          class: p.ins_class_code === 'P' ? 'PRIMARY' : 'EXCESS'
        });
      });
    }
  } catch {
    rawData = [];
  }
  
  return { policies, raw: rawData };
};

export const downloadCSV = (data: CarrierData[]) => {
  const headers = ['MC', 'DOT', 'Legal Name', 'Email', 'Phone', 'Status', 'Address', 'Safety Rating'];
  const csvRows = data.map(row => [
    row.mcNumber, 
    row.dotNumber, 
    `"${row.legalName}"`, 
    row.email, 
    row.phone, 
    `"${row.status}"`, 
    `"${row.physicalAddress}"`, 
    row.safetyRating
  ]);
  
  const content = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `carriers_export_${Date.now()}.csv`);
  link.click();
};

// === ADMIN MOCK DATA ===

export const MOCK_USERS: User[] = [
  { 
    id: '1', 
    name: 'Admin', 
    email: 'wooohan3@gmail.com', 
    role: 'admin', 
    plan: 'Enterprise', 
    dailyLimit: 100000, 
    recordsExtractedToday: 450, 
    lastActive: 'Now', 
    ipAddress: 'Proxy Rotated', 
    isOnline: true, 
    isBlocked: false 
  }
];

export const generateMockCarrier = (mc: string, isBroker: boolean): CarrierData => ({
  mcNumber: mc,
  dotNumber: (1000000 + parseInt(mc)).toString(),
  legalName: `Mock Carrier ${mc}`,
  dbaName: '',
  entityType: isBroker ? 'BROKER' : 'CARRIER',
  status: 'AUTHORIZED',
  email: 'contact@mockcarrier.com',
  phone: '555-0199',
  powerUnits: '10',
  drivers: '8',
  physicalAddress: '123 Logistics Lane, Houston, TX',
  mailingAddress: '',
  dateScraped: new Date().toLocaleDateString(),
  safetyRating: 'Satisfactory',
  ratingDate: '01/01/2024'
});
