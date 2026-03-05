import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to clean text
const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
};

// === SAFETY DATA ENDPOINT ===

app.get('/api/scrape/safety/:dot', async (req: Request, res: Response) => {
  try {
    const { dot } = req.params;
    
    if (!dot) {
      return res.status(400).json({ error: 'DOT number required' });
    }

    const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/CompleteProfile.aspx`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000, // Faster timeout
    });

    const $ = cheerio.load(response.data);

    // Extract safety rating
    const ratingEl = $('#Rating');
    const rating = ratingEl.length > 0 ? cleanText(ratingEl.text()) : 'N/A';
    
    const ratingDateEl = $('#RatingDate');
    const ratingDate = ratingDateEl.length > 0
      ? cleanText(ratingDateEl.text()).replace('Rating Date:', '').replace('(', '').replace(')', '')
      : 'N/A';

    // Extract BASIC scores
    const categories = ["Unsafe Driving", "Crash Indicator", "HOS Compliance", "Vehicle Maintenance", "Controlled Substances", "Hazmat Compliance", "Driver Fitness"];
    const basicScores: { category: string; measure: string }[] = [];
    
    const sumDataRow = $('tr.sumData');
    if (sumDataRow.length > 0) {
      sumDataRow.find('td').each((i, cell) => {
        if (i < categories.length) {
          const valSpan = $(cell).find('span.val');
          const val = valSpan.length > 0 ? cleanText(valSpan.text()) : cleanText($(cell).text());
          basicScores.push({ category: categories[i], measure: val || '0.00' });
        }
      });
    }

    // Extract OOS rates
    const oosRates: { type: string; rate: string; nationalAvg: string }[] = [];
    const safetyDiv = $('#SafetyRating');
    if (safetyDiv.length > 0) {
      const oosTable = safetyDiv.find('table');
      if (oosTable.length > 0) {
        oosTable.find('tbody tr').each((_, row) => {
          const cols = $(row).find('th, td');
          if (cols.length >= 3) {
            oosRates.push({
              type: cleanText($(cols[0]).text()),
              rate: cleanText($(cols[1]).text()),
              nationalAvg: cleanText($(cols[2]).text())
            });
          }
        });
      }
    }

    res.json({
      rating,
      ratingDate,
      basicScores,
      oosRates
    });

  } catch (error: any) {
    console.error('❌ Safety scrape error:', error.message);
    res.status(500).json({
      error: 'Failed to scrape safety data',
      details: error.message
    });
  }
});

// === CARRIER DATA ENDPOINT ===

app.get('/api/scrape/carrier/:mc', async (req: Request, res: Response) => {
  try {
    const { mc } = req.params;
    
    if (!mc) {
      return res.status(400).json({ error: 'MC number required' });
    }

    const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mc}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000, // Faster timeout
    });

    const $ = cheerio.load(response.data);
    
    if ($('center').length === 0) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    const findValueByLabel = (label: string): string => {
      let result = '';
      $('th').each((_, th) => {
        if (cleanText($(th).text()).includes(label)) {
          const nextTd = $(th).next();
          if (nextTd.length > 0) {
            result = cleanText(nextTd.text());
            return false;
          }
        }
      });
      return result;
    };

    const findMarked = (summary: string): string[] => {
      const res: string[] = [];
      $(`table[summary="${summary}"]`).find('td').each((_, cell) => {
        if (cleanText($(cell).text()) === 'X') {
          const next = $(cell).next();
          if (next.length > 0) {
            res.push(cleanText(next.text()));
          }
        }
      });
      return res;
    };

    const carrier = {
      mcNumber: mc,
      dotNumber: findValueByLabel('USDOT Number:'),
      legalName: findValueByLabel('Legal Name:'),
      dbaName: findValueByLabel('DBA Name:'),
      entityType: findValueByLabel('Entity Type:'),
      status: findValueByLabel('Operating Authority Status:'),
      email: '',
      phone: findValueByLabel('Phone:'),
      powerUnits: findValueByLabel('Power Units:'),
      drivers: findValueByLabel('Drivers:'),
      physicalAddress: findValueByLabel('Physical Address:'),
      mailingAddress: findValueByLabel('Mailing Address:'),
      dateScraped: new Date().toLocaleDateString('en-US'),
      mcs150Date: findValueByLabel('MCS-150 Form Date:'),
      mcs150Mileage: findValueByLabel('MCS-150 Mileage (Year):'),
      operationClassification: findMarked("Operation Classification"),
      carrierOperation: findMarked("Carrier Operation"),
      cargoCarried: findMarked("Cargo Carried"),
      outOfServiceDate: findValueByLabel('Out of Service Date:'),
      stateCarrierId: findValueByLabel('State Carrier ID Number:'),
      dunsNumber: findValueByLabel('DUNS Number:')
    };

    res.json(carrier);

  } catch (error: any) {
    console.error('❌ Carrier scrape error:', error.message);
    res.status(500).json({
      error: 'Failed to scrape carrier data',
      details: error.message
    });
  }
});

// === INSURANCE DATA ENDPOINT ===

app.get('/api/scrape/insurance/:dot', async (req: Request, res: Response) => {
  try {
    const { dot } = req.params;
    
    if (!dot) {
      return res.status(400).json({ error: 'DOT number required' });
    }

    const url = `https://searchcarriers.com/company/${dot}/insurances`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    const policies: any[] = [];
    const rawData = response.data?.data || (Array.isArray(response.data) ? response.data : []);
    
    if (Array.isArray(rawData)) {
      rawData.forEach((p: any) => {
        const carrier = p.name_company || p.insurance_company || p.insurance_company_name || p.company_name || 'NOT SPECIFIED';
        const policyNumber = p.policy_no || p.policy_number || p.pol_num || 'N/A';
        const effectiveDate = p.effective_date ? p.effective_date.split(' ')[0] : 'N/A';

        let coverage = p.max_cov_amount || p.coverage_to || p.coverage_amount || 'N/A';
        if (coverage !== 'N/A' && !isNaN(Number(coverage))) {
          const num = Number(coverage);
          if (num < 10000 && num > 0) {
            coverage = `$${(num * 1000).toLocaleString()}`;
          } else {
            coverage = `$${num.toLocaleString()}`;
          }
        }

        let type = (p.ins_type_code || 'N/A').toString();
        if (type === '1') type = 'BI&PD';
        else if (type === '2') type = 'CARGO';
        else if (type === '3') type = 'BOND';

        let iClass = (p.ins_class_code || 'N/A').toString().toUpperCase();
        if (iClass === 'P') iClass = 'PRIMARY';
        else if (iClass === 'E') iClass = 'EXCESS';

        policies.push({
          dot,
          carrier: carrier.toString().toUpperCase(),
          policyNumber: policyNumber.toString().toUpperCase(),
          effectiveDate,
          coverageAmount: coverage.toString(),
          type: type.toUpperCase(),
          class: iClass
        });
      });
    }

    res.json({
      policies,
      raw: response.data
    });

  } catch (error: any) {
    console.error('❌ Insurance scrape error:', error.message);
    res.status(500).json({
      error: 'Failed to scrape insurance data',
      details: error.message
    });
  }
});

