import { createClient } from '@supabase/supabase-js';

/* ───────────────────────────────────────────────────────────── */
/* SUPABASE CLIENT */
/* ───────────────────────────────────────────────────────────── */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ───────────────────────────────────────────────────────────── */
/* DATABASE TYPES */
/* ───────────────────────────────────────────────────────────── */

export interface CarrierRecord {
  id?: string;
  mc_number: string;
  dot_number: string;
  legal_name: string;
  dba_name?: string | null;
  entity_type: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  power_units?: number | null;
  drivers?: number | null;
  non_cmv_units?: number | null;
  physical_address?: string | null;
  mailing_address?: string | null;
  date_scraped: string;
  mcs150_date?: string | null;
  mcs150_mileage?: string | null;
  operation_classification?: string[];
  carrier_operation?: string[];
  cargo_carried?: string[];
  out_of_service_date?: string | null;
  state_carrier_id?: string | null;
  duns_number?: string | null;
  safety_rating?: string | null;
  safety_rating_date?: string | null;
  basic_scores?: any;
  oos_rates?: any;
  insurance_policies?: any;
  created_at?: string;
  updated_at?: string;
}

/* ───────────────────────────────────────────────────────────── */
/* SINGLE SAVE */
/* ───────────────────────────────────────────────────────────── */

export const saveCarrierToSupabase = async (
  carrier: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!carrier.mcNumber || !carrier.dotNumber || !carrier.legalName) {
      return { success: false, error: 'Missing required fields' };
    }

    const record = mapCarrierToRecord(carrier);

    const { error } = await supabase
      .from('carriers')
      .upsert(record, { onConflict: 'mc_number' });

    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

/* ───────────────────────────────────────────────────────────── */
/* BULK SAVE (CHUNKED UPSERT) */
/* ───────────────────────────────────────────────────────────── */

export const saveCarriersToSupabase = async (
  carriers: any[]
): Promise<{ success: boolean; saved: number; failed: number; error?: string }> => {
  try {
    if (!carriers.length) {
      return { success: true, saved: 0, failed: 0 };
    }

    const records = carriers
      .filter(c => c.mcNumber && c.dotNumber && c.legalName)
      .map(mapCarrierToRecord);

    const CHUNK_SIZE = 500;
    let saved = 0;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);

      const { error } = await supabase
        .from('carriers')
        .upsert(chunk, { onConflict: 'mc_number' });

      if (error) {
        return {
          success: false,
          saved,
          failed: records.length - saved,
          error: error.message,
        };
      }

      saved += chunk.length;
    }

    return { success: true, saved, failed: 0 };
  } catch (err: any) {
    return { success: false, saved: 0, failed: carriers.length, error: err.message };
  }
};

/* ───────────────────────────────────────────────────────────── */
/* FETCH WITH FILTERS */
/* ───────────────────────────────────────────────────────────── */

export interface CarrierFilters {
  mcNumber?: string;
  dotNumber?: string;
  legalName?: string;
  active?: string;
  state?: string;
  hasEmail?: string;
  classification?: string[];
  carrierOperation?: string[];
  cargo?: string[];
  hazmat?: string;
  powerUnitsMin?: number;
  powerUnitsMax?: number;
  driversMin?: number;
  driversMax?: number;
  yearsInBusinessMin?: number;
  yearsInBusinessMax?: number;
  limit?: number;
}

export const fetchCarriersFromSupabase = async (
  filters: CarrierFilters = {}
): Promise<any[]> => {
  try {
    let query = supabase.from('carriers').select('*');

    if (filters.mcNumber)
      query = query.ilike('mc_number', `%${filters.mcNumber}%`);

    if (filters.dotNumber)
      query = query.ilike('dot_number', `%${filters.dotNumber}%`);

    if (filters.legalName)
      query = query.ilike('legal_name', `%${filters.legalName}%`);

    if (filters.active === 'true')
      query = query.ilike('status', '%AUTHORIZED%').not('status', 'ilike', '%NOT%');

    if (filters.state) {
      const conditions = filters.state
        .split('|')
        .map(s => `physical_address.ilike."%, ${s}%"`)
        .join(',');
      query = query.or(conditions);
    }

    if (filters.hasEmail === 'true')
      query = query.not('email', 'is', null).neq('email', '');

    if (filters.classification?.length)
      query = query.overlaps('operation_classification', filters.classification);

    if (filters.carrierOperation?.length)
      query = query.overlaps('carrier_operation', filters.carrierOperation);

    if (filters.cargo?.length)
      query = query.overlaps('cargo_carried', filters.cargo);

    if (filters.hazmat === 'true')
      query = query.contains('cargo_carried', ['Hazardous Materials']);

    if (filters.powerUnitsMin !== undefined)
      query = query.gte('power_units', filters.powerUnitsMin);

    if (filters.powerUnitsMax !== undefined)
      query = query.lte('power_units', filters.powerUnitsMax);

    if (filters.driversMin !== undefined)
      query = query.gte('drivers', filters.driversMin);

    if (filters.driversMax !== undefined)
      query = query.lte('drivers', filters.driversMax);

    query = query.order('created_at', { ascending: false });
    query = query.limit(filters.limit ?? 200);

    const { data, error } = await query;
    if (error) return [];

    let results = (data || []).map(mapRecordToCarrier);

    /* Years in business filtering */
    if (filters.yearsInBusinessMin !== undefined || filters.yearsInBusinessMax !== undefined) {
      results = results.filter(c => {
        if (!c.mcs150Date) return false;
        const d = new Date(c.mcs150Date);
        if (isNaN(d.getTime())) return false;

        const years = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365));

        if (filters.yearsInBusinessMin !== undefined && years < filters.yearsInBusinessMin) return false;
        if (filters.yearsInBusinessMax !== undefined && years > filters.yearsInBusinessMax) return false;
        return true;
      });
    }

    return results;
  } catch {
    return [];
  }
};

