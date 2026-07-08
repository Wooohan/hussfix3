import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * NEW: Daily FMCSA Publications endpoint
 * Scrapes https://motus.dot.gov/customer/daily-fmcsa-publications
 * to find the PDF link for a given date, then returns the link.
 * 
 * Note: PDF parsing requires Python (pdfplumber) which isn't available on Vercel.
 * For Vercel deployment, this endpoint returns the PDF URL for client-side handling.
 * For full parsing, use the Express server (server/index.ts) which calls the Python script.
 */

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

    // Scrape the publications page to find the PDF link
    const publicationsUrl = 'https://motus.dot.gov/customer/daily-fmcsa-publications';
    
    const pageResponse = await axios.get(publicationsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(pageResponse.data);
    
    const targetDate = new Date(date + 'T00:00:00Z');
    const targetMonth = targetDate.getUTCMonth();
    const targetDay = targetDate.getUTCDate();
    const targetYear = targetDate.getUTCFullYear();
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const datePatterns = [
      `${monthNames[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthNames[targetMonth]} ${String(targetDay).padStart(2, '0')}, ${targetYear}`,
      `${monthShort[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthShort[targetMonth]} ${String(targetDay).padStart(2, '0')}, ${targetYear}`,
      `${String(targetMonth + 1).padStart(2, '0')}/${String(targetDay).padStart(2, '0')}/${targetYear}`,
      `${targetMonth + 1}/${targetDay}/${targetYear}`,
      `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
    ];

    let pdfUrl: string | null = null;

    // Strategy 1: Look for PDF links matching the date
    $('a[href]').each((_, el) => {
      if (pdfUrl) return;
      
      const href = $(el).attr('href') || '';
      const linkText = $(el).text().trim();
      const parentText = $(el).parent().text().trim();
      
      const isPdfLink = href.toLowerCase().includes('.pdf') || 
                        href.toLowerCase().includes('pdf') ||
                        linkText.toLowerCase().includes('pdf') ||
                        linkText.toLowerCase().includes('download');
      
      if (!isPdfLink) return;
      
      for (const pattern of datePatterns) {
        if (linkText.includes(pattern) || parentText.includes(pattern) || href.includes(pattern.replace(/\//g, '-'))) {
          pdfUrl = href;
          return;
        }
      }
      
      const dateStr = `${targetYear}${String(targetMonth + 1).padStart(2, '0')}${String(targetDay).padStart(2, '0')}`;
      const dateStr2 = `${String(targetMonth + 1).padStart(2, '0')}${String(targetDay).padStart(2, '0')}${targetYear}`;
      
      if (href.includes(dateStr) || href.includes(dateStr2)) {
        pdfUrl = href;
        return;
      }
    });

    // Strategy 2: Look in table rows or list items
    if (!pdfUrl) {
      $('tr, li, div, p').each((_, el) => {
        if (pdfUrl) return;
        const elementText = $(el).text();
        
        for (const pattern of datePatterns) {
          if (elementText.includes(pattern)) {
            const link = $(el).find('a[href*=".pdf"], a[href*="pdf"]').first();
            if (link.length > 0) {
              pdfUrl = link.attr('href') || null;
              return;
            }
          }
        }
      });
    }

    // Strategy 3: Date components in URL
    if (!pdfUrl) {
      const mm = String(targetMonth + 1).padStart(2, '0');
      const dd = String(targetDay).padStart(2, '0');
      const yyyy = String(targetYear);
      const yy = String(targetYear).slice(-2);
      
      $('a[href]').each((_, el) => {
        if (pdfUrl) return;
        const href = $(el).attr('href') || '';
        
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
        hint: 'The publication may not be available for this date.',
        available_links: allLinks.slice(0, 20),
        searched_patterns: datePatterns,
        entries: []
      });
    }

    // Make URL absolute
    if (pdfUrl && !pdfUrl.startsWith('http')) {
      if (pdfUrl.startsWith('/')) {
        pdfUrl = `https://motus.dot.gov${pdfUrl}`;
      } else {
        pdfUrl = `https://motus.dot.gov/customer/${pdfUrl}`;
      }
    }

    return res.status(200).json({
      success: true,
      date: date,
      pdf_url: pdfUrl,
      message: 'PDF URL found. Use the Express server for full PDF parsing.',
      entries: []
    });

  } catch (error: any) {
    console.error('FMCSA Publications error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch FMCSA publications data',
      details: error.message,
      entries: []
    });
  }
};
