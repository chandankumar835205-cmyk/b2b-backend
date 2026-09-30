const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const SHIPROCKET_EMAIL = process.env.SHIPROCKET_API_USER;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_API_PASSWORD;

const createShiprocketShipment = async (order, shopUser, factoryUser) => {
  try {
    // 1. Login to Shiprocket to get Auth Token
    const authResponse = await axios.post("https://apiv2.shiprocket.in/v1/external/auth/login", {
      email: SHIPROCKET_EMAIL,
      password: SHIPROCKET_PASSWORD,
    });
    const token = authResponse.data.token;

    // 2. Prepare Payload
    const payload = {
      order_id: order._id.toString(),
      order_date: order.createdAt,
      pickup_location: "Primary",
      billing_customer_name: shopUser.email.split("@")[0],
      billing_last_name: "",
      billing_address: shopUser.address_line_1 || "Shop Address",
      billing_city: shopUser.city || "City",
      billing_pincode: shopUser.pincode || "110001",
      billing_state: shopUser.state || "State",
      billing_country: "India",
      billing_email: shopUser.email,
      billing_phone: "9876543210",
      shipping_is_billing: true,
      order_items: order.items.map((item) => ({
        name: item.name,
        sku: item.name,
        units: item.quantity,
        selling_price: item.price,
      })),
      payment_method: order.payment_method === "COD" ? "COD" : "Prepaid",
      sub_total: order.total_amount,
      length: 10,
      breadth: 10,
      height: 10,
      weight: 0.5
    };

    // 3. Create Order in Shiprocket
    const shipmentResponse = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
      }
    );

    return shipmentResponse.data;

  } catch (error) {
    console.error("Shiprocket Error:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Shipment creation failed");
  }
};

module.exports = {
  createShiprocketShipment,
};