/* ───────────────────────────────────────────────────────────── */
/* DELETE */
/* ───────────────────────────────────────────────────────────── */

export const deleteCarrier = async (mcNumber: string) => {
  const { error } = await supabase
    .from('carriers')
    .delete()
    .eq('mc_number', mcNumber);

  return { success: !error, error: error?.message };
};

/* ───────────────────────────────────────────────────────────── */
/* COUNT */
/* ───────────────────────────────────────────────────────────── */

export const getCarrierCount = async (): Promise<number> => {
  const { count } = await supabase
    .from('carriers')
    .select('*', { count: 'exact', head: true });

  return count ?? 0;
};

/* ───────────────────────────────────────────────────────────── */
/* UPDATE INSURANCE */
/* ───────────────────────────────────────────────────────────── */

export const updateCarrierInsurance = async (
  dotNumber: string,
  insuranceData: any
) => {
  const { error } = await supabase
    .from('carriers')
    .update({
      insurance_policies: insuranceData,
      updated_at: new Date().toISOString(),
    })
    .eq('dot_number', dotNumber);

  return { success: !error, error: error?.message };
};

/* ───────────────────────────────────────────────────────────── */
/* UPDATE SAFETY */
/* ───────────────────────────────────────────────────────────── */

export const updateCarrierSafety = async (
  dotNumber: string,
  safetyData: any
) => {
  const { error } = await supabase
    .from('carriers')
    .update({
      safety_rating: safetyData.rating,
      safety_rating_date: safetyData.ratingDate,
      basic_scores: safetyData.basicScores,
      oos_rates: safetyData.oosRates,
      updated_at: new Date().toISOString(),
    })
    .eq('dot_number', dotNumber);

  return { success: !error, error: error?.message };
};

/* ───────────────────────────────────────────────────────────── */
/* HELPERS */
/* ───────────────────────────────────────────────────────────── */

function mapCarrierToRecord(carrier: any): CarrierRecord {
  return {
    mc_number: carrier.mcNumber,
    dot_number: carrier.dotNumber,
    legal_name: carrier.legalName,
    dba_name: carrier.dbaName ?? null,
    entity_type: carrier.entityType,
    status: carrier.status,
    email: carrier.email ?? null,
    phone: carrier.phone ?? null,
    power_units: carrier.powerUnits ?? null,
    drivers: carrier.drivers ?? null,
    non_cmv_units: carrier.nonCmvUnits ?? null,
    physical_address: carrier.physicalAddress ?? null,
    mailing_address: carrier.mailingAddress ?? null,
    date_scraped: carrier.dateScraped,
    mcs150_date: carrier.mcs150Date ?? null,
    mcs150_mileage: carrier.mcs150Mileage ?? null,
    operation_classification: carrier.operationClassification ?? [],
    carrier_operation: carrier.carrierOperation ?? [],
    cargo_carried: carrier.cargoCarried ?? [],
    out_of_service_date: carrier.outOfServiceDate ?? null,
    state_carrier_id: carrier.stateCarrierId ?? null,
    duns_number: carrier.dunsNumber ?? null,
    safety_rating: carrier.safetyRating ?? null,
    safety_rating_date: carrier.safetyRatingDate ?? null,
    basic_scores: carrier.basicScores ?? null,
    oos_rates: carrier.oosRates ?? null,
    insurance_policies: carrier.insurancePolicies ?? null,
    updated_at: new Date().toISOString(),
  };
}

function mapRecordToCarrier(record: any) {
  return {
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
    nonCmvUnits: record.non_cmv_units,
    physicalAddress: record.physical_address,
    mailingAddress: record.mailing_address,
    dateScraped: record.date_scraped,
    mcs150Date: record.mcs150_date,
    mcs150Mileage: record.mcs150_mileage,
    operationClassification: record.operation_classification ?? [],
    carrierOperation: record.carrier_operation ?? [],
    cargoCarried: record.cargo_carried ?? [],
    outOfServiceDate: record.out_of_service_date,
    stateCarrierId: record.state_carrier_id,
    dunsNumber: record.duns_number,
    safetyRating: record.safety_rating,
    safetyRatingDate: record.safety_rating_date,
    basicScores: record.basic_scores,
    oosRates: record.oos_rates,
    insurancePolicies: record.insurance_policies,
  };
}
