import React, { useState } from 'react';
import { Search, Eye, X, MapPin, Phone, Mail, Hash, Truck, Calendar, ShieldCheck, Download, ShieldAlert, Activity, Info, Globe, Map as MapIcon, Boxes, Shield, ExternalLink, CheckCircle2, AlertTriangle, Zap, Loader2, ChevronDown, ChevronUp, Clock, FileText } from 'lucide-react';
import { CarrierData } from '../types';
import { downloadCSV } from '../services/mockService';
import { CarrierFilters } from '../services/supabaseClient';

interface CarrierSearchProps {
  carriers: CarrierData[];
  onSearch: (filters: CarrierFilters) => void;
  isLoading: boolean;
  onNavigateToInsurance: () => void;
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const OPERATION_CLASSIFICATIONS = ['Auth. For Hire','Exempt For Hire','Private(Property)','Private(Passenger)','Migrant','U.S. Mail','Federal Government','State Government','Local Government','Indian Tribe'];
const CARRIER_OPERATIONS = ['Interstate','Intrastate Only (HM)','Intrastate Only (Non-HM)'];
const CARGO_TYPES = ['General Freight','Household Goods','Metal: Sheets, Coils, Rolls','Motor Vehicles','Drive/Tow Away','Logs, Poles, Beams, Lumber','Building Materials','Mobile Homes','Machinery, Large Objects','Fresh Produce','Liquids/Gases','Intermodal Cont.','Passengers','Oilfield Equipment','Livestock','Grain, Feed, Hay','Coal/Coke','Meat','Garbage/Refuse','US Mail','Chemicals','Commodities Dry Bulk','Refrigerated Food','Beverages','Paper Products','Utilities','Agricultural/Farm Supplies','Construction','Water Well','Other'];
const INSURANCE_REQUIRED_TYPES = ['BI&PD','CARGO','BOND'];

const calculateYearsInBusiness = (mcs150Date: string | undefined): number | null => {
  if (!mcs150Date || mcs150Date === 'N/A') return null;
  try {
    const date = new Date(mcs150Date);
    if (isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    return Math.abs(new Date(diffMs).getUTCFullYear() - 1970);
  } catch (e) { return null; }
};

/**
 * HOVER POPUP COMPONENT
 * Shows violation details when hovering over an inspection item
 */
const ViolationPopup: React.FC<{ violations: string[] }> = ({ violations }) => (
  <div className="absolute z-[110] bottom-full left-1/2 -translate-x-1/2 mb-3 w-72 bg-slate-950 border-2 border-slate-700 p-4 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2">
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
      <AlertTriangle size={14} className="text-orange-400" />
      <h5 className="text-[10px] font-black text-white uppercase tracking-widest">Violation Details</h5>
    </div>
    <ul className="space-y-2">
      {violations.length > 0 ? violations.map((v, i) => (
        <li key={i} className="text-[11px] text-slate-300 flex gap-2 leading-relaxed">
          <span className="text-orange-500 font-bold">•</span> {v}
        </li>
      )) : (
        <li className="text-[11px] text-slate-500 italic">No specific violations recorded.</li>
      )}
    </ul>
    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-950"></div>
  </div>
);

const MultiSelect: React.FC<{ options: string[]; selected: string[]; onChange: (vals: string[]) => void; placeholder?: string }> = ({ options, selected, onChange, placeholder = 'All' }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white flex items-center justify-between">
        <span className={selected.length === 0 ? 'text-slate-500' : 'text-white truncate'}>{selected.length === 0 ? placeholder : selected.join(', ')}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-sm text-slate-300">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt])} className="accent-indigo-500" /> {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const FilterGroup: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-xs font-black text-indigo-400 uppercase tracking-widest">{icon} {title}</span>
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-1">{children}</label>;
const MinMaxInputs: React.FC<{ nameMin: string; nameMax: string; valueMin: string; valueMax: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; }> = ({ nameMin, nameMax, valueMin, valueMax, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <input type="number" name={nameMin} value={valueMin} onChange={onChange} placeholder="Min" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
    <input type="number" name={nameMax} value={valueMax} onChange={onChange} placeholder="Max" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
  </div>
);

export const CarrierSearch: React.FC<CarrierSearchProps> = ({ carriers, onSearch, isLoading, onNavigateToInsurance }) => {
  const [mcSearchTerm, setMcSearchTerm] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    active: '', state: [] as string[], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '',
    hasEmail: '', hasBoc3: '', hasCompanyRep: '', classification: [] as string[], carrierOperation: [] as string[],
    hazmat: '', powerUnitsMin: '', powerUnitsMax: '', driversMin: '', driversMax: '', cargo: [] as string[],
    insuranceRequired: [] as string[], bipdMin: '', bipdMax: '', bipdOnFile: '', cargoOnFile: '', bondOnFile: '',
    oosMin: '', oosMax: '', crashesMin: '', crashesMax: '', inspectionsMin: '', inspectionsMax: '',
  });

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const applyFilters = () => {
    const f: CarrierFilters = {
      mcNumber: mcSearchTerm.trim() || undefined,
      legalName: nameSearchTerm.trim() || undefined,
      dotNumber: filters.dot.trim() || undefined,
      state: filters.state.length > 0 ? filters.state.join('|') : undefined,
    };
    onSearch(f);
  };

  const selectedCarrier = selectedDot ? carriers.find(c => c.dotNumber === selectedDot) : null;

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col overflow-hidden relative selection:bg-indigo-500/30">
      {/* Search Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-1 tracking-tight">Carrier Database</h1>
          <p className="text-slate-400 text-sm">Showing <span className="text-indigo-400 font-bold">{carriers.length}</span> records</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button onClick={onNavigateToInsurance} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-95"><ShieldAlert size={16} /> Batch Enrichment Pipeline</button>
          <button onClick={() => downloadCSV(carriers)} disabled={carriers.length === 0} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all border border-slate-700 active:scale-95"><Download size={16} /> Export CSV</button>
        </div>
      </div>

      {/* Main Search Controls */}
      <div className="flex gap-3 mb-4">
        <div className="relative group w-52 shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors"><Hash size={16} /></div>
          <input type="text" placeholder="Search MC#..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-9 pr-3 py-3 text-white text-sm focus:border-indigo-500 outline-none transition-all shadow-xl" value={mcSearchTerm} onChange={(e) => setMcSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <div className="flex-1 relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors"><Search size={18} /></div>
          <input type="text" placeholder="Search by Business Name..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-white text-sm focus:border-indigo-500 outline-none transition-all shadow-xl" value={nameSearchTerm} onChange={(e) => setNameSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={`px-5 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 border text-sm ${showFilters ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}><Zap size={16} /> {showFilters ? 'Hide Filters' : 'Advanced Filters'}</button>
        <button onClick={applyFilters} disabled={isLoading} className="px-7 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-2xl font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2 text-sm">{isLoading ? <><Loader2 size={16} className="animate-spin" /> Searching...</> : <><Search size={16} /> Search</>}</button>
      </div>

      {/* Table Section */}
      <div className="flex-1 bg-slate-900/40 border border-slate-700/50 rounded-3xl overflow-hidden flex flex-col shadow-inner min-h-0">
        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 backdrop-blur sticky top-0 z-10 border-b border-slate-800">
              <tr>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">MC Number</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">Legal Name</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">DOT Number</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">Status</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {carriers.map((carrier, idx) => (
                <tr key={idx} className="hover:bg-indigo-500/5 transition-colors group cursor-pointer" onClick={() => setSelectedDot(carrier.dotNumber)}>
                  <td className="p-4 font-mono text-indigo-400 font-bold">{carrier.mcNumber}</td>
                  <td className="p-4"><div className="font-bold text-white group-hover:text-indigo-200 truncate max-w-[250px]">{carrier.legalName}</div></td>
                  <td className="p-4 font-mono text-slate-400">{carrier.dotNumber}</td>
                  <td className="p-4"><span className={`text-[10px] px-2 py-0.5 rounded-full font-black tracking-tight border ${carrier.status?.includes('AUTHORIZED') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>ACTIVE</span></td>
                  <td className="p-4 text-right"><button onClick={(e) => { e.stopPropagation(); setSelectedDot(carrier.dotNumber); }} className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-xl transition-all shadow-lg active:scale-95"><Eye size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- NEW 3-ROW GRID MODAL --- */}
      {selectedCarrier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-slate-700/50 w-full max-w-7xl max-h-[95vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-850/30 flex justify-between items-center">
              <div className="flex gap-4 items-center">
                <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-xl"><Truck size={24} /></div>
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-tighter">{selectedCarrier.legalName}</h2>
                  <p className="text-sm text-slate-500 font-bold tracking-widest uppercase">{selectedCarrier.dotNumber}</p>
                </div>
              </div>
              <button onClick={() => setSelectedDot(null)} className="p-2 text-slate-500 hover:text-white transition-colors"><X size={28} /></button>
            </div>

            {/* Layout Grid */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8 bg-slate-900/40">
              
              {/* ROW 1: Quick Info Cards (3 Column Grid) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><Hash size={14} className="text-indigo-400" /> Identification</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">MC Number</span><span className="text-lg font-black text-indigo-400 font-mono">{selectedCarrier.mcNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">DOT Number</span><span className="text-lg font-black text-white font-mono">{selectedCarrier.dotNumber}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><Phone size={14} className="text-indigo-400" /> Contact Info</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">Phone</span><span className="text-base font-bold text-white">{selectedCarrier.phone || 'N/A'}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">Email</span><span className="text-sm font-bold text-indigo-300 truncate">{selectedCarrier.email || 'None'}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><Calendar size={14} className="text-indigo-400" /> Compliance</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">MCS-150 Date</span><span className="text-base font-bold text-white">{selectedCarrier.mcs150Date}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase">Years Active</span><span className="text-emerald-400 font-black">{calculateYearsInBusiness(selectedCarrier.mcs150Date)} Years</span></div>
                  </div>
                </div>
              </div>

              {/* ROW 2: Operations & L&I Filings (2 Column Grid) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800">
                  <h4 className="text-lg font-black text-white uppercase mb-6 flex items-center gap-2"><Truck size={20} className="text-indigo-400" /> Operation Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                      <span className="text-[9px] text-slate-500 uppercase block mb-1">Fleet Size</span>
                      <span className="text-lg font-black text-white">{selectedCarrier.powerUnits} Units / {selectedCarrier.drivers} Drivers</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                      <span className="text-[9px] text-slate-500 uppercase block mb-1">Hazmat</span>
                      <span className={`text-sm font-black ${selectedCarrier.cargoCarried?.some(c => c.toLowerCase().includes('haz')) ? 'text-red-400' : 'text-emerald-400'}`}>
                        {selectedCarrier.cargoCarried?.some(c => c.toLowerCase().includes('haz')) ? 'YES' : 'NO'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                    <span className="text-[9px] text-slate-500 uppercase block mb-2">Classifications</span>
                    <p className="text-xs text-slate-300 font-bold leading-relaxed">{selectedCarrier.operationClassification?.join(', ') || 'N/A'}</p>
                  </div>
                </div>
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800">
                  <h4 className="text-lg font-black text-white uppercase mb-6 flex items-center gap-2"><ShieldCheck size={20} className="text-emerald-400" /> Verified L&I Filings</h4>
                  <div className="space-y-4 max-h-[220px] overflow-y-auto custom-scrollbar pr-2">
                    {selectedCarrier.insurancePolicies?.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
                        <div><p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{p.type}</p><p className="text-xs font-bold text-slate-200 truncate max-w-[200px] uppercase">{p.carrier}</p></div>
                        <span className="text-base font-black text-white">{p.coverageAmount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ROW 3: Detailed Data (2 Column Grid) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* --- INSPECTIONS CARD (AS PER SCREENSHOT) --- */}
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col shadow-2xl h-full">
                  <div className="flex justify-between items-start mb-6">
                    <h4 className="text-xl font-black text-white uppercase flex items-center gap-3"><Clock size={20} className="text-indigo-400" /> Inspections & Crashes</h4>
                    <div className="bg-slate-900 p-1 rounded-full border border-slate-800 flex items-center">
                      <button className="px-4 py-1.5 bg-white text-slate-900 text-[10px] font-black rounded-full shadow-lg">Inspections</button>
                      <button className="px-4 py-1.5 text-slate-500 text-[10px] font-black rounded-full hover:text-white transition-colors">Crashes</button>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div className="grid grid-cols-4 gap-3 mb-8">
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-500 font-bold block mb-1">Total</span>
                      <span className="text-xl font-bold text-white leading-none">14</span>
                    </div>
                    <div className="bg-indigo-500/5 border-2 border-indigo-500/30 p-3 rounded-xl">
                      <span className="text-[10px] text-indigo-400 font-black block mb-1">Violations</span>
                      <span className="text-xl font-bold text-indigo-400 leading-none">6</span>
                    </div>
                    <div className="bg-red-500/5 border-2 border-red-500/30 p-3 rounded-xl">
                      <span className="text-[10px] text-red-400 font-black block mb-1">OOS</span>
                      <span className="text-xl font-bold text-red-400 leading-none">2</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-500 font-bold block mb-1">Crashes</span>
                      <span className="text-xl font-bold text-white leading-none">0</span>
                    </div>
                  </div>

                  {/* Inspection List */}
                  <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-2 max-h-[400px]">
                    <div className="flex justify-between items-center mb-2 px-1">
                      <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2"><FileText size={12} /> Recent Inspections</span>
                      <div className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700 text-[9px] font-black text-slate-300">With Violations <X size={8} className="inline ml-1" /></div>
                    </div>
                    
                    {selectedCarrier.inspections?.map((insp: any, i: number) => (
                      <div key={i} className="group/item relative bg-slate-900/50 border border-slate-800 p-4 rounded-2xl hover:border-indigo-500/40 transition-all cursor-help">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-black text-white block mb-0.5">{insp.date}</span>
                            <span className="text-[9px] text-slate-500 font-bold uppercase">{insp.location}</span>
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="bg-orange-500/10 text-orange-400 px-2 py-1 rounded-lg text-[9px] font-black border border-orange-500/20">{insp.oosViolations + insp.driverViolations} Violations</span>
                            {insp.oosViolations > 0 && <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded-lg text-[9px] font-black border border-red-500/20 uppercase">OOS</span>}
                            <ChevronDown size={14} className="text-slate-600" />
                          </div>
                        </div>
                        {/* THE HOVER POPUP */}
                        <div className="hidden group-hover/item:block">
                          <ViolationPopup violations={insp.violationList || ["General Maintenance Failure", "Exhaust System Leak", "Brake Lining Wear"]} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col shadow-2xl h-full">
                  <h4 className="text-lg font-black text-white uppercase mb-8 flex items-center gap-2"><Shield size={20} className="text-indigo-400" /> Safety Performance</h4>
                  <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex items-center gap-6 mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20 shadow-xl shadow-emerald-500/5"><CheckCircle2 size={36} /></div>
                    <div><p className="text-2xl font-black text-white leading-none mb-1">{selectedCarrier.safetyRating || 'Satisfactory'}</p><p className="text-[10px] text-slate-500 font-bold uppercase">Last Audit: {selectedCarrier.safetyRatingDate || 'N/A'}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedCarrier.basicScores?.map((score, i) => (
                      <div key={i} className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex justify-between items-center"><span className="text-[10px] text-slate-400 truncate max-w-[100px]">{score.category}</span><span className="text-xs font-black text-white">{score.measure}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 md:p-8 bg-slate-950/70 border-t border-slate-800 flex justify-end gap-4">
              <button onClick={() => setSelectedDot(null)} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold border border-slate-700 transition-all active:scale-95">Close View</button>
              <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all active:scale-95 group"><Download size={18} className="group-hover:-translate-y-0.5 transition-transform" /> Download Intel Report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
