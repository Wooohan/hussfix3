import React, { useState } from 'react';
import { Search, Eye, X, MapPin, Phone, Mail, Hash, Truck, Calendar, ShieldCheck, Download, ShieldAlert, Activity, Info, Globe, Map as MapIcon, Boxes, Shield, ExternalLink, CheckCircle2, AlertTriangle, Zap, Loader2, ChevronDown, ChevronUp, Clock, Filter } from 'lucide-react';
import { CarrierData } from '../types';
import { downloadCSV } from '../services/mockService';
import { CarrierFilters } from '../services/supabaseClient';

interface CarrierSearchProps {
  carriers: CarrierData[];
  onSearch: (filters: CarrierFilters) => void;
  isLoading: boolean;
  onNavigateToInsurance: () => void;
}

// ... (US_STATES, OPERATION_CLASSIFICATIONS, CARRIER_OPERATIONS, CARGO_TYPES, INSURANCE_REQUIRED_TYPES remain same)
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
    const ageDate = new Date(diffMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  } catch (e) { return null; }
};

const MultiSelect: React.FC<{ options: string[]; selected: string[]; onChange: (vals: string[]) => void; placeholder?: string; }> = ({ options, selected, onChange, placeholder = 'All' }) => {
  const [open, setOpen] = useState(false);
  const toggle = (val: string) => { onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]); };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 flex items-center justify-between">
        <span className={selected.length === 0 ? 'text-slate-500' : 'text-white truncate'}>{selected.length === 0 ? placeholder : selected.join(', ')}</span>
        {open ? <ChevronUp size={14} className="shrink-0 ml-1" /> : <ChevronDown size={14} className="shrink-0 ml-1" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-sm text-slate-300">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-indigo-500" />
              {opt}
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

const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-1">{children}</label>
);

