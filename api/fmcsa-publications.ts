import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

// pdf-parse v1.1.1's index.js has debug code that tries to read a test PDF file
// when module.parent is falsy (which happens in Vercel's serverless environment).
// Import directly from the lib to bypass the problematic debug code.
// @ts-ignore
import pdfParseLib from 'pdf-parse/lib/pdf-parse.js';

interface FMCSAEntry {
  usdot_number: string;
  legal_business_name: string;
  filing_date: string;
  mailing_address: string;
  company_officer: string;
  telephone: string;
  category: string;
}

const VALID_CATEGORIES = [
  "BROKER OF HOUSEHOLD GOODS",
  "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "FREIGHT FORWARDER OF HOUSEHOLD GOODS",
  "FREIGHT FORWARDER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "MOTOR CARRIER OF HOUSEHOLD GOODS",
  "MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "MOTOR CARRIER OF PASSENGERS",
  "FITNESS-ONLY APPLICATIONS"
];

/**
 * Parse PDF text content into structured entries
 */
function parsePdfText(text: string): FMCSAEntry[] {
  const entries: FMCSAEntry[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentCategory = "Unknown Section";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase().trim();
    
    // Check if this line is a category header
    for (const cat of VALID_CATEGORIES) {
      if (line === cat || line.includes(cat)) {
        currentCategory = cat;
        break;
      }
    }
    
    // Look for USDOT numbers (typically 5-8 digit numbers at start of line)
    const usdotMatch = lines[i].match(/^(\d{5,8})\s+(.+)/);
    if (usdotMatch) {
      const usdot = usdotMatch[1];
      const restOfLine = usdotMatch[2].trim();
      
      // Look for a date pattern (MM/DD/YYYY)
      const dateMatch = restOfLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      
      let businessName = '';
      let filingDate = '';
      let address = '';
      let officer = '';
      let phone = '';
      
      if (dateMatch) {
        const dateIndex = restOfLine.indexOf(dateMatch[1]);
        businessName = restOfLine.substring(0, dateIndex).trim();
        filingDate = dateMatch[1];
        const afterDate = restOfLine.substring(dateIndex + dateMatch[1].length).trim();
        
        // Try to extract phone number
        const phoneMatch = afterDate.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\s*$/);
        if (phoneMatch) {
          phone = phoneMatch[1];
          const beforePhone = afterDate.substring(0, afterDate.lastIndexOf(phoneMatch[1])).trim();
          
          // Split remaining into address and officer
          const parts = beforePhone.split(/\s{2,}/);
          if (parts.length >= 2) {
            address = parts.slice(0, -1).join(' ').trim();
            officer = parts[parts.length - 1].trim();
          } else {
            address = beforePhone;
          }
        } else {
          // No phone found, try to split by multiple spaces
          const parts = afterDate.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
          if (parts.length >= 3) {
            address = parts[0].trim();
            officer = parts[1].trim();
            phone = parts[2].trim();
          } else if (parts.length === 2) {
            address = parts[0].trim();
            officer = parts[1].trim();
          } else {
            address = afterDate;
          }
        }
      } else {
        // No date found, just use the rest as business name
        businessName = restOfLine;
        
        // Check next lines for more data
        if (i + 1 < lines.length && !lines[i + 1].match(/^\d{5,8}/)) {
          const nextLine = lines[i + 1];
          const nextDateMatch = nextLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
          if (nextDateMatch) {
            filingDate = nextDateMatch[1];
            i++;
          }
        }
      }
      
      if (usdot && (businessName || filingDate)) {
        entries.push({
          usdot_number: usdot,
          legal_business_name: businessName || 'N/A',
          filing_date: filingDate || 'N/A',
          mailing_address: address || 'N/A',
          company_officer: officer || 'N/A',
          telephone: phone || 'N/A',
          category: currentCategory
        });
      }
    }
  }
  
  return entries;
}

/**
 * Alternative parsing: Try to find tabular data using column-based approach
 */
