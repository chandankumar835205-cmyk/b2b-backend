const PDFDocument = require("pdfkit");

const generateInvoicePDF = (order, res) => {
  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=invoice_${order._id}.pdf`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // 1️⃣ SENDER DETAILS
    const SENDER = order.items[0]?.seller_details || {
      name: "B2B Platform",
      address: "Platform HQ",
      gstin: "N/A",
      phone: "",
      email: ""
    };

    doc.fontSize(20).text("TAX INVOICE", { align: "center", underline: true }).moveDown(1.2);

    doc.fontSize(13).text(`From: ${SENDER.name}`);
    doc.fontSize(12);
    doc.text(SENDER.address);
    doc.text(`GSTIN: ${SENDER.gstin}`);
    doc.text(`Phone: ${SENDER.phone}`);
    doc.text(`Email: ${SENDER.email}`);
    doc.moveDown(1.4);

    // 2️⃣ BUYER DETAILS
    const shop = order.shop_id;
    const invoiceNo = `INV-${order._id.toString().slice(-6).toUpperCase()}`;
    const paymentType = order.payment_method === "Prepaid" ? "PREPAID" : "CASH ON DELIVERY";

    doc.fontSize(12);
    doc.text(`Invoice No: ${invoiceNo}`);
    doc.text(`Order ID: ${order._id.toString()}`);
    doc.text(`Invoice Date: ${new Date(order.createdAt).toLocaleDateString()}`);
    doc.text(`Payment Type: ${paymentType}`, { underline: true });

    doc.moveDown(1.2);

    doc.fontSize(14).text("Bill To:", { underline: true });
    doc.fontSize(12).text(`Name: ${shop.full_name || shop.email}`);
    doc.text(`Email: ${shop.email}`);
    doc.text(`Phone: ${shop.phone || "N/A"}`);
    doc.text(`Address: ${shop.address_line_1 || "N/A"}`);
    if (shop.city) doc.text(`${shop.city}, ${shop.district || ""}, ${shop.state || ""} - ${shop.pincode || ""}`);
    doc.moveDown(1.5);

    // 3️⃣ ORDER ITEMS TABLE
    doc.fontSize(14).text("Order Items", { underline: true });
    doc.moveDown(0.8);

    const tableTop = doc.y;
    doc.rect(50, tableTop, 500, 25).fill("#f0f0f0").stroke();
    doc.fillColor("#000");

    const headerY = tableTop + 8;
    doc.fontSize(11).font("Helvetica-Bold");
    doc.text("Product (Unit)", 60, headerY);
    doc.text("Qty", 300, headerY);
    doc.text("Price", 350, headerY);
    doc.text("Total", 430, headerY);

    doc.moveDown(2);
    doc.font("Helvetica");

    let positionY = doc.y;
    
    order.items.forEach((item) => {
      // Check if we need a new page
      if (positionY > 700) {
        doc.addPage();
        positionY = 50;
      }

      // Allow name to wrap if long
      doc.text(item.name, 60, positionY, { width: 230 }); 
      doc.text(item.quantity.toString(), 300, positionY);
      doc.text(`₹${item.price.toFixed(2)}`, 350, positionY);
      doc.text(`₹${(item.price * item.quantity).toFixed(2)}`, 430, positionY);

      // Estimate height based on name length
      const height = doc.heightOfString(item.name, { width: 230 });
      positionY += height + 10;
      
      doc.moveTo(50, positionY).lineTo(550, positionY).stroke();
      positionY += 10;
    });

    doc.moveDown(2);

    // 4️⃣ TOTAL
    doc.fontSize(14).font("Helvetica-Bold");
    doc.text("Grand Total:", 350, positionY, { width: 100, align: "right" });
    doc.text(`₹${order.total_amount.toFixed(2)}`, 450, positionY, { width: 100, align: "right" });

    doc.end();
  } catch (error) {
    console.error("PDF Error:", error);
    if (!res.headersSent) res.status(500).json({ detail: "Failed to generate invoice." });
  }
};

module.exports = {
  generateInvoicePDF,
};
