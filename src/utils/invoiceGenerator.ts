import PDFDocument from 'pdfkit';
import { Response } from 'express';

// Helper function to build the invoice structure
export const generateInvoicePDF = (order: any, res: Response) => {
    const doc = new PDFDocument({ margin: 50 });

    // Set the response header for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${order.id}.pdf`);

    // Pipe the PDF document directly to the response
    doc.pipe(res);

    // --- Invoice Content ---
    
    // Header (Factory Details)
    doc.fontSize(25).text('B2B PLATFORM INVOICE', { align: 'center' });
    doc.fontSize(10).text('Invoice Date: ' + new Date(order.created_at).toLocaleDateString(), { align: 'right' });
    doc.moveDown();

    // Billing/Shipping Address (Shop Details)
    doc.fontSize(14).text('BILL TO:', { underline: true });
    
    // The shop data comes from the populated 'shop_id' field
    const shop = order.shop_id; 
    
    doc.fontSize(12)
        .text(`Name: ${shop.full_name || shop.email}`)
        .text(`Email: ${shop.email}`)
        .text(`Address: ${shop.address_line_1 || 'N/A'}`)
        .text(`${shop.city}, ${shop.district}, ${shop.state} - ${shop.pincode}`);
    doc.moveDown();

    // Items Table (Simplified)
    doc.fontSize(14).text('Items Ordered', { underline: true });
    doc.moveDown(0.5);

    let y = doc.y;
    doc.text('Product Name', 50, y, { width: 250 });
    doc.text('Qty', 320, y, { width: 50, align: 'right' });
    doc.text('Price/Unit', 370, y, { width: 80, align: 'right' });
    doc.text('Total', 450, y, { width: 100, align: 'right' });
    doc.moveDown(0.5);
    
    // Draw line
    doc.lineCap('butt').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
    
    // Item Rows
    order.items.forEach((item: any) => {
        doc.text(item.name, 50, doc.y, { width: 250 });
        doc.text(item.quantity.toString(), 320, doc.y, { width: 50, align: 'right' });
        doc.text(`₹${item.price_per_unit.toFixed(2)}`, 370, doc.y, { width: 80, align: 'right' });
        doc.text(`₹${(item.price_per_unit * item.quantity).toFixed(2)}`, 450, doc.y, { width: 100, align: 'right' });
        doc.moveDown(0.5);
    });

    // Total Summary
    doc.lineCap('butt').moveTo(400, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.2);
    doc.fontSize(16).text('GRAND TOTAL:', 380, doc.y, { width: 100 });
    doc.text(`₹${order.total_amount.toFixed(2)}`, 450, doc.y, { width: 100, align: 'right' });
    
    // Finalize the PDF
    doc.end();
};