const FilterSelect: React.FC<{ name: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[] }> = ({ name, value, onChange, options }) => (
  <select name={name} value={value} onChange={onChange} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const MinMaxInputs: React.FC<{ nameMin: string; nameMax: string; valueMin: string; valueMax: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; }> = ({ nameMin, nameMax, valueMin, valueMax, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <input type="number" name={nameMin} value={valueMin} onChange={onChange} placeholder="Min" min={0} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
    <input type="number" name={nameMax} value={valueMax} onChange={onChange} placeholder="Max" min={0} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
  </div>
);

export const CarrierSearch: React.FC<CarrierSearchProps> = ({ carriers, onSearch, isLoading, onNavigateToInsurance }) => {
  const [mcSearchTerm, setMcSearchTerm] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    active: '', state: [] as string[], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '', hasEmail: '', hasBoc3: '', hasCompanyRep: '',
    classification: [] as string[], carrierOperation: [] as string[], hazmat: '', powerUnitsMin: '', powerUnitsMax: '', driversMin: '', driversMax: '', cargo: [] as string[],
    insuranceRequired: [] as string[], bipdMin: '', bipdMax: '', bipdOnFile: '', cargoOnFile: '', bondOnFile: '',
    oosMin: '', oosMax: '', crashesMin: '', crashesMax: '', injuriesMin: '', injuriesMax: '', fatalitiesMin: '', fatalitiesMax: '', towawayMin: '', towawayMax: '', inspectionsMin: '', inspectionsMax: '',
  });

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const applyFilters = () => {
    const f: CarrierFilters = {};
    if (mcSearchTerm.trim()) f.mcNumber = mcSearchTerm.trim();
    if (nameSearchTerm.trim()) f.legalName = nameSearchTerm.trim();
    if (filters.dot.trim()) f.dotNumber = filters.dot.trim();
    if (filters.active) f.active = filters.active;
    if (filters.state.length > 0) f.state = filters.state.join('|');
    if (filters.hasEmail) f.hasEmail = filters.hasEmail;
    if (filters.hasBoc3) f.hasBoc3 = filters.hasBoc3;
    if (filters.hasCompanyRep) f.hasCompanyRep = filters.hasCompanyRep;
    if (filters.yearsInBusinessMin) f.yearsInBusinessMin = parseInt(filters.yearsInBusinessMin);
    if (filters.yearsInBusinessMax) f.yearsInBusinessMax = parseInt(filters.yearsInBusinessMax);
    if (filters.classification.length > 0) f.classification = filters.classification;
    if (filters.carrierOperation.length > 0) f.carrierOperation = filters.carrierOperation;
    if (filters.hazmat) f.hazmat = filters.hazmat;
    if (filters.powerUnitsMin) f.powerUnitsMin = parseInt(filters.powerUnitsMin);
    if (filters.powerUnitsMax) f.powerUnitsMax = parseInt(filters.powerUnitsMax);
    if (filters.driversMin) f.driversMin = parseInt(filters.driversMin);
    if (filters.driversMax) f.driversMax = parseInt(filters.driversMax);
    if (filters.cargo.length > 0) f.cargo = filters.cargo;
    if (filters.insuranceRequired.length > 0) f.insuranceRequired = filters.insuranceRequired;
    if (filters.bipdMin) f.bipdMin = parseInt(filters.bipdMin);
    if (filters.bipdMax) f.bipdMax = parseInt(filters.bipdMax);
    if (filters.bipdOnFile) f.bipdOnFile = filters.bipdOnFile;
    if (filters.cargoOnFile) f.cargoOnFile = filters.cargoOnFile;
    if (filters.bondOnFile) f.bondOnFile = filters.bondOnFile;
    if (filters.oosMin) f.oosMin = parseInt(filters.oosMin);
    if (filters.oosMax) f.oosMax = parseInt(filters.oosMax);
    if (filters.crashesMin) f.crashesMin = parseInt(filters.crashesMin);
    if (filters.crashesMax) f.crashesMax = parseInt(filters.crashesMax);
    if (filters.injuriesMin) f.injuriesMin = parseInt(filters.injuriesMin);
    if (filters.injuriesMax) f.injuriesMax = parseInt(filters.injuriesMax);
    if (filters.fatalitiesMin) f.fatalitiesMin = parseInt(filters.fatalitiesMin);
    if (filters.fatalitiesMax) f.fatalitiesMax = parseInt(filters.fatalitiesMax);
    if (filters.towawayMin) f.towawayMin = parseInt(filters.towawayMin);
    if (filters.towawayMax) f.towawayMax = parseInt(filters.towawayMax);
    if (filters.inspectionsMin) f.inspectionsMin = parseInt(filters.inspectionsMin);
    if (filters.inspectionsMax) f.inspectionsMax = parseInt(filters.inspectionsMax);
    onSearch(f);
  };

  const resetAll = () => {
    setMcSearchTerm('');
    setNameSearchTerm('');
    setFilters({ active: '', state: [], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '', hasEmail: '', hasBoc3: '', hasCompanyRep: '', classification: [], carrierOperation: [], hazmat: '', powerUnitsMin: '', powerUnitsMax: '', driversMin: '', driversMax: '', cargo: [], insuranceRequired: [], bipdMin: '', bipdMax: '', bipdOnFile: '', cargoOnFile: '', bondOnFile: '', oosMin: '', oosMax: '', crashesMin: '', crashesMax: '', injuriesMin: '', injuriesMax: '', fatalitiesMin: '', fatalitiesMax: '', towawayMin: '', towawayMax: '', inspectionsMin: '', inspectionsMax: '', });
    onSearch({});
  };

  const selectedCarrier = selectedDot ? carriers.find(c => c.dotNumber === selectedDot) : null;
  const yesNoOptions = [{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
  const yesNoNumOptions = [{ value: '', label: 'Any' }, { value: '1', label: 'Yes' }, { value: '0', label: 'No' }];

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col overflow-hidden relative selection:bg-indigo-500/30">
      {/* Header and Search remain same as provided... */}
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

      <div className="flex gap-3 mb-4">
        <div className="relative group w-52 shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors"><Hash size={16} /></div>
          <input type="text" placeholder="Search MC#..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-9 pr-3 py-3 text-white text-sm focus:border-indigo-500 outline-none shadow-xl" value={mcSearchTerm} onChange={(e) => setMcSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <div className="flex-1 relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors"><Search size={18} /></div>
          <input type="text" placeholder="Search by Business Name..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-white text-sm focus:border-indigo-500 outline-none shadow-xl" value={nameSearchTerm} onChange={(e) => setNameSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={`px-5 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 border text-sm ${showFilters ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}><Zap size={16} className={showFilters ? 'fill-white' : ''} /> {showFilters ? 'Hide Filters' : 'Advanced Filters'}</button>
        <button onClick={applyFilters} disabled={isLoading} className="px-7 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-2xl font-bold transition-all shadow-lg active:scale-95 flex items-center gap-2 text-sm">{isLoading ? <><Loader2 size={16} className="animate-spin" /> Searching...</> : <><Search size={16} /> Search</>}</button>
      </div>

      {/* Advanced Filter Panel and Table remain same... */}
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
            <tbody>
              {carriers.map((carrier, idx) => (
                <tr key={idx} className="hover:bg-indigo-500/5 transition-colors group cursor-pointer" onClick={() => setSelectedDot(carrier.dotNumber)}>
                  <td className="p-4 font-mono text-indigo-400 font-bold">{carrier.mcNumber}</td>
                  <td className="p-4 font-bold text-white truncate max-w-[250px]">{carrier.legalName}</td>
                  <td className="p-4 font-mono text-slate-400">{carrier.dotNumber}</td>
                  <td className="p-4">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-black border ${carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                      {carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <button className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-xl transition-all"><Eye size={18} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAILED MODAL POPUP */}
      {selectedCarrier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900 border-2 border-slate-700/50 w-full max-w-7xl max-h-[95vh] rounded-[3rem] shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in duration-300">
            
            {/* Modal Header */}
            <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-850/30 flex justify-between items-center">
              <div className="flex gap-4 md:gap-8 items-center">
                <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white"><Truck size={24} /></div>
                <div>
                  <div className="flex flex-wrap items-center gap-4 mb-1">
                    <h2 className="text-xl md:text-3xl font-black text-white uppercase tracking-tighter truncate max-w-[700px]">{selectedCarrier.legalName}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border-2 ${selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>{selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'Unauthorized' : 'Active Authority'}</span>
                  </div>
                  <p className="text-sm text-slate-400 font-medium italic opacity-60">{selectedCarrier.dbaName || 'No Registered DBA'}</p>
                </div>
              </div>
              <button onClick={() => setSelectedDot(null)} className="p-3 text-slate-500 hover:text-white hover:bg-slate-800 rounded-2xl transition-all"><X size={28} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-slate-900/40">
              
              {/* TOP ROW: Identification, Contact, Compliance */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Hash size={14} className="text-indigo-400" /> Identification</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">MC/MX Number</span><span className="text-base font-black text-indigo-400 font-mono">{selectedCarrier.mcNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">USDOT Number</span><span className="text-base font-black text-white font-mono">{selectedCarrier.dotNumber}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Phone size={14} className="text-indigo-400" /> Contact Info</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3"><Phone size={14} className="text-indigo-400" /><span className="text-sm font-black text-white">{selectedCarrier.phone || 'N/A'}</span></div>
                    <div className="flex items-center gap-3"><Mail size={14} className="text-indigo-400" /><span className="text-sm font-black text-indigo-300 truncate">{selectedCarrier.email || 'None Registered'}</span></div>
                    <div className="flex items-center gap-3"><MapPin size={14} className="text-indigo-400" /><span className="text-[11px] font-bold text-slate-300 leading-tight">{selectedCarrier.physicalAddress}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Calendar size={14} className="text-indigo-400" /> Compliance</h3>
                  <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                    <div className="flex justify-between items-start mb-1"><span className="text-[9px] text-slate-500 font-black uppercase">MCS-150 Date</span><span className="text-[10px] font-black text-emerald-400 uppercase">{calculateYearsInBusiness(selectedCarrier.mcs150Date)} Years</span></div>
                    <span className="text-sm font-black text-white">{selectedCarrier.mcs150Date || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* MIDDLE ROW: Operation Information, Verified L&I Filings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 space-y-6 shadow-xl">
                  <div className="flex items-center gap-3"><Truck size={20} className="text-indigo-400" /><h4 className="text-xl font-black text-white uppercase tracking-tight">Operation Information</h4></div>
                  <div className="space-y-4">
                    <div><h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Operating Territory</h5><div className="flex flex-wrap gap-2">{selectedCarrier.carrierOperation?.map((op, idx) => (<span key={idx} className="bg-indigo-500/10 text-indigo-300 px-3 py-1 rounded-lg border border-indigo-500/20 font-bold text-[10px] uppercase">{op}</span>))}</div></div>
                    <div><h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Cargo Carried</h5><div className="grid grid-cols-2 gap-2">{selectedCarrier.cargoCarried?.slice(0, 4).map((cargo, idx) => (<div key={idx} className="bg-slate-900/50 border border-slate-800 p-2 rounded-xl flex items-center gap-2 text-[10px] font-bold text-slate-300"><Truck size={12} className="text-slate-600" />{cargo}</div>))}</div></div>
                  </div>
                </div>
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 space-y-6 shadow-xl">
                  <div className="flex items-center gap-3"><ShieldCheck size={20} className="text-emerald-400" /><h4 className="text-xl font-black text-white uppercase tracking-tight">Verified L&I Filings</h4></div>
                  <div className="space-y-3">{selectedCarrier.insurancePolicies?.map((p, i) => (
                    <div key={i} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex justify-between items-center group">
                      <div><span className="text-[9px] font-black text-indigo-400 uppercase block mb-1">{p.type}</span><span className="text-xs font-black text-white group-hover:text-indigo-300 transition-colors uppercase">{p.carrier}</span></div>
                      <span className="text-sm font-black text-white bg-slate-850 px-3 py-1 rounded-lg border border-slate-800">{p.coverageAmount}</span>
                    </div>
                  ))}</div>
                </div>
              </div>

              {/* BOTTOM ROW: Inspection History (Specific UI) & Safety Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* REBUILT INSPECTION HISTORY UI */}
                <div className="bg-white rounded-[2.5rem] shadow-xl overflow-hidden flex flex-col min-h-[500px]">
                  <div className="p-6 border-b border-slate-100 flex items-center gap-3">
                    <Clock size={20} className="text-indigo-950" />
                    <h4 className="text-xl font-bold text-indigo-950">Inspections & Crashes</h4>
                  </div>
                  
                  {/* Toggle Pill */}
                  <div className="px-6 py-4">
                    <div className="bg-slate-100 p-1 rounded-xl flex">
                      <button className="flex-1 bg-white text-slate-900 font-bold text-sm py-2 rounded-lg shadow-sm">Inspections</button>
                      <button className="flex-1 text-slate-500 font-bold text-sm py-2">Crashes</button>
                    </div>
                  </div>

                  {/* Summary Stat Boxes */}
                  <div className="px-6 grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">Total</span>
                      <span className="text-xl font-bold text-indigo-950">{selectedCarrier.inspections?.length || 0}</span>
                    </div>
                    <div className="bg-blue-50/30 p-4 rounded-2xl border border-blue-100 shadow-sm">
                      <span className="text-[11px] font-bold text-indigo-400 block mb-1">Violations</span>
                      <span className="text-xl font-bold text-indigo-500">{selectedCarrier.inspections?.reduce((acc, curr) => acc + (parseInt(curr.oosViolations) || 0), 0)}</span>
                    </div>
                    <div className="bg-red-50/30 p-4 rounded-2xl border border-red-100 shadow-sm">
                      <span className="text-[11px] font-bold text-red-400 block mb-1">OOS</span>
                      <span className="text-xl font-bold text-red-500">2</span>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">Crashes</span>
                      <span className="text-xl font-bold text-indigo-950">0</span>
                    </div>
                  </div>

                  {/* Recent Inspections List */}
                  <div className="flex-1 px-6 pb-6 overflow-y-auto custom-scrollbar-light space-y-4">
                    <div className="flex items-center justify-between sticky top-0 bg-white py-2 z-10">
                      <div className="flex items-center gap-2">
                        <Activity size={16} className="text-slate-400" />
                        <span className="text-sm font-bold text-slate-900 uppercase tracking-tight">Recent Inspections</span>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                        <span className="text-[10px] font-bold text-indigo-500">With Violations</span>
                        <X size={12} className="text-slate-400" />
                      </div>
                    </div>

                    {selectedCarrier.inspections?.map((insp, idx) => (
                      <div key={idx} className="relative group/insp">
                        {/* THE INSPECTION CARD */}
                        <div className="p-4 bg-white border border-slate-200 rounded-3xl shadow-sm hover:shadow-md transition-all cursor-pointer">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-sm font-black text-indigo-950 block">{insp.date}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase">{insp.location} - Level I</span>
                            </div>
                            <div className="flex gap-2">
                               <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-[10px] font-bold border border-orange-200">{insp.oosViolations} Violations</span>
                               {idx === 0 && <span className="bg-red-50 text-red-500 px-3 py-1 rounded-full text-[10px] font-bold border border-red-100 uppercase">OOS</span>}
                            </div>
                          </div>
                          
                          {/* Inner Detailed Box matching image */}
                          <div className="mt-4 pt-4 border-t border-slate-50 grid grid-cols-3 gap-y-4 text-[10px]">
                            <div><span className="text-slate-400 font-bold block mb-1">Report #:</span><span className="text-indigo-950 font-black">{insp.reportNumber}</span></div>
                            <div><span className="text-slate-400 font-bold block mb-1">Location:</span><span className="text-indigo-950 font-black">02</span></div>
                            <div><span className="text-slate-400 font-bold block mb-1">OOS Violations:</span><span className="text-indigo-950 font-black">{insp.oosViolations}</span></div>
                            <div><span className="text-slate-400 font-bold block mb-1">Driver Violations:</span><span className="text-indigo-950 font-black">{insp.driverViolations}</span></div>
                            <div><span className="text-slate-400 font-bold block mb-1">Vehicle Violations:</span><span className="text-indigo-950 font-black">{insp.vehicleViolations}</span></div>
                            <div><span className="text-slate-400 font-bold block mb-1">Hazmat Violations:</span><span className="text-indigo-950 font-black">{insp.hazmatViolations}</span></div>
                          </div>
                        </div>

                        {/* HOVER VIOLATION LIST POPUP */}
                        <div className="invisible group-hover/insp:visible opacity-0 group-hover/insp:opacity-100 absolute left-[102%] top-0 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-[110] transition-all transform scale-95 group-hover/insp:scale-100">
                          <h5 className="text-[10px] font-black text-slate-400 uppercase mb-3 flex items-center gap-2 border-b border-slate-50 pb-2">
                            <AlertTriangle size={12} className="text-orange-500" /> Detailed Violation List
                          </h5>
                          <div className="space-y-3">
                            {/* Sample items - usually you'd use selectedCarrier.inspections[idx].violationList */}
                            {[1, 2].map((v) => (
                              <div key={v} className="flex gap-2">
                                <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1 shrink-0" />
                                <p className="text-[11px] font-bold text-slate-600 leading-snug">
                                  392.16 - Failing to use seat belt while operating a CMV.
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SAFETY INFORMATION BLOCK */}
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col gap-6 shadow-xl">
                   <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3"><ShieldCheck size={20} className="text-indigo-400" /><h4 className="text-xl font-black text-white uppercase tracking-tight">Safety Information</h4></div>
                    <a href={`https://ai.fmcsa.dot.gov/SMS/Carrier/${selectedCarrier.dotNumber}/CompleteProfile.aspx`} target="_blank" className="text-[10px] font-bold text-indigo-400 flex items-center gap-1 hover:text-white transition-colors"><ExternalLink size={12} /> Source</a>
                  </div>
                  {selectedCarrier.safetyRating ? (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4 bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                        <CheckCircle2 size={32} className="text-emerald-400" />
                        <div><p className="text-lg font-black text-white uppercase leading-none mb-1">{selectedCarrier.safetyRating}</p><p className="text-[10px] text-slate-500 font-mono">DATE: {selectedCarrier.safetyRatingDate}</p></div>
                      </div>
                      <div className="space-y-3">
                        {selectedCarrier.oosRates?.map((oos, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-slate-500">{oos.type} Rate</span><span className="text-emerald-400">{oos.rate}</span></div>
                            <div className="w-full bg-slate-800 rounded-full h-1"><div className="h-full bg-emerald-500 rounded-full" style={{ width: oos.rate }} /></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40"><ShieldAlert size={48} className="mb-4 text-indigo-500" /><p className="text-xs font-black uppercase text-slate-500">No Safety Data Available</p></div>
                  )}
                </div>

              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 md:p-8 bg-slate-950/70 border-t border-slate-800 flex justify-end gap-4">
              <button onClick={() => setSelectedDot(null)} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold border border-slate-700 active:scale-95 transition-all">Close View</button>
              <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black shadow-xl flex items-center gap-2 active:scale-95 transition-all"><Download size={18} /> Download Intel Report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