function parsePdfTextTabular(text: string): FMCSAEntry[] {
  const entries: FMCSAEntry[] = [];
  const lines = text.split('\n');
  
  let currentCategory = "Unknown Section";
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineUpper = line.toUpperCase();
    
    // Check for category headers
    for (const cat of VALID_CATEGORIES) {
      if (lineUpper === cat || lineUpper.includes(cat)) {
        currentCategory = cat;
        inTable = false;
        break;
      }
    }
    
    // Check for table header row
    if (lineUpper.includes('USDOT') && lineUpper.includes('LEGAL BUSINESS')) {
      inTable = true;
      continue;
    }
    
    if (!inTable) continue;
    
    // Skip empty lines and separator lines
    if (!line || line.match(/^[-=]+$/)) continue;
    
    // Try to match a data row starting with USDOT number
    const match = line.match(/^(\d{5,8})\s+(.+)/);
    if (match) {
      const usdot = match[1];
      const rest = match[2];
      
      // Split by multiple spaces (column separator in PDF text)
      const columns = rest.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
      
      entries.push({
        usdot_number: usdot,
        legal_business_name: columns[0] || 'N/A',
        filing_date: columns[1] || 'N/A',
        mailing_address: columns[2] || 'N/A',
        company_officer: columns[3] || 'N/A',
        telephone: columns[4] || 'N/A',
        category: currentCategory
      });
    }
  }
  
  return entries;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date } = req.body; // Expected: YYYY-MM-DD

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required (format: YYYY-MM-DD)',
        entries: []
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
        entries: []
      });
    }

    console.log(`Fetching FMCSA Daily Publications for date: ${date}`);

    // Calculate the next day for the date range (API uses exclusive end date)
    const fromDate = date; // YYYY-MM-DD
    const nextDay = new Date(date + 'T00:00:00Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const toDate = nextDay.toISOString().split('T')[0]; // YYYY-MM-DD

    // Step 1: Call the motus.dot.gov API directly to get signed PDF URLs
    // API endpoint discovered: /api/report/getSignedUrlByTypeAndDateRange/{TYPE}/{FROM}/{TO}
    // Types: REGISTER (FMCSA Daily Register), BROKER (Broker & Freight Forwarder notices)
    const apiUrl = `https://motus.dot.gov/api/report/getSignedUrlByTypeAndDateRange/REGISTER/${fromDate}/${toDate}`;
    
    console.log(`Calling MOTUS API: ${apiUrl}`);

    const apiResponse = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://motus.dot.gov/customer/daily-fmcsa-publications',
      },
      timeout: 30000,
    });

    const apiData = apiResponse.data;
    
    // The API returns: { "Register": [{ "date": "YYYY-MM-DD", "url": "https://..." }] }
    const registerEntries = apiData?.Register || apiData?.register || [];
    
    if (!registerEntries || registerEntries.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No FMCSA Daily Register publication found for date ${date}. The publication may not be available for this date (weekends/holidays typically have no publications).`,
        hint: 'Try a recent weekday date. Publications are typically posted on business days.',
        entries: []
      });
    }

    // Find the entry matching our target date
    const targetEntry = registerEntries.find((entry: any) => entry.date === fromDate) || registerEntries[0];
    const pdfUrl = targetEntry?.url;

    if (!pdfUrl) {
      return res.status(404).json({
        success: false,
        error: `PDF URL not found for date ${date}`,
        available_dates: registerEntries.map((e: any) => e.date),
        entries: []
      });
    }

    console.log(`Found PDF URL for ${targetEntry.date}, downloading...`);

    // Step 2: Download and parse the PDF
    const pdfResponse = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 60000,
    });

    const pdfBuffer = Buffer.from(pdfResponse.data);
    const pdfData = await pdfParseLib(pdfBuffer);
    
    // Try both parsing strategies and use the one with more results
    const entries1 = parsePdfText(pdfData.text);
    const entries2 = parsePdfTextTabular(pdfData.text);
    
    const entries = entries1.length >= entries2.length ? entries1 : entries2;

    // Filter out invalid entries
    const cleanEntries = entries.filter(e => 
      e.usdot_number && 
      e.usdot_number !== 'N/A' && 
      e.usdot_number.match(/^\d+$/)
    );

    console.log(`Parsed ${cleanEntries.length} entries from PDF`);

    return res.status(200).json({
      success: true,
      count: cleanEntries.length,
      date: date,
      pdf_url: pdfUrl,
      pdf_date: targetEntry.date,
      lastUpdated: new Date().toISOString(),
      entries: cleanEntries
    });

  } catch (error: any) {
    console.error('FMCSA Publications error:', error.message);
    
    // Provide more specific error messages
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: `No publication found for the requested date. The MOTUS API returned 404.`,
        details: error.message,
        entries: []
      });
    }
    
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Request timed out while fetching publication data. Please try again.',
        details: error.message,
        entries: []
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to fetch FMCSA publications data',
      details: error.message,
      entries: []
    });
  }
};
