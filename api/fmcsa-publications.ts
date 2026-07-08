import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

// pdf-parse v1.1.1's index.js has debug code that tries to read a test PDF file
// when module.parent is falsy (which happens in Vercel's serverless environment).
// Import directly from the lib to bypass the problematic debug code.
// @ts-ignore
import pdfParseLib from 'pdf-parse/lib/pdf-parse.js';

interface FMCSAEntry {
  category_label: string;
  usdot_number: string;
  record_details: string;
}

const TARGET_CATEGORIES = [
  "BROKER OF HOUSEHOLD GOODS",
  "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "ENTERPRISE MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "FREIGHT FORWARDER OF HOUSEHOLD GOODS",
  "FREIGHT FORWARDER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
  "MOTOR CARRIER OF HOUSEHOLD GOODS",
  "MOTOR CARRIER OF PASSENGERS",
  "MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
];

/**
 * Parse PDF text content into structured entries.
 * This mirrors the working Python pdfplumber-based parser logic:
 * - Tracks current category label
 * - Detects USDOT number lines (4-9 digit numbers at start)
 * - Peeks ahead to group multi-line records
 */
function parsePdfText(text: string): FMCSAEntry[] {
  const data: FMCSAEntry[] = [];
  let currentCategory = "UNKNOWN / GENERAL";

  const lines = text.split('\n');
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();

    // Skip blank lines or structural running footers/headers
    if (
      !line ||
      line.includes('Run Date') ||
      line.includes('Run Time') ||
      line.includes('Page') ||
      line.includes('USDOT Number')
    ) {
      lineIdx++;
      continue;
    }

    // --- 1. Detect Category Updates (Including Multi-Line Titles) ---
    let matchedCategory: string | null = null;

    // Check for a clean single-line category match
    const singleLineMatch = TARGET_CATEGORIES.find(cat => line.includes(cat));
    if (singleLineMatch) {
      matchedCategory = singleLineMatch;
    }
    // Check if the title is split across the current line and the next line
    else if (lineIdx + 1 < lines.length) {
      const combinedLine = `${line} ${lines[lineIdx + 1].trim()}`;
      const multiLineMatch = TARGET_CATEGORIES.find(cat => combinedLine.includes(cat));
      if (multiLineMatch) {
        matchedCategory = multiLineMatch;
        lineIdx++; // Consume the next line too since it was part of the header
      }
    }

    if (matchedCategory) {
      currentCategory = matchedCategory;
      lineIdx++;
      continue;
    }

    // --- 2. Extract Data Rows ---
    // Valid listing rows strictly start with a USDOT numerical identifier (4-9 digits)
    if (/^\d{4,9}/.test(line)) {
      const tokens = line.split(/\s+/);
      const usdotNumber = tokens[0];
      let remainingText = tokens.slice(1).join(' ');

      // Peek ahead to group multi-line company descriptions belonging to this record
      while (lineIdx + 1 < lines.length) {
        const nextLine = lines[lineIdx + 1].trim();
        // If the next line is empty, a footer, or a brand new record entry, break loop
        if (
          !nextLine ||
          nextLine.includes('Run Date') ||
          /^\d{4,9}/.test(nextLine) ||
          TARGET_CATEGORIES.some(cat => nextLine.includes(cat))
        ) {
          break;
        }
        remainingText += ` | ${nextLine}`;
        lineIdx++;
      }

      data.push({
        category_label: currentCategory,
        usdot_number: usdotNumber,
        record_details: remainingText,
      });
    }

    lineIdx++;
  }

  return data;
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
    
    console.log(`PDF parsed, total text length: ${pdfData.text.length}, pages: ${pdfData.numpages}`);

    // Parse using the line-by-line approach matching the working Python logic
    const entries = parsePdfText(pdfData.text);

    // Filter out invalid entries (must have valid USDOT number)
    const cleanEntries = entries.filter(e => 
      e.usdot_number && 
      /^\d+$/.test(e.usdot_number)
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
