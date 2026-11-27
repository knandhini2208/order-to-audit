import PDFDocument from 'pdfkit';

export async function loadInvoice(pool, id) {
  const { rows: [inv] } = await pool.query(
    `SELECT i.*, to_char(i.invoice_date, 'DD-MM-YYYY') AS date_text,
            c.name AS customer_name, c.gstin AS customer_gstin, c.address AS customer_address
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`, [id]);
  if (!inv) return null;
  const { rows: items } = await pool.query(
    `SELECT ii.*, it.name FROM invoice_items ii
     JOIN items it ON it.id = ii.item_id WHERE ii.invoice_id = $1 ORDER BY ii.id`, [id]);
  const { rows: [company] } = await pool.query('SELECT * FROM company WHERE id = 1');
  return { inv, items, company };
}

// Display only: paise to "7,875.00"
const money = (v) =>
  (Number(v) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderInvoicePdf(res, { inv, items, company }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(18).text('TAX INVOICE', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(company.name);
  doc.font('Helvetica').fontSize(10).text(company.address || '');
  doc.text(`GSTIN: ${company.gstin}   |   State code: ${company.state_code}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text(`Invoice No: ${inv.invoice_no}`);
  doc.font('Helvetica').text(`Date: ${inv.date_text}`);
  doc.text(`Place of supply (state code): ${inv.place_of_supply}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Bill to');
  doc.font('Helvetica').text(inv.customer_name);
  if (inv.customer_address) doc.text(inv.customer_address);
  if (inv.customer_gstin) doc.text(`GSTIN: ${inv.customer_gstin}`);
  doc.moveDown();

  const cols = [
    ['Item', 40, 170, 'left'], ['HSN', 210, 70, 'left'], ['Qty', 280, 50, 'right'],
    ['Rate', 330, 70, 'right'], ['Taxable', 400, 80, 'right'], ['GST %', 480, 70, 'right'],
  ];
  const row = (cells, y, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    cols.forEach(([, x, w, align], i) => doc.text(String(cells[i]), x, y, { width: w, align }));
  };

  let y = doc.y;
  row(cols.map((c) => c[0]), y, true);
  y += 16;
  doc.moveTo(40, y).lineTo(555, y).stroke();
  y += 6;
  for (const it of items) {
    row([it.name, it.hsn_code || '-', it.qty, money(it.rate_paise),
         money(it.taxable_paise), it.gst_rate_bp / 100], y, false);
    y += 18;
  }
  doc.moveTo(40, y).lineTo(555, y).stroke();
  y += 10;

  const line = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    doc.text(label, 330, y, { width: 100, align: 'left' });
    doc.text(`Rs. ${money(value)}`, 430, y, { width: 125, align: 'right' });
    y += 16;
  };
  line('Taxable value', inv.taxable_paise);
  if (inv.place_of_supply === company.state_code) {
    line('CGST', inv.cgst_paise);
    line('SGST', inv.sgst_paise);
  } else {
    line('IGST', inv.igst_paise);
  }
  line('Total', inv.total_paise, true);

  doc.font('Helvetica').fontSize(9).text('This is a computer-generated invoice.', 40, y + 30);
  doc.end();
}