import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { googleSheetsService } from "./googleSheets";
import { googleDriveService } from "./googleDrive";
import { paymobService } from "./paymob";
import { insertPropertySchema, insertSuggestionSchema, insertDiscountCodeSchema, insertPackageSchema } from "@shared/schema";
import session from "express-session";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize Google Sheets
  try {
    await googleSheetsService.initializeSheets();
    console.log('✅ Google Sheets initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Google Sheets:', error);
  }

  // Session management
  app.use(session({
    secret: process.env.SESSION_SECRET || 'moddy-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
    },
  }));

  // ================================
  // PUBLIC ROUTES
  // ================================

  // Get all properties (public)
  app.get("/api/properties", async (req, res) => {
    try {
      const properties = await storage.getProperties();
      
      // Sort: موثوق properties first
      const sorted = properties.sort((a, b) => {
        if (a.subscriptionType === 'موثوق' && b.subscriptionType !== 'موثوق') return -1;
        if (a.subscriptionType !== 'موثوق' && b.subscriptionType === 'موثوق') return 1;
        return 0;
      });

      res.json(sorted);
    } catch (error) {
      console.error('Error fetching properties:', error);
      res.status(500).json({ error: 'فشل في جلب العقارات' });
    }
  });

  // Get single property (public)
  app.get("/api/properties/:propertyNumber", async (req, res) => {
    try {
      const property = await storage.getPropertyByNumber(req.params.propertyNumber);
      if (!property) {
        return res.status(404).json({ error: 'العقار غير موجود' });
      }
      res.json(property);
    } catch (error) {
      console.error('Error fetching property:', error);
      res.status(500).json({ error: 'فشل في جلب بيانات العقار' });
    }
  });

  // Submit suggestion
  app.post("/api/suggestions", async (req, res) => {
    try {
      const validated = insertSuggestionSchema.parse(req.body);
      const suggestion = await storage.createSuggestion(validated);
      res.json(suggestion);
    } catch (error) {
      console.error('Error creating suggestion:', error);
      res.status(400).json({ error: 'فشل في إرسال الاقتراح' });
    }
  });

  // Register new property
  app.post("/api/properties/register", async (req, res) => {
    try {
      const validated = insertPropertySchema.parse(req.body);
      
      // Check if property number already exists
      const existing = await storage.getPropertyByNumber(validated.propertyNumber);
      if (existing) {
        return res.status(400).json({ error: 'رقم العقار مستخدم بالفعل' });
      }

      // Create Google Drive folder
      const folderId = await googleDriveService.createPropertyFolder(
        validated.propertyNumber,
        validated.name
      );

      // Create property with Drive folder ID
      const property = await storage.createProperty({
        ...validated,
        driveFolderId: folderId,
        subscriptionType: 'عادي',
        imageUrls: [],
      });

      res.json(property);
    } catch (error) {
      console.error('Error registering property:', error);
      res.status(400).json({ error: 'فشل في تسجيل العقار' });
    }
  });

  // Create WhatsApp request
  app.post("/api/requests", async (req, res) => {
    try {
      const { propertyNumber } = req.body;
      
      // Generate short code
      const requestCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const request = await storage.createRequest({
        propertyNumber,
        requestCode,
        timestamp: new Date().toISOString(),
      });

      res.json(request);
    } catch (error) {
      console.error('Error creating request:', error);
      res.status(500).json({ error: 'فشل في إنشاء الطلب' });
    }
  });

  // ================================
  // OWNER AUTHENTICATION
  // ================================

  // Owner login
  app.post("/api/owner/login", async (req, res) => {
    try {
      const { propertyNumber, pin } = req.body;

      const property = await storage.getPropertyByNumber(propertyNumber);
      if (!property) {
        return res.status(401).json({ error: 'رقم العقار أو الرقم السري غير صحيح' });
      }

      if (property.pin !== pin) {
        return res.status(401).json({ error: 'رقم العقار أو الرقم السري غير صحيح' });
      }

      // Set session
      (req.session as any).propertyNumber = propertyNumber;

      res.json({ message: 'تم تسجيل الدخول بنجاح', propertyNumber });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({ error: 'فشل في تسجيل الدخول' });
    }
  });

  // Owner logout
  app.post("/api/owner/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: 'تم تسجيل الخروج بنجاح' });
    });
  });

  // Get current owner session
  app.get("/api/owner/session", (req, res) => {
    const propertyNumber = (req.session as any)?.propertyNumber;
    if (!propertyNumber) {
      return res.json({ isLoggedIn: false });
    }
    res.json({ isLoggedIn: true, propertyNumber });
  });

  // ================================
  // OWNER ROUTES (Protected)
  // ================================

  // Middleware to check owner authentication
  const requireOwnerAuth = (req: any, res: any, next: any) => {
    const propertyNumber = req.session?.propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً' });
    }
    req.propertyNumber = propertyNumber;
    next();
  };

  // Get owner's property data
  app.get("/api/owner/property", requireOwnerAuth, async (req: any, res) => {
    try {
      const property = await storage.getPropertyByNumber(req.propertyNumber);
      if (!property) {
        return res.status(404).json({ error: 'العقار غير موجود' });
      }
      res.json(property);
    } catch (error) {
      console.error('Error fetching owner property:', error);
      res.status(500).json({ error: 'فشل في جلب بيانات العقار' });
    }
  });

  // Get owner's subscription information
  app.get("/api/owner/subscription", requireOwnerAuth, async (req: any, res) => {
    try {
      const property = await storage.getPropertyByNumber(req.propertyNumber);
      if (!property) {
        return res.status(404).json({ error: 'العقار غير موجود' });
      }

      // Get all subscriptions and find this property's subscription
      const allSubscriptions = await storage.getSubscriptions();
      const subscription = allSubscriptions.find(s => s.propertyNumber === req.propertyNumber);

      // Get latest payment for this property
      let currentPayment = null;
      const allPayments = await storage.getPayments();
      const propertyPayments = allPayments
        .filter(p => p.propertyNumber === req.propertyNumber)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      if (propertyPayments.length > 0) {
        const latestPayment = propertyPayments[0];
        currentPayment = {
          id: latestPayment.id,
          status: latestPayment.status,
          amount: latestPayment.amount,
          finalAmount: latestPayment.finalAmount,
          packageId: latestPayment.packageId,
          paymentMethod: latestPayment.paymentMethod || '',
          createdAt: latestPayment.createdAt
        };
      }

      // If no subscription found, return minimal info with current payment
      if (!subscription) {
        return res.json({
          subscriptionType: property.subscriptionType || 'عادي',
          status: 'inactive',
          startDate: null,
          endDate: null,
          currentPayment
        });
      }

      res.json({
        subscriptionType: property.subscriptionType || 'عادي',
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        currentPayment
      });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: 'فشل في جلب معلومات الاشتراك' });
    }
  });

  // Update owner's property
  app.put("/api/owner/property", requireOwnerAuth, async (req: any, res) => {
    try {
      const updates = req.body;
      delete updates.propertyNumber; // Cannot change property number
      delete updates.pin; // Cannot change PIN via this route

      const property = await storage.updateProperty(req.propertyNumber, updates);
      res.json(property);
    } catch (error) {
      console.error('Error updating property:', error);
      res.status(500).json({ error: 'فشل في تحديث بيانات العقار' });
    }
  });

  // Upload images
  app.post("/api/owner/images", requireOwnerAuth, upload.array('images', 10), async (req: any, res) => {
    try {
      const property = await storage.getPropertyByNumber(req.propertyNumber);
      if (!property || !property.driveFolderId) {
        return res.status(404).json({ error: 'العقار غير موجود أو لا يوجد مجلد Drive' });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'لم يتم رفع أي صور' });
      }

      // Upload images to Google Drive
      const imageUrls: string[] = [];
      for (const file of files) {
        const filename = `${Date.now()}-${file.originalname}`;
        const url = await googleDriveService.uploadImage(
          property.driveFolderId,
          file.buffer,
          filename
        );
        imageUrls.push(url);
      }

      // Update property with new image URLs
      const updatedProperty = await storage.updateProperty(req.propertyNumber, {
        imageUrls: [...property.imageUrls, ...imageUrls].slice(0, 10), // Max 10 images
      });

      res.json({ imageUrls: updatedProperty.imageUrls });
    } catch (error) {
      console.error('Error uploading images:', error);
      res.status(500).json({ error: 'فشل في رفع الصور' });
    }
  });

  // Delete an image
  app.post("/api/owner/images/delete", requireOwnerAuth, async (req: any, res) => {
    try {
      const { imageUrl } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ error: 'رابط الصورة مطلوب' });
      }

      const property = await storage.getPropertyByNumber(req.propertyNumber);
      if (!property) {
        return res.status(404).json({ error: 'العقار غير موجود' });
      }

      // Check if image exists in property
      if (!property.imageUrls.includes(imageUrl)) {
        return res.status(404).json({ error: 'الصورة غير موجودة' });
      }

      // Delete from Google Drive
      try {
        await googleDriveService.deleteImage(imageUrl);
      } catch (error) {
        console.error('Error deleting from Drive (continuing anyway):', error);
        // Continue even if Drive deletion fails
      }

      // Remove from property
      const updatedImageUrls = property.imageUrls.filter(url => url !== imageUrl);
      await storage.updateProperty(req.propertyNumber, {
        imageUrls: updatedImageUrls,
      });

      res.json({ success: true, imageUrls: updatedImageUrls });
    } catch (error) {
      console.error('Error deleting image:', error);
      res.status(500).json({ error: 'فشل في حذف الصورة' });
    }
  });

  // Get subscription packages
  app.get("/api/packages", async (req, res) => {
    try {
      const packages = await storage.getPackages();
      const activePackages = packages.filter(p => p.isActive);
      res.json(activePackages);
    } catch (error) {
      console.error('Error fetching packages:', error);
      res.status(500).json({ error: 'فشل في جلب الباقات' });
    }
  });

  // Validate discount code
  app.post("/api/discount/validate", async (req, res) => {
    try {
      const { code } = req.body;
      const discountCode = await storage.getDiscountCodeByCode(code);

      if (!discountCode) {
        return res.status(404).json({ error: 'كود الخصم غير موجود' });
      }

      if (!discountCode.isActive) {
        return res.status(400).json({ error: 'كود الخصم غير نشط' });
      }

      if (discountCode.expiryDate && new Date(discountCode.expiryDate) < new Date()) {
        return res.status(400).json({ error: 'كود الخصم منتهي الصلاحية' });
      }

      res.json(discountCode);
    } catch (error) {
      console.error('Error validating discount:', error);
      res.status(500).json({ error: 'فشل في التحقق من كود الخصم' });
    }
  });

  // Initiate payment
  app.post("/api/owner/payment/initiate", requireOwnerAuth, async (req: any, res) => {
    try {
      const { packageId, discountCode, paymentMethod } = req.body;

      const pkg = await storage.getPackageById(packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'الباقة غير موجودة' });
      }

      let finalAmount = pkg.price;
      let discountAmount = 0;

      // Apply discount if provided
      if (discountCode) {
        const discount = await storage.getDiscountCodeByCode(discountCode);
        if (discount && discount.isActive) {
          if (discount.type === 'نسبة') {
            discountAmount = (pkg.price * discount.value) / 100;
          } else {
            discountAmount = discount.value;
          }
          finalAmount = Math.max(0, pkg.price - discountAmount);
        }
      }

      // Create payment record
      const payment = await storage.createPayment({
        propertyNumber: req.propertyNumber,
        packageId,
        amount: pkg.price,
        discountCode: discountCode || undefined,
        discountAmount,
        finalAmount,
        status: 'معلق',
        paymentMethod: paymentMethod || 'بطاقة',
      });

      // Get property info
      const property = await storage.getPropertyByNumber(req.propertyNumber);
      if (!property) {
        return res.status(404).json({ error: 'العقار غير موجود' });
      }

      // Initiate Paymob payment
      const paymobResponse = await paymobService.initiatePayment(
        finalAmount,
        req.propertyNumber,
        property.name,
        property.whatsappNumber,
        pkg.name,
        pkg.duration,
        paymentMethod || 'cards'
      );

      // Update payment with Paymob intention ID
      await storage.updatePayment(payment.id, {
        paymobOrderId: paymobResponse.intentionId,
      });

      res.json({
        paymentId: payment.id,
        checkoutUrl: paymobResponse.checkoutUrl,
        amount: finalAmount,
      });
    } catch (error) {
      console.error('Error initiating payment:', error);
      res.status(500).json({ error: 'فشل في بدء عملية الدفع' });
    }
  });

  // Bank transfer payment with receipt upload
  app.post("/api/owner/payment/bank-transfer", requireOwnerAuth, async (req: any, res) => {
    try {
      const { packageId, discountCode, receiptFile } = req.body;

      if (!receiptFile || !receiptFile.data) {
        return res.status(400).json({ error: 'يجب رفع إيصال الدفع' });
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      if (!allowedTypes.includes(receiptFile.type)) {
        return res.status(400).json({ error: 'نوع الملف غير مدعوم. يرجى رفع صورة (JPG, PNG) أو PDF' });
      }

      // Validate file size (max 5MB)
      const buffer = Buffer.from(receiptFile.data, 'base64');
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (buffer.length > maxSize) {
        return res.status(400).json({ error: 'حجم الملف كبير جداً. الحد الأقصى 5MB' });
      }

      const pkg = await storage.getPackageById(packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'الباقة غير موجودة' });
      }

      let finalAmount = pkg.price;
      let discountAmount = 0;

      // Apply discount if provided
      if (discountCode) {
        const discount = await storage.getDiscountCodeByCode(discountCode);
        if (discount && discount.isActive) {
          if (discount.type === 'نسبة') {
            discountAmount = (pkg.price * discount.value) / 100;
          } else {
            discountAmount = discount.value;
          }
          finalAmount = Math.max(0, pkg.price - discountAmount);
        }
      }

      // Upload receipt to object storage
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        throw new Error('Object storage not configured');
      }

      const fileExtension = receiptFile.type.split('/')[1] || 'pdf';
      const fileName = `receipt-${req.propertyNumber}-${Date.now()}.${fileExtension}`;
      const privateDirPath = `${bucketId}/.private`;
      const fullPath = `${privateDirPath}/${fileName}`;

      // Ensure private directory exists and write file
      const { mkdir, writeFile } = await import('node:fs/promises');
      try {
        await mkdir(privateDirPath, { recursive: true });
      } catch (err) {
        // Directory might already exist, ignore error
      }
      await writeFile(fullPath, buffer);

      // Create payment record with "قيد المراجعة" status
      const payment = await storage.createPayment({
        propertyNumber: req.propertyNumber,
        packageId,
        amount: pkg.price,
        discountCode: discountCode || undefined,
        discountAmount,
        finalAmount,
        status: 'قيد المراجعة',
        paymentMethod: 'تحويل بنكي',
        receiptUrl: fullPath,
      });

      res.json({
        paymentId: payment.id,
        message: 'تم إرسال الطلب بنجاح. سيتم مراجعة الدفع وتفعيل الاشتراك قريباً',
      });
    } catch (error) {
      console.error('Error processing bank transfer:', error);
      res.status(500).json({ error: 'فشل في معالجة الطلب' });
    }
  });

  // Paymob webhook
  app.post("/api/webhook/paymob", async (req, res) => {
    try {
      // Verify webhook signature
      const isValid = paymobService.verifyWebhookSignature(req.body);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return res.status(400).json({ error: 'Invalid signature' });
      }

      const paymentInfo = paymobService.extractPaymentInfo(req.body);

      // Find payment by Paymob order ID
      const payments = await storage.getPayments();
      const payment = payments.find(p => p.paymobOrderId === paymentInfo.orderId.toString());

      if (!payment) {
        console.error('Payment not found for order:', paymentInfo.orderId);
        return res.status(404).json({ error: 'Payment not found' });
      }

      // Update payment status
      if (paymentInfo.success && !paymentInfo.pending) {
        await storage.updatePayment(payment.id, {
          status: 'مكتمل',
          completedAt: new Date().toISOString(),
        });

        // Get package info
        const pkg = await storage.getPackageById(payment.packageId);
        if (pkg) {
          // Create/Update subscription
          const startDate = new Date().toISOString();
          const endDate = new Date(Date.now() + pkg.duration * 24 * 60 * 60 * 1000).toISOString();

          await storage.createSubscription({
            propertyNumber: payment.propertyNumber,
            packageId: payment.packageId,
            startDate,
            endDate,
            status: 'نشط',
            paymentId: payment.id,
          });

          // Update property subscription type
          await storage.updateProperty(payment.propertyNumber, {
            subscriptionType: pkg.type,
            subscriptionDate: endDate,
          });

          // Record profit
          await storage.createProfit({
            paymentId: payment.id,
            propertyNumber: payment.propertyNumber,
            amount: payment.finalAmount,
            partnerShare: payment.finalAmount * 0.5, // 50% partner share
            cycle: new Date().toISOString().substring(0, 7), // YYYY-MM
            date: new Date().toISOString(),
          });
        }
      } else if (paymentInfo.errorOccured) {
        await storage.updatePayment(payment.id, {
          status: 'فشل',
        });
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // ================================
  // ADMIN ROUTES (Simple auth for now)
  // ================================

  const ADMIN_KEY = 'admin123'; // Replace with proper auth

  const requireAdminAuth = (req: any, res: any, next: any) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    next();
  };

  // Get all profits
  app.get("/api/admin/profits", requireAdminAuth, async (req, res) => {
    try {
      const profits = await storage.getProfits();
      res.json(profits);
    } catch (error) {
      console.error('Error fetching profits:', error);
      res.status(500).json({ error: 'فشل في جلب الأرباح' });
    }
  });

  // Manage packages
  app.get("/api/admin/packages", requireAdminAuth, async (req, res) => {
    try {
      const packages = await storage.getPackages();
      res.json(packages);
    } catch (error) {
      console.error('Error fetching packages:', error);
      res.status(500).json({ error: 'فشل في جلب الباقات' });
    }
  });

  app.post("/api/admin/packages", requireAdminAuth, async (req, res) => {
    try {
      const validated = insertPackageSchema.parse(req.body);
      const pkg = await storage.createPackage(validated);
      res.json(pkg);
    } catch (error) {
      console.error('Error creating package:', error);
      res.status(400).json({ error: 'فشل في إنشاء الباقة' });
    }
  });

  app.put("/api/admin/packages/:id", requireAdminAuth, async (req, res) => {
    try {
      const updates = req.body;
      const pkg = await storage.updatePackage(req.params.id, updates);
      res.json(pkg);
    } catch (error) {
      console.error('Error updating package:', error);
      res.status(500).json({ error: 'فشل في تحديث الباقة' });
    }
  });

  // Manage discount codes
  app.get("/api/admin/discounts", requireAdminAuth, async (req, res) => {
    try {
      const codes = await storage.getDiscountCodes();
      res.json(codes);
    } catch (error) {
      console.error('Error fetching discount codes:', error);
      res.status(500).json({ error: 'فشل في جلب أكواد الخصم' });
    }
  });

  app.post("/api/admin/discounts", requireAdminAuth, async (req, res) => {
    try {
      const validated = insertDiscountCodeSchema.parse(req.body);
      const code = await storage.createDiscountCode(validated);
      res.json(code);
    } catch (error) {
      console.error('Error creating discount code:', error);
      res.status(400).json({ error: 'فشل في إنشاء كود الخصم' });
    }
  });

  app.put("/api/admin/discounts/:code", requireAdminAuth, async (req, res) => {
    try {
      const updates = req.body;
      const code = await storage.updateDiscountCode(req.params.code, updates);
      res.json(code);
    } catch (error) {
      console.error('Error updating discount code:', error);
      res.status(500).json({ error: 'فشل في تحديث كود الخصم' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
