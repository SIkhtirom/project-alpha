

export const ROLES = ['pendana', 'penerima', 'analis', 'komite', 'finance', 'manajer', 'admin'];
export const ROLE_LABEL = {
  pendana: 'Pendana', penerima: 'Penerima', analis: 'Analis', komite: 'Komite',
  finance: 'Finance', manajer: 'Manajer', admin: 'Admin',
};
export const BACKOFFICE = ['analis', 'komite', 'finance', 'manajer', 'admin'];

export const ST = {
  SUBMITTED: 'SUBMITTED', VERIFIED: 'VERIFIED', ANALYZED: 'ANALYZED', APPROVED: 'APPROVED',
  REJECTED: 'REJECTED', LISTED: 'LISTED', EXPIRED: 'EXPIRED', FUNDED: 'FUNDED',
  AKAD_SIGNED: 'AKAD_SIGNED', DISBURSING: 'DISBURSING', GRACE: 'GRACE', REPAYING: 'REPAYING',
  FAILED_DEPARTURE: 'FAILED_DEPARTURE', LOSS_HANDLING: 'LOSS_HANDLING', PAID_OFF: 'PAID_OFF',
  CLOSED_BUYBACK: 'CLOSED_BUYBACK', CLOSED_LOSS: 'CLOSED_LOSS', CANCELLED: 'CANCELLED',
};

export const STATUS_LABEL = {
  SUBMITTED: 'Menunggu verifikasi', VERIFIED: 'Siap dianalisa', ANALYZED: 'Menunggu komite',
  APPROVED: 'Disetujui', REJECTED: 'Ditolak', LISTED: 'Penggalangan dana', EXPIRED: 'Tidak terdanai',
  FUNDED: 'Terdanai penuh', AKAD_SIGNED: 'Akad ditandatangani', DISBURSING: 'Pencairan berjalan',
  GRACE: 'Masa tenggang', REPAYING: 'Angsuran berjalan', FAILED_DEPARTURE: 'Gagal berangkat',
  LOSS_HANDLING: 'Penanganan kerugian', PAID_OFF: 'Lunas', CLOSED_BUYBACK: 'Diambil alih KMH',
  CLOSED_LOSS: 'Dihapusbukukan', CANCELLED: 'Dibatalkan',
};


export const PAYABLE = [ST.GRACE, ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK];


export const ACC = {
  KAS: '1100',          
  PIUTANG: '1200',      
  AVAIL: '2100',        
  LOCKED: '2110',       
  WD_HOLD: '2120',      
  PROTEKSI: '2200',     
  KMH_AVAIL: '2300',    
  KMH_LOCKED: '2310',   
  UTANG_CAIR: '2400',   
  TITIPAN: '2500',      
  MODAL: '3100',        
  UJRAH: '4100',        
};
export const ACC_LABEL = {
  '1100': 'Kas rekening penampung', '1200': 'Piutang pembiayaan (pokok)',
  '2100': 'Dompet anggota – tersedia', '2110': 'Dompet anggota – terkunci', '2120': 'Dompet anggota – proses tarik',
  '2200': "Dana Proteksi (tabarru')", '2300': 'Dompet KMH – tersedia', '2310': 'Dompet KMH – terkunci',
  '2400': 'Utang pencairan ke LPK/vendor', '2500': 'Titipan kelebihan bayar', '3100': 'Modal syirkah',
  '4100': 'Pendapatan ujrah syirkah',
};

export const DEFAULT_SETTINGS = {
  nisbah_investor: 70,       
  protection_pct: 10,        
  kmh_min_pct: 10,           
  min_funding: 1000000,      
  funding_step: 500000,      
  max_investor_pct: 50,      
  listing_days: 7,           
  max_claim_pct: 50,         
  committee_quorum: 2,       
  max_installment_ratio: 30, 
  va_prefix: '8808',
  sim_date: '',              
};

export const VAULT_TOTAL_DANA = 150000000000;
export const VAULT_LOS_KONTRAK = 560;

export const COST_COMPONENTS = [
  'Pelatihan bahasa & budaya Jepang', 'Pemeriksaan kesehatan (MCU)', 'Pengurusan dokumen & paspor',
  'Biaya Sending Organization', 'Visa & COE', 'Tiket & keberangkatan', 'Perlengkapan',
];
