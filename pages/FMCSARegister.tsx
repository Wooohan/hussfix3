import React, { useState, useEffect } from 'react';
import { FileText, RefreshCw, Calendar, Search, Filter, ChevronDown, AlertCircle, Database, CheckCircle2, TrendingUp, BarChart3, Clock, ArrowRight, Download, Link2 } from 'lucide-react';
import { saveFMCSARegisterEntries, fetchFMCSARegisterByExtractedDate, getExtractedDates } from '../services/fmcsaRegisterService';

interface FMCSAPublicationEntry {
  usdot_number: string;
  legal_business_name: string;
  filing_date: string;
  mailing_address: string;
  company_officer: string;
  telephone: string;
  category: string;
}

export const FMCSARegister: React.FC = () => {
  const [publicationData, setPublicationData] = useState<FMCSAPublicationEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate());
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string>('');
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [categoryStats, setCategoryStats] = useState<Record<string, number>>({});
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  const categories = [
    'BROKER OF HOUSEHOLD GOODS',
    'BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)',
    'FREIGHT FORWARDER OF HOUSEHOLD GOODS',
    'FREIGHT FORWARDER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)',
    'MOTOR CARRIER OF HOUSEHOLD GOODS',
    'MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)',
    'MOTOR CARRIER OF PASSENGERS',
    'FITNESS-ONLY APPLICATIONS'
  ];

  function getTodayDate(): string {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  useEffect(() => {
    loadAvailableDates();
  }, []);

  useEffect(() => {
    const stats: Record<string, number> = {};
    publicationData.forEach(entry => {
      stats[entry.category] = (stats[entry.category] || 0) + 1;
    });
    setCategoryStats(stats);
  }, [publicationData]);

  const loadAvailableDates = async () => {
    try {
      const dates = await getExtractedDates();
      setAvailableDates(dates);
    } catch (err) {
      console.error('Error loading available dates:', err);
    }
  };

  /**
   * MAIN FETCH: Calls the new /api/fmcsa-publications endpoint
   * which scrapes motus.dot.gov for the PDF link, downloads & parses it
   */
  const fetchPublicationsData = async () => {
    setIsLoading(true);
    setError('');
    setDebugInfo(null);
    setPdfUrl('');
    
    try {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = isLocal ? 'http://localhost:3001/api/fmcsa-publications' : '/api/fmcsa-publications';
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate })
      });
      
      // Handle non-JSON responses (e.g., Vercel 404 HTML page)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}). The API endpoint may not be deployed yet. Response: ${text.substring(0, 100)}`);
      }
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        if (data.available_links) {
          setDebugInfo(data);
        }
        throw new Error(data.error || `Server returned ${response.status}`);
      }
      
      if (data.entries && data.entries.length > 0) {
        setPublicationData(data.entries);
        setPdfUrl(data.pdf_url || '');
        setLastUpdated(`✅ Fetched ${data.count} records from Daily FMCSA Publications (${new Date().toLocaleTimeString()})`);
        
        // Save to Supabase for future reference
        savePublicationsToSupabase(data.entries, selectedDate);
        loadAvailableDates();
      } else {
        throw new Error('No entries found in the PDF for this date.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch publications data.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Save parsed publication entries to Supabase
   */
  const savePublicationsToSupabase = async (entries: FMCSAPublicationEntry[], extractedDate: string) => {
    setSaveStatus('saving');
    try {
      // Convert to the format expected by the service
      const legacyEntries = entries.map(e => ({
        number: e.usdot_number,
        title: `${e.legal_business_name} | ${e.mailing_address}`,
        decided: e.filing_date,
        category: e.category,
        extracted_date: extractedDate,
        date_fetched: extractedDate
      }));

      const result = await saveFMCSARegisterEntries(
        legacyEntries,
        extractedDate,
        extractedDate
      );
      if (result.success) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      setSaveStatus('error');
    }
  };

  /**
   * Search from Supabase DB (previously fetched data)
   */
  const handleSearchDB = async () => {
    setIsLoading(true);
    setError('');
    setDebugInfo(null);
    try {
      const data = await fetchFMCSARegisterByExtractedDate(selectedDate, {
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        searchTerm: searchTerm || undefined
      });
      if (data && data.length > 0) {
        // Convert from legacy format
        const converted: FMCSAPublicationEntry[] = data.map(d => {
          const parts = d.title.split(' | ');
          return {
            usdot_number: d.number,
            legal_business_name: parts[0] || d.title,
            filing_date: d.decided,
            mailing_address: parts[1] || '',
            company_officer: '',
            telephone: '',
            category: d.category
          };
        });
        setPublicationData(converted);
        setLastUpdated(`✅ Loaded ${data.length} records from database`);
      } else {
        setPublicationData([]);
        setLastUpdated('');
        setError(`No data found for ${selectedDate} in database. Try "Fetch Live" to scrape fresh data.`);
      }
    } catch (err) {
      setError('Error searching database.');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter data based on category and search term
  const filteredData = publicationData.filter(entry => {
    const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
    const matchesSearch = 
      entry.legal_business_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      entry.usdot_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.mailing_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.company_officer.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Export to CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) return;
    
    const headers = ['Category', 'USDOT Number', 'Legal Business Name', 'Filing Date', 'Mailing Address', 'Company Officer', 'Telephone'];
    const csvContent = [
      headers.join(','),
      ...filteredData.map(entry => [
        `"${entry.category}"`,
        `"${entry.usdot_number}"`,
        `"${entry.legal_business_name}"`,
        `"${entry.filing_date}"`,
        `"${entry.mailing_address}"`,
        `"${entry.company_officer}"`,
        `"${entry.telephone}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fmcsa_publications_${selectedDate}.csv`;
    link.click();
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'BROKER OF HOUSEHOLD GOODS': 'text-blue-400 border-blue-500/30 bg-blue-500/10',
      'BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)': 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
      'FREIGHT FORWARDER OF HOUSEHOLD GOODS': 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      'FREIGHT FORWARDER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)': 'text-teal-400 border-teal-500/30 bg-teal-500/10',
      'MOTOR CARRIER OF HOUSEHOLD GOODS': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
      'MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)': 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
      'MOTOR CARRIER OF PASSENGERS': 'text-amber-400 border-amber-500/30 bg-amber-500/10',
      'FITNESS-ONLY APPLICATIONS': 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    };
    return colors[category] || 'text-slate-400 border-slate-500/30 bg-slate-500/10';
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-[#020617] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Top Navigation Bar */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl blur opacity-25"></div>
            <div className="relative p-3 bg-slate-900 rounded-xl border border-slate-700/50">
              <FileText className="text-indigo-400" size={28} />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">Daily FMCSA <span className="text-indigo-400">Publications</span></h1>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-widest">
              <Clock size={12} />
              <span>motus.dot.gov • Carrier Registration Monitor</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end mr-2">
            {saveStatus === 'saving' && <span className="text-[10px] text-indigo-400 animate-pulse flex items-center gap-1 font-bold"><Database size={10}/> UPLOADING</span>}
            {saveStatus === 'saved' && <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold"><CheckCircle2 size={10}/> CLOUD SYNCED</span>}
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 text-slate-300 rounded-full text-sm font-medium hover:bg-slate-700 transition-all"
            >
              <Link2 size={14} />
              View PDF
            </a>
          )}
          {filteredData.length > 0 && (
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 text-slate-300 rounded-full text-sm font-medium hover:bg-slate-700 transition-all"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}
          <button
            onClick={fetchPublicationsData}
            disabled={isLoading}
            className="group relative flex items-center gap-2 px-6 py-3 bg-white text-slate-950 rounded-full text-sm font-bold transition-all hover:bg-indigo-50 disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
            {isLoading ? 'FETCHING...' : 'FETCH LIVE'}
          </button>
        </div>
      </header>

      {/* Stats Dashboard */}
      {publicationData.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Records', val: publicationData.length, icon: TrendingUp, color: 'text-indigo-400', bg: 'bg-indigo-400/5' },
            { label: 'Active Categories', val: Object.keys(categoryStats).length, icon: BarChart3, color: 'text-purple-400', bg: 'bg-purple-400/5' },
            { label: 'Top Category', val: Object.entries(categoryStats).sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0]?.split(' ').slice(0, 3).join(' ') || 'N/A', icon: Filter, color: 'text-emerald-400', bg: 'bg-emerald-400/5', small: true },
            { label: 'Filtered Results', val: filteredData.length, icon: Search, color: 'text-amber-400', bg: 'bg-amber-400/5' },
          ].map((stat, i) => (
            <div key={i} className="group relative overflow-hidden bg-slate-900/40 border border-slate-800 rounded-2xl p-4 transition-all hover:border-slate-700 hover:bg-slate-900/60">
              <div className={`${stat.bg} ${stat.color} absolute -right-4 -top-4 p-8 rounded-full opacity-10 group-hover:scale-110 transition-transform`}></div>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mb-1">{stat.label}</p>
              <div className="flex items-end justify-between">
                <p className={`${stat.small ? 'text-lg' : 'text-2xl'} font-bold text-white tracking-tight`}>{stat.val}</p>
                <stat.icon className={`${stat.color} opacity-40`} size={20} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filtering Section */}
      <div className="bg-slate-900/30 border border-slate-800/60 rounded-3xl p-2 mb-8 backdrop-blur-md">
        <div className="grid grid-cols-1 md:grid-cols-10 gap-2">
          <div className="md:col-span-2 relative group">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400" size={16} />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-transparent rounded-2xl text-sm focus:outline-none focus:border-indigo-500/50 text-white transition-all"
            />
          </div>

          <div className="md:col-span-3 relative group">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400" size={16} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-transparent rounded-2xl text-sm appearance-none focus:outline-none focus:border-indigo-500/50 text-white transition-all"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={14} />
          </div>

          <div className="md:col-span-3 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400" size={16} />
            <input
              type="text"
              placeholder="Search USDOT #, Name, Address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-transparent rounded-2xl text-sm focus:outline-none focus:border-indigo-500/50 text-white transition-all placeholder-slate-600"
            />
          </div>

          <div className="md:col-span-2">
            <button
              onClick={handleSearchDB}
              disabled={isLoading}
              className="w-full h-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-bold transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50"
            >
              {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              SEARCH DB
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div>
            <p>{error}</p>
            {debugInfo?.available_links && debugInfo.available_links.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-rose-300 hover:text-rose-200 text-xs">Show available PDF links on page</summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                  {debugInfo.available_links.map((link: string, i: number) => (
                    <li key={i} className="font-mono break-all">{link}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
      {lastUpdated && !error && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 text-sm flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={18} /> {lastUpdated}
        </div>
      )}

      {/* Table Section */}
      <div className="flex-1 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/20 backdrop-blur-sm shadow-2xl">
        {filteredData.length > 0 ? (
          <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900/95 backdrop-blur-md">
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">USDOT #</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Legal Business Name</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Filing Date</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Mailing Address</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Officer</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Phone</th>
                  <th className="px-4 py-5 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredData.map((entry, idx) => (
                  <tr key={idx} className="group hover:bg-indigo-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-indigo-400 font-medium group-hover:text-indigo-300 transition-colors">
                        {entry.usdot_number}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-medium max-w-[200px] truncate">{entry.legal_business_name}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{entry.filing_date}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">{entry.mailing_address}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[150px] truncate">{entry.company_officer}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{entry.telephone}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all group-hover:scale-105 ${getCategoryColor(entry.category)}`}>
                        {entry.category.length > 30 ? entry.category.substring(0, 30) + '...' : entry.category}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-40">
            <div className="p-6 bg-slate-800/50 rounded-full">
              <Database size={48} className="text-slate-600" />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-400">System Ready</p>
              <p className="text-sm text-slate-500 max-w-md">
                Select a date and click "Fetch Live" to scrape the Daily FMCSA Publications PDF from motus.dot.gov, 
                or "Search DB" to look up previously fetched data.
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer Branding */}
      <footer className="mt-4 flex justify-between items-center text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em]">
        <span>Daily FMCSA Publications Parser v2.0</span>
        <span className="flex items-center gap-1"><Clock size={10} /> Source: motus.dot.gov</span>
      </footer>
    </div>
  );
};

export default FMCSARegister;
