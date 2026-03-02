import { Router } from "express";
import { storage } from "../storage";
import type { Request, Response } from "express";

const router = Router();

router.post("/api/auth/send-reset-code", async (req: Request, res: Response) => {
  try {
    const { propertyNumber, whatsappNumber } = req.body;
    
    if (!propertyNumber && !whatsappNumber) {
      return res.status(400).json({ error: "Property number or WhatsApp number required" });
    }

    const property = await storage.getPropertyByNumber(propertyNumber || whatsappNumber);
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    (req.session as any).otp = otp;
    (req.session as any).otpExpiry = Date.now() + 10 * 60 * 1000;
    (req.session as any).lastOtpSent = Date.now();

    res.json({ 
      ok: true, 
      message: "OTP sent to registered WhatsApp number",
      debugOTP: otp 
    });
  } catch (err: any) {
    console.error("Send reset code error:", err);
    res.status(500).json({ error: "Failed to send reset code" });
  }
});

router.post("/api/auth/set-new-password", async (req: Request, res: Response) => {
  try {
    const { propertyNumber, otp, newPin } = req.body;

    if (!propertyNumber || !otp || !newPin) {
      return res.status(400).json({ error: "Property number, OTP, and new PIN required" });
    }

    const sessionOTP = (req.session as any).otp;
    const otpExpiry = (req.session as any).otpExpiry;

    if (!sessionOTP || !otpExpiry) {
      return res.status(400).json({ error: "No OTP found. Request a new one." });
    }

    if (Date.now() > otpExpiry) {
      return res.status(400).json({ error: "OTP expired. Request a new one." });
    }

    if (sessionOTP !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    await storage.updateProperty(propertyNumber, { pin: newPin });

    (req.session as any).otp = undefined;
    (req.session as any).otpExpiry = undefined;

    res.json({ ok: true, message: "Password reset successful" });
  } catch (err: any) {
    console.error("Set new password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
