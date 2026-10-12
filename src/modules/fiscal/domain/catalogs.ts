import type { PersonType } from './rfc.js';

// SAT catalogs of the CFDI 4.0 (Anexo 20), limited to what a receipt's receiver
// can use. Codes are what the CFDI carries; names are the SAT's descriptions.

export interface TaxRegime {
  readonly code: string;
  readonly name: string;
  readonly personTypes: readonly PersonType[];
}

/** c_RegimenFiscal */
export const TAX_REGIMES: readonly TaxRegime[] = [
  { code: '601', name: 'General de Ley Personas Morales', personTypes: ['moral'] },
  { code: '603', name: 'Personas Morales con Fines no Lucrativos', personTypes: ['moral'] },
  {
    code: '605',
    name: 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
    personTypes: ['fisica'],
  },
  { code: '606', name: 'Arrendamiento', personTypes: ['fisica'] },
  { code: '607', name: 'Régimen de Enajenación o Adquisición de Bienes', personTypes: ['fisica'] },
  { code: '608', name: 'Demás ingresos', personTypes: ['fisica'] },
  {
    code: '610',
    name: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
    personTypes: ['fisica', 'moral'],
  },
  { code: '611', name: 'Ingresos por Dividendos (socios y accionistas)', personTypes: ['fisica'] },
  {
    code: '612',
    name: 'Personas Físicas con Actividades Empresariales y Profesionales',
    personTypes: ['fisica'],
  },
  { code: '614', name: 'Ingresos por intereses', personTypes: ['fisica'] },
  {
    code: '615',
    name: 'Régimen de los ingresos por obtención de premios',
    personTypes: ['fisica'],
  },
  { code: '616', name: 'Sin obligaciones fiscales', personTypes: ['fisica'] },
  {
    code: '620',
    name: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
    personTypes: ['moral'],
  },
  { code: '621', name: 'Incorporación Fiscal', personTypes: ['fisica'] },
  {
    code: '622',
    name: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    personTypes: ['moral'],
  },
  { code: '623', name: 'Opcional para Grupos de Sociedades', personTypes: ['moral'] },
  { code: '624', name: 'Coordinados', personTypes: ['moral'] },
  {
    code: '625',
    name: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
    personTypes: ['fisica'],
  },
  { code: '626', name: 'Régimen Simplificado de Confianza', personTypes: ['fisica', 'moral'] },
];

export interface CfdiUse {
  readonly code: string;
  readonly name: string;
  readonly personTypes: readonly PersonType[];
  /** Receiver regimes the SAT accepts this use with. */
  readonly taxRegimes: readonly string[];
}

const BUSINESS_REGIMES = [
  '601',
  '603',
  '606',
  '612',
  '620',
  '621',
  '622',
  '623',
  '624',
  '625',
  '626',
];
const PERSONAL_DEDUCTION_REGIMES = ['605', '606', '607', '608', '611', '612', '614', '615', '625'];
const ALL_REGIMES = TAX_REGIMES.map((regime) => regime.code);

const business = (code: string, name: string): CfdiUse => ({
  code,
  name,
  personTypes: ['fisica', 'moral'],
  taxRegimes: BUSINESS_REGIMES,
});
const personal = (code: string, name: string): CfdiUse => ({
  code,
  name,
  personTypes: ['fisica'],
  taxRegimes: PERSONAL_DEDUCTION_REGIMES,
});

/** c_UsoCFDI, without CP01 (pagos) and CN01 (nómina): they never apply to a purchase receipt. */
export const CFDI_USES: readonly CfdiUse[] = [
  business('G01', 'Adquisición de mercancías'),
  business('G02', 'Devoluciones, descuentos o bonificaciones'),
  business('G03', 'Gastos en general'),
  business('I01', 'Construcciones'),
  business('I02', 'Mobiliario y equipo de oficina por inversiones'),
  business('I03', 'Equipo de transporte'),
  business('I04', 'Equipo de cómputo y accesorios'),
  business('I05', 'Dados, troqueles, moldes, matrices y herramental'),
  business('I06', 'Comunicaciones telefónicas'),
  business('I07', 'Comunicaciones satelitales'),
  business('I08', 'Otra maquinaria y equipo'),
  personal('D01', 'Honorarios médicos, dentales y gastos hospitalarios'),
  personal('D02', 'Gastos médicos por incapacidad o discapacidad'),
  personal('D03', 'Gastos funerales'),
  personal('D04', 'Donativos'),
  personal(
    'D05',
    'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)',
  ),
  personal('D06', 'Aportaciones voluntarias al SAR'),
  personal('D07', 'Primas por seguros de gastos médicos'),
  personal('D08', 'Gastos de transportación escolar obligatoria'),
  personal(
    'D09',
    'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones',
  ),
  personal('D10', 'Pagos por servicios educativos (colegiaturas)'),
  {
    code: 'S01',
    name: 'Sin efectos fiscales',
    personTypes: ['fisica', 'moral'],
    taxRegimes: ALL_REGIMES,
  },
];

export function findTaxRegime(code: string): TaxRegime | undefined {
  return TAX_REGIMES.find((regime) => regime.code === code);
}

export function findCfdiUse(code: string): CfdiUse | undefined {
  return CFDI_USES.find((use) => use.code === code);
}
