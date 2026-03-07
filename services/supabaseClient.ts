import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Required: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ============================================================
// DATABASE TYPES
// ============================================================
export interface CarrierRecord {
  id?: string;
  mc_number: string;
  dot_number: string;
  legal_name: string;
  dba_name?: string;
  entity_type: string;
  status: string;
  email?: string;
  phone?: string;
  power_units?: string;
  drivers?: string;
  non_cmv_units?: string;
  physical_address?: string;
  mailing_address?: string;
  date_scraped: string;
  mcs150_date?: string;
  mcs150_mileage?: string;
  operation_classification?: string[];
  carrier_operation?: string[];
  cargo_carried?: string[];
  out_of_service_date?: string;
  state_carrier_id?: string;
  duns_number?: string;
  safety_rating?: string;
  safety_rating_date?: string;
  basic_scores?: any;
  oos_rates?: any;
  insurance_policies?: any;
  created_at?: string;
  updated_at?: string;
}

export interface CarrierFilters {
  mcNumber?: string;
  dotNumber?: string;
  legalName?: string;
  active?: string;           // 'true' | 'false' | ''
  state?: string;
  hasEmail?: string;         // 'true' | 'false' | ''
  hasBoc3?: string;          // 'true' | 'false' | ''
  hasCompanyRep?: string;    // 'true' | 'false' | ''
  yearsInBusinessMin?: number;
  yearsInBusinessMax?: number;
  classification?: string[];
  carrierOperation?: string[];
  hazmat?: string;           // 'true' | 'false' | ''
  powerUnitsMin?: number;
  powerUnitsMax?: number;
  driversMin?: number;
  driversMax?: number;
  cargo?: string[];
  insuranceRequired?: string[];
  bipdMin?: number;
  bipdMax?: number;
  bipdOnFile?: string;       // '1' | '0' | ''
  cargoOnFile?: string;      // '1' | '0' | ''
  bondOnFile?: string;       // '1' | '0' | ''
  limit?: number;
}

// ============================================================
// SAVE / UPSERT OPERATIONS
// ============================================================

/**
 * Save a single carrier to Supabase
 */
export const saveCarrierToSupabase = async (
  carrier: any
): Promise<{ success: boolean; error?: string; data?: any }> => {
  try {
    if (!carrier.mcNumber || !carrier.dotNumber || !carrier.legalName) {
      return {
        success: false,
        error: 'Missing required fields: mcNumber, dotNumber, or legalName',
      };
    }

    const record: CarrierRecord = {
      mc_number: carrier.mcNumber,
      dot_number: String(carrier.dotNumber),
      legal_name: carrier.legalName,
      dba_name: carrier.dbaName || null,
      entity_type: carrier.entityType,
      status: carrier.status,
      email: carrier.email || null,
      phone: carrier.phone || null,
      power_units: carrier.powerUnits || null,
      drivers: carrier.drivers || null,
      non_cmv_units: carrier.nonCmvUnits || null,
      physical_address: carrier.physicalAddress || null,
      mailing_address: carrier.mailingAddress || null,
      date_scraped: carrier.dateScraped,
      mcs150_date: carrier.mcs150Date || null,
      mcs150_mileage: carrier.mcs150Mileage || null,
      operation_classification: carrier.operationClassification || [],
      carrier_operation: carrier.carrierOperation || [],
      cargo_carried: carrier.cargoCarried || [],
      out_of_service_date: carrier.outOfServiceDate || null,
      state_carrier_id: carrier.stateCarrierId || null,
      duns_number: carrier.dunsNumber || null,
      safety_rating: carrier.safetyRating || null,
      safety_rating_date: carrier.safetyRatingDate || null,
      basic_scores: carrier.basicScores || null,
      oos_rates: carrier.oosRates || null,
      insurance_policies: carrier.insurancePolicies || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('carriers')
      .upsert(record, { onConflict: 'mc_number' })
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err: any) {
    console.error('❌ Exception saving to Supabase:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Save multiple carriers in batch
 */
export const saveCarriersToSupabase = async (
  carriers: any[]
): Promise<{ success: boolean; error?: string; saved: number; failed: number }> => {
  let saved = 0;
  let failed = 0;

  for (const carrier of carriers) {
    const result = await saveCarrierToSupabase(carrier);
    if (result.success) saved++;
    else {
      failed++;
      console.warn(`Failed to save carrier ${carrier.mcNumber}:`, result.error);
    }
  }

  return {
    success: failed === 0,
    saved,
    failed,
    error: failed > 0 ? `${failed} carriers failed to save` : undefined,
  };
};

// ============================================================
// UPDATE OPERATIONS (Enrichment)
// ============================================================

/**
 * Update Insurance Policies for a carrier using USDOT
 */
export const updateCarrierInsurance = async (
  dotNumber: string, 
  insuranceData: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('carriers')
      .update({
        insurance_policies: insuranceData.policies,
        updated_at: new Date().toISOString(),
        date_scraped: new Date().toLocaleDateString()
      })
      .eq('dot_number', String(dotNumber))
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return { success: false, error: `No record found with DOT ${dotNumber}` };
    }

    console.log('✅ Insurance data updated for DOT:', dotNumber);
    return { success: true };
  } catch (err: any) {
    console.error('❌ Supabase update error:', err);
    return { success: false, error: err.message || "Unknown error" };
  }
};

/**
 * Update Safety Data for a carrier using USDOT
 */
export const updateCarrierSafety = async (
  dotNumber: string, 
  safetyData: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('carriers')
      .update({
        safety_rating: safetyData.rating,
        safety_rating_date: safetyData.ratingDate,
        basic_scores: safetyData.basicScores,
        oos_rates: safetyData.oosRates,
        updated_at: new Date().toISOString(),
      })
      .eq('dot_number', String(dotNumber))
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return { success: false, error: `No record found with DOT ${dotNumber}` };
    }

    console.log('✅ Safety data updated for DOT:', dotNumber);
    return { success: true };
  } catch (err: any) {
    console.error('❌ Supabase safety update error:', err);
    return { success: false, error: err.message };
  }
};