// === FMCSA REGISTER ENDPOINT ===

app.post('/api/fmcsa-register', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    
    const registerDate = date || formatDateForFMCSA(new Date());
    const registerUrl = 'https://li-public.fmcsa.dot.gov/LIVIEW/PKG_register.prc_reg_detail';
    
    const params = new URLSearchParams();
    params.append('pd_date', registerDate);
    params.append('pv_vpath', 'LIVIEW');

    console.log(`📡 Scraping FMCSA Register for date: ${registerDate}`);

    const response = await axios.post(registerUrl, params.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://li-public.fmcsa.dot.gov/LIVIEW/PKG_REGISTER.prc_reg_list',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://li-public.fmcsa.dot.gov'
      },
      timeout: 60000,
    });

    if (!response.data.toUpperCase().includes('FMCSA REGISTER')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid response from FMCSA. The page might not be available for this date.',
        entries: []
      });
    }

    const $ = cheerio.load(response.data);
    const rawText = $.text();
    
    const entries: Array<{ number: string; title: string; decided: string; category: string }> = [];
    const pattern = /((?:MC|FF|MX|MX-MC)-\d+)\s+([\s\S]*?)\s+(\d{2}\/\d{2}\/\d{4})/g;
    
    let match;
    const categoryKeywords: Record<string, string[]> = {
      'NAME CHANGE': ['NAME CHANGES'],
      'CERTIFICATE, PERMIT, LICENSE': ['CERTIFICATES, PERMITS & LICENSES'],
      'CERTIFICATE OF REGISTRATION': ['CERTIFICATES OF REGISTRATION'],
      'DISMISSAL': ['DISMISSALS'],
      'WITHDRAWAL': ['WITHDRAWAL OF APPLICATION'],
      'REVOCATION': ['REVOCATIONS'],
      'TRANSFERS': ['TRANSFERS'],
      'GRANT DECISION NOTICES': ['GRANT DECISION NOTICES']
    };

    while ((match = pattern.exec(rawText)) !== null) {
      const docket = match[1];
      const rawInfo = match[2];
      const decidedDate = match[3];
      const title = rawInfo.replace(/\s+/g, ' ').trim();
      
      if (title.length > 500) continue;

      const beforeIndex = match.index;
      const contextText = rawText.substring(Math.max(0, beforeIndex - 1500), beforeIndex).toUpperCase();
      
      let category = 'MISCELLANEOUS';
      for (const [catName, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(k => contextText.includes(k))) {
          category = catName;
        }
      }

      entries.push({
        number: docket,
        title,
        decided: decidedDate,
        category
      });
    }

    const uniqueEntries = entries.filter((entry, index, self) =>
      index === self.findIndex((e) => e.number === entry.number && e.title === entry.title)
    );

    console.log(`✅ Successfully extracted ${uniqueEntries.length} entries for ${registerDate}`);

    res.json({
      success: true,
      count: uniqueEntries.length,
      date: registerDate,
      lastUpdated: new Date().toISOString(),
      entries: uniqueEntries
    });

  } catch (error: any) {
    console.error('❌ FMCSA Register scrape error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to scrape FMCSA register data', 
      details: error.message,
      entries: []
    });
  }
});

// Helper function to format date as DD-MMM-YY
function formatDateForFMCSA(date: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'FMCSA Scraper Backend is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend proxy server running on http://localhost:${PORT}`);
});
