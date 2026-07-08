import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware.
app.use(cors());
app.use(express.json());

// Helper function to clean text
const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
};

// Helper function to format date as DD-MMM-YY
function formatDateForFMCSA(date: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

/**
 * NEW ENDPOINT: Fetch Daily FMCSA Publications
 * 1. Calls the MOTUS API directly to get signed PDF URLs for the given date
 * 2. Downloads the PDF and parses it using Python script (local) or pdf-parse (fallback)
 * 3. Returns structured JSON data
 * 
 * API discovered: https://motus.dot.gov/api/report/getSignedUrlByTypeAndDateRange/{TYPE}/{FROM}/{TO}
 * Types: REGISTER (FMCSA Daily Register), BROKER (Broker & Freight Forwarder notices)
 */
app.post('/api/fmcsa-publications', async (req: Request, res: Response) => {
  try {
    const { date } = req.body; // Expected format: YYYY-MM-DD (e.g., 2026-07-07)
    
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

    console.log(`📡 Fetching FMCSA Daily Publications for date: ${date}`);

    // Calculate the next day for the date range (API uses exclusive end date)
    const fromDate = date; // YYYY-MM-DD
    const nextDay = new Date(date + 'T00:00:00Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const toDate = nextDay.toISOString().split('T')[0]; // YYYY-MM-DD

    // Call the motus.dot.gov API directly to get signed PDF URLs
    const apiUrl = `https://motus.dot.gov/api/report/getSignedUrlByTypeAndDateRange/REGISTER/${fromDate}/${toDate}`;
    
    console.log(`📡 Calling MOTUS API: ${apiUrl}`);

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

    console.log(`📄 Found PDF URL for ${targetEntry.date}, downloading and parsing...`);

    // Step 2: Call Python script to parse the PDF
    const pythonScript = path.join(__dirname, 'parse_fmcsa_pdf.py');
    
    const result = await new Promise<any>((resolve, reject) => {
      exec(
        `python3 "${pythonScript}" "${pdfUrl}"`,
        { maxBuffer: 50 * 1024 * 1024, timeout: 120000 },
        (error, stdout, stderr) => {
          if (error) {
            console.error('Python script error:', stderr);
            reject(new Error(`PDF parsing failed: ${stderr || error.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim());
            resolve(parsed);
          } catch (parseErr) {
            reject(new Error(`Invalid JSON from parser: ${stdout.substring(0, 500)}`));
          }
        }
      );
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'PDF parsing failed',
        pdf_url: pdfUrl,
        entries: []
      });
    }

    console.log(`✅ Successfully parsed ${result.count} entries from PDF`);

    return res.status(200).json({
      success: true,
      count: result.count,
      date: date,
      pdf_url: pdfUrl,
      pdf_date: targetEntry.date,
      lastUpdated: new Date().toISOString(),
      entries: result.entries
    });

  } catch (error: any) {
    console.error('❌ FMCSA Publications error:', error.message);
    
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
});

// LEGACY ENDPOINT: Scrape FMCSA Register Data (kept for backward compatibility)
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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://li-public.fmcsa.dot.gov'
      },
      timeout: 60000,
    });

    if (!response.data.toUpperCase().includes('FMCSA REGISTER')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid response from FMCSA.',
        entries: []
      });
    }

    const $ = cheerio.load(response.data);
    const rawText = $.text();
    
    const entries: Array<{ number: string; title: string; decided: string; category: string }> = [];
    const pattern = /((?:MC|FF|MX|MX-MC)-\d+)\s+([\s\S]*?)\s+(\d{2}\/\d{2}\/\d{4})/g;
    
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

    let match;
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

      entries.push({ number: docket, title, decided: decidedDate, category });
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

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'FMCSA Scraper Backend is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend proxy server running on http://localhost:${PORT}`);
});
