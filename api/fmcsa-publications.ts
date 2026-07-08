import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

// We'll use pdf-parse for Node.js PDF text extraction
// @ts-ignore
import pdf from 'pdf-parse';

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
    
    // Look for USDOT numbers (typically 7-digit numbers)
    const usdotMatch = lines[i].match(/^(\d{5,8})\s+(.+)/);
    if (usdotMatch) {
      const usdot = usdotMatch[1];
      const restOfLine = usdotMatch[2].trim();
      
      // Try to parse the rest - format is typically:
      // USDOT  Business Name  Date  Address  Officer  Phone
      // But it might span multiple columns in the PDF text
      
      // Look for a date pattern (MM/DD/YYYY or similar)
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
        
        // Try to extract phone number (last part, usually digits with dashes/parens)
        const phoneMatch = afterDate.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\s*$/);
        if (phoneMatch) {
          phone = phoneMatch[1];
          const beforePhone = afterDate.substring(0, afterDate.lastIndexOf(phoneMatch[1])).trim();
          
          // Split remaining into address and officer
          // Officer is usually the last name-like segment before phone
          const parts = beforePhone.split(/\s{2,}/);
          if (parts.length >= 2) {
            address = parts.slice(0, -1).join(' ').trim();
            officer = parts[parts.length - 1].trim();
          } else {
            address = beforePhone;
          }
        } else {
          // No phone found, try to split by multiple spaces
          const parts = afterDate.split(/\s{2,}/);
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
            i++; // Skip next line
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
      if (lineUpper === cat) {
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

    console.log(`Fetching FMCSA Daily Publications for date: ${date}`);

    // Step 1: Scrape the publications page to find the PDF link
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
    
    // Build date patterns to search for
    const mm = String(targetMonth + 1).padStart(2, '0');
    const dd = String(targetDay).padStart(2, '0');
    const yyyy = String(targetYear);
    const yy = String(targetYear).slice(-2);
    
    const datePatterns = [
      `${monthNames[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthNames[targetMonth]} ${dd}, ${targetYear}`,
      `${monthShort[targetMonth]} ${targetDay}, ${targetYear}`,
      `${monthShort[targetMonth]} ${dd}, ${targetYear}`,
      `${mm}/${dd}/${yyyy}`,
      `${targetMonth + 1}/${targetDay}/${targetYear}`,
      `${yyyy}-${mm}-${dd}`,
      `${mm}-${dd}-${yyyy}`,
    ];

    let pdfUrl: string | null = null;

    // Strategy 1: Look for links containing date in text/href
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
      
      // Check for date components in URL
      const dateStr = `${yyyy}${mm}${dd}`;
      const dateStr2 = `${mm}${dd}${yyyy}`;
      const dateStr3 = `${mm}-${dd}-${yyyy}`;
      const dateStr4 = `${yyyy}-${mm}-${dd}`;
      const dateStr5 = `${mm}${dd}${yy}`;
      
      if (href.includes(dateStr) || href.includes(dateStr2) || href.includes(dateStr3) || href.includes(dateStr4) || href.includes(dateStr5)) {
        pdfUrl = href;
        return;
      }
    });

    // Strategy 2: Look in elements containing the date text
    if (!pdfUrl) {
      $('tr, li, div, p, td, span').each((_, el) => {
        if (pdfUrl) return;
        const elementText = $(el).text();
        
        for (const pattern of datePatterns) {
          if (elementText.includes(pattern)) {
            const link = $(el).find('a[href*=".pdf"], a[href*="pdf"]').first();
            if (link.length > 0) {
              pdfUrl = link.attr('href') || null;
              return;
            }
            // Check siblings and parent
            const parentLink = $(el).closest('tr, li, div').find('a[href*=".pdf"], a[href*="pdf"]').first();
            if (parentLink.length > 0) {
              pdfUrl = parentLink.attr('href') || null;
              return;
            }
          }
        }
      });
    }

    // Strategy 3: Check all links for date in URL path
    if (!pdfUrl) {
      $('a[href]').each((_, el) => {
        if (pdfUrl) return;
        const href = $(el).attr('href') || '';
        
        if (href.includes(`${mm}-${dd}-${yyyy}`) || 
            href.includes(`${mm}${dd}${yyyy}`) ||
            href.includes(`${yyyy}-${mm}-${dd}`) ||
            href.includes(`${mm}${dd}${yy}`) ||
            href.includes(`${mm}-${dd}-${yy}`) ||
            href.includes(`${dd}-${mm}-${yyyy}`)) {
          pdfUrl = href;
        }
      });
    }

    if (!pdfUrl) {
      const allLinks: string[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim().substring(0, 120);
        if (href.toLowerCase().includes('pdf') || text.toLowerCase().includes('publication') || text.toLowerCase().includes('daily')) {
          allLinks.push(`${text} -> ${href}`);
        }
      });

      return res.status(404).json({
        success: false,
        error: `No PDF found for date ${date} on the publications page. The publication may not be available for this date yet.`,
        hint: 'Try a recent weekday date. Publications are typically posted on business days.',
        available_links: allLinks.slice(0, 25),
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

    console.log(`Found PDF URL: ${pdfUrl}`);

    // Step 2: Download and parse the PDF
    const pdfResponse = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 60000,
    });

    const pdfBuffer = Buffer.from(pdfResponse.data);
    const pdfData = await pdf(pdfBuffer);
    
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
      lastUpdated: new Date().toISOString(),
      entries: cleanEntries
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
