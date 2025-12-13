import axios from "axios";

// 1. Send OTP (Used by otpRoutes.ts)
export const sendSmsOtp = async (phone: string, otp: string) => {
  try {
    const API_KEY = process.env.FAST2SMS_API_KEY;
    if (!API_KEY) {
      console.warn("⚠️ FAST2SMS_API_KEY missing. OTP not sent.");
      return;
    }

    // Fast2SMS "OTP" Route (Optimized for delivery)
    // It sends a default template: "Your OTP is: 1234"
    await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: {
        authorization: API_KEY,
        variables_values: otp,
        route: "q",
          message: `Your OTP is ${otp}`,
        numbers: phone
      }
    });

    console.log(`✅ OTP SMS sent to ${phone}`);
  } catch (error: any) {
    console.error("❌ Failed to send OTP SMS:", error.response?.data || error.message);
  }
};

// 2. Send General Notification (Used by orderRoutes.ts & paymentRoutes.ts)
export const sendSmsNotification = async (phone: string, message: string) => {
  try {
    const API_KEY = process.env.FAST2SMS_API_KEY;
    if (!API_KEY) return;

    // Fast2SMS "Quick" Route (Allows custom text)
    // Note: Requires "Quick SMS" credits (₹5/SMS on free tier) or DLT approval.
    // If you run out of credits, this might fail, but it won't crash your app.
    await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: {
        authorization: API_KEY,
        message: message,
        language: "english",
        route: "q", // 'q' = Quick SMS (No DLT required for testing)
        numbers: phone
      }
    });

    console.log(`✅ Notification SMS sent to ${phone}`);
  } catch (error: any) {
    console.error("❌ Failed to send Notification SMS:", error.response?.data || error.message);
  }
};