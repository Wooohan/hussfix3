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
 * 1. Scrapes https://motus.dot.gov/customer/daily-fmcsa-publications to find PDF link for given date
 * 2. Calls Python script to parse the PDF
 * 3. Returns structured JSON data
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

    console.log(`📡 Fetching FMCSA Daily Publications for date: ${date}`);

    // Step 1: Scrape the publications page to find the PDF link for the given date
    const publicationsUrl = 'https://motus.dot.gov/customer/daily-fmcsa-publications';
    
    const pageResponse = await axios.get(publicationsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(pageResponse.data);
    
    // Parse the target date to match against page content
    const targetDate = new Date(date + 'T00:00:00Z');
    const targetMonth = targetDate.getUTCMonth(); // 0-indexed
    const targetDay = targetDate.getUTCDate();
    const targetYear = targetDate.getUTCFullYear();
    
    // Format variations to search for on the page
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Common date formats that might appear on the page
    const datePatterns = [
      `${monthNames[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthNames[targetMonth]} ${String(targetDay).padStart(2, '0')}, ${targetYear}`,
      `${monthShort[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthShort[targetMonth]} ${String(targetDay).padStart(2, '0')}, ${targetYear}`,
      `${String(targetMonth + 1).padStart(2, '0')}/${String(targetDay).padStart(2, '0')}/${targetYear}`,
      `${targetMonth + 1}/${targetDay}/${targetYear}`,
      `${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}-${targetYear}`,
      `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
    ];

    let pdfUrl: string | null = null;

    // Strategy 1: Look for links containing the date in text or href
    $('a[href]').each((_, el) => {
      if (pdfUrl) return; // Already found
      
      const href = $(el).attr('href') || '';
      const linkText = $(el).text().trim();
      const parentText = $(el).parent().text().trim();
      
      // Check if this is a PDF link
      const isPdfLink = href.toLowerCase().includes('.pdf') || 
                        href.toLowerCase().includes('pdf') ||
                        linkText.toLowerCase().includes('pdf') ||
                        linkText.toLowerCase().includes('download');
      
      if (!isPdfLink) return;
      
      // Check if the date matches in link text, parent text, or href
      for (const pattern of datePatterns) {
        if (linkText.includes(pattern) || parentText.includes(pattern) || href.includes(pattern.replace(/\//g, '-'))) {
          pdfUrl = href;
          return;
        }
      }
      
      // Also check for date components in the URL itself
      const dateStr = `${targetYear}${String(targetMonth + 1).padStart(2, '0')}${String(targetDay).padStart(2, '0')}`;
      const dateStr2 = `${String(targetMonth + 1).padStart(2, '0')}${String(targetDay).padStart(2, '0')}${targetYear}`;
      const dateStr3 = `${String(targetDay).padStart(2, '0')}${String(targetMonth + 1).padStart(2, '0')}${targetYear}`;
      
      if (href.includes(dateStr) || href.includes(dateStr2) || href.includes(dateStr3)) {
        pdfUrl = href;
        return;
      }
    });

    // Strategy 2: Look for table rows or list items containing the date
    if (!pdfUrl) {
      const pageText = $.html();
      
      // Try to find any PDF links on the page and match by proximity to date text
      const allPdfLinks: string[] = [];
      $('a[href*=".pdf"], a[href*="pdf"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href) allPdfLinks.push(href);
      });

      // Check each row/section for date match
      $('tr, li, div, p').each((_, el) => {
        if (pdfUrl) return;
        const elementText = $(el).text();
        
        for (const pattern of datePatterns) {
          if (elementText.includes(pattern)) {
            // Found a section with our date, look for PDF link within it
            const link = $(el).find('a[href*=".pdf"], a[href*="pdf"]').first();
            if (link.length > 0) {
              pdfUrl = link.attr('href') || null;
              return;
            }
            // Also check parent
            const parentLink = $(el).closest('tr, li').find('a[href*=".pdf"], a[href*="pdf"]').first();
            if (parentLink.length > 0) {
              pdfUrl = parentLink.attr('href') || null;
              return;
            }
          }
        }
      });
    }

    // Strategy 3: If still not found, look for any link with the date components
    if (!pdfUrl) {
      const mm = String(targetMonth + 1).padStart(2, '0');
      const dd = String(targetDay).padStart(2, '0');
      const yyyy = String(targetYear);
      const yy = String(targetYear).slice(-2);
      
      $('a[href]').each((_, el) => {
        if (pdfUrl) return;
        const href = $(el).attr('href') || '';
        
        // Match patterns like: 07-07-2026, 07072026, 2026-07-07, 070726
        if (href.includes(`${mm}-${dd}-${yyyy}`) || 
            href.includes(`${mm}${dd}${yyyy}`) ||
            href.includes(`${yyyy}-${mm}-${dd}`) ||
            href.includes(`${mm}${dd}${yy}`) ||
            href.includes(`${mm}-${dd}-${yy}`)) {
          pdfUrl = href;
        }
      });
    }

    if (!pdfUrl) {
      // Return the page HTML snippet for debugging (first 2000 chars of links)
      const allLinks: string[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim().substring(0, 100);
        if (href.toLowerCase().includes('pdf') || text.toLowerCase().includes('publication')) {
          allLinks.push(`${text} -> ${href}`);
        }
      });

      return res.status(404).json({
        success: false,
        error: `No PDF found for date ${date} on the publications page.`,
        hint: 'The publication may not be available for this date, or the page structure may have changed.',
        available_links: allLinks.slice(0, 20),
        searched_patterns: datePatterns,
        entries: []
      });
    }

    // Make sure pdfUrl is absolute
    if (pdfUrl && !pdfUrl.startsWith('http')) {
      if (pdfUrl.startsWith('/')) {
        pdfUrl = `https://motus.dot.gov${pdfUrl}`;
      } else {
        pdfUrl = `https://motus.dot.gov/customer/${pdfUrl}`;
      }
    }

    console.log(`📄 Found PDF URL: ${pdfUrl}`);

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
      lastUpdated: new Date().toISOString(),
      entries: result.entries
    });

  } catch (error: any) {
    console.error('❌ FMCSA Publications error:', error.message);
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