// ============================================================
// FETCH / QUERY OPERATIONS
// ============================================================

/**
 * Fetches carriers within a specific MC Number range (Sync Engine)
 */
export const getCarriersByMCRange = async (start: string, end: string): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('carriers')
      .select('*')
      .gte('mc_number', start)
      .lte('mc_number', end)
      .order('mc_number', { ascending: true });

    if (error) throw error;

    return (data || []).map(record => ({
      mcNumber: record.mc_number,
      dotNumber: record.dot_number,
      legalName: record.legal_name,
      insurancePolicies: record.insurance_policies || [],
      status: record.status
    }));
  } catch (err) {
    console.error('❌ Error fetching MC range:', err);
    return [];
  }
};

/**
 * Advanced Filtered Fetch
 */
export const fetchCarriersFromSupabase = async (filters: CarrierFilters = {}): Promise<any[]> => {
  try {
    let query = supabase.from('carriers').select('*');

    const isFiltered = Object.keys(filters).some(k => {
      const key = k as keyof CarrierFilters;
      const val = filters[key];
      if (key === 'limit') return false;
      if (Array.isArray(val)) return val.length > 0;
      return val !== undefined && val !== '';
    });

    if (filters.mcNumber) query = query.ilike('mc_number', `%${filters.mcNumber}%`);
    if (filters.dotNumber) query = query.ilike('dot_number', `%${filters.dotNumber}%`);
    if (filters.legalName) query = query.ilike('legal_name', `%${filters.legalName}%`);
    
    if (filters.active === 'true') {
      query = query.ilike('status', '%AUTHORIZED%').not('status', 'ilike', '%NOT%');
    } else if (filters.active === 'false') {
      query = query.or('status.ilike.%NOT AUTHORIZED%,status.not.ilike.%AUTHORIZED%');
    }

    if (filters.state) {
      const states = filters.state.split('|');
      const stateOrConditions = states.map(s => `physical_address.ilike."%, ${s}%"`).join(',');
      query = query.or(stateOrConditions);
    }

    query = query.order('created_at', { ascending: false });
    query = query.limit(filters.limit || (isFiltered ? 1000 : 200));

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((record: any) => ({
      mcNumber: record.mc_number,
      dotNumber: record.dot_number,
      legalName: record.legal_name,
      dbaName: record.dba_name,
      entityType: record.entity_type,
      status: record.status,
      email: record.email,
      phone: record.phone,
      powerUnits: record.power_units,
      drivers: record.drivers,
      physicalAddress: record.physical_address,
      dateScraped: record.date_scraped,
      insurancePolicies: record.insurance_policies || [],
      basicScores: record.basic_scores || [],
      oosRates: record.oos_rates || []
    }));
  } catch (err) {
    console.error('❌ Supabase fetch error:', err);
    return [];
  }
};

// ============================================================
// UTILS
// ============================================================

export const deleteCarrier = async (mcNumber: string): Promise<{ success: boolean; error?: string }> => {
  const { error } = await supabase.from('carriers').delete().eq('mc_number', mcNumber);
  return error ? { success: false, error: error.message } : { success: true };
};

export const getCarrierCount = async (): Promise<number> => {
  const { count, error } = await supabase
    .from('carriers')
    .select('*', { count: 'exact', head: true });
  return error ? 0 : (count || 0);
};
