/** Barcode formats the field scanner reads (A11): IMS label QR + Code 128, and common product barcodes. */
export const SCAN_FORMATS = ["qr_code", "code_128", "ean_13", "upc_a", "ean_8", "upc_e"] as const;
