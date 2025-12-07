import PDFDocument from "pdfkit";
import { Response } from "express";

export const generateInvoicePDF = (order: any, res: Response) => {
  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
  "Content-Disposition",
  `inline; filename=invoice_${order._id}.pdf`
);


    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // 1️⃣ SENDER DETAILS
    // const SENDER = {
    //   name: "B2B Platform Pvt. Ltd.",
    //   address:
    //     "2nd Floor, Tech Park, Electronic City, Bengaluru, Karnataka - 560100",
    //   gstin: "29ABCDE1234F1Z5",
    //   phone: "+91 98765 43210",
    //   email: "support@b2bplatform.com",
    // };
    const SENDER = order.items[0].seller_details;


    doc
      .fontSize(20)
      .text("TAX INVOICE", { align: "center", underline: true })
      .moveDown(1.2);

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

    // FIXED: CORRECT PAYMENT METHOD
    const paymentType =
      order.payment_method === "Prepaid" ? "PREPAID" : "CASH ON DELIVERY";

    // ⭐️ ADDING ORDER ID HERE ⭐️
    doc.fontSize(12);
    doc.text(`Invoice No: ${invoiceNo}`);
    doc.text(`Order ID: ${order._id.toString()}`);  // ⭐️ NEW LINE ADDED ⭐️
    doc.text(`Invoice Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Payment Type: ${paymentType}`, { underline: true });

    doc.moveDown(1.2);

    doc.fontSize(14).text("Bill To:", { underline: true });
    doc.fontSize(12).text(`Name: ${shop.full_name || shop.email}`);
    doc.text(`Email: ${shop.email}`);
    doc.text(`Phone: ${shop.phone || "N/A"}`);
    doc.text(`Address: ${shop.address_line_1 || "N/A"}`);
    doc.text(`${shop.city}, ${shop.district}, ${shop.state} - ${shop.pincode}`);
    doc.moveDown(1.5);

    // 3️⃣ ORDER ITEMS TABLE
    doc.fontSize(14).text("Order Items", { underline: true });
    doc.moveDown(0.8);

    const tableTop = doc.y;
    doc.rect(50, tableTop, 500, 22).fill("#f0f0f0").stroke();
    doc.fillColor("#000");

    const headerY = tableTop + 6;
    doc.fontSize(12);
    doc.text("Product", 60, headerY);
    doc.text("Qty", 260, headerY);
    doc.text("Unit Price", 330, headerY);
    doc.text("Total", 430, headerY);

    doc.moveDown(1.5);

    let positionY = doc.y;
    order.items.forEach((item: any) => {
      doc.text(item.name, 60, positionY);
      doc.text(item.quantity.toString(), 260, positionY);
      doc.text(`₹${item.price.toFixed(2)}`, 330, positionY);
      doc.text(`₹${(item.price * item.quantity).toFixed(2)}`, 430, positionY);

      positionY += 20;

      doc.moveTo(50, positionY).lineTo(550, positionY).stroke();
    });

    doc.moveDown(2);

    // 4️⃣ TOTAL
    const totalY = doc.y;

    doc.fontSize(14).text("Grand Total:", 350, totalY, {
      width: 100,
      align: "right",
    });

    doc.fontSize(14).text(
      `₹${order.total_amount.toFixed(2)}`,
      450,
      totalY,
      {
        width: 100,
        align: "right",
      }
    );

    doc.moveDown(2);

    // 5️⃣ FOOTER
    doc
      .fontSize(11)
      .fillColor("gray")
      .text(
        "This is a system-generated GST invoice. No signature required.",
        { align: "center" }
      );

    doc.end();
  } catch (error) {
    console.error("PDF Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ detail: "Failed to generate invoice." });
    }
  }
};
