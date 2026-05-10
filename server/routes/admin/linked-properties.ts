import { Router } from "express";
import { firebaseService } from "../../firebaseService";
import { propertyService } from "../../services";

const router = Router();

// ==========================
//   العقارات المضافة / العقارات المرتبطة
// ==========================

// Get all linked properties with full details
router.get("/api/admin/linked-properties", async (req, res) => {
  try {
    const allProperties = await firebaseService.getProperties();
    const allSubscriptions = await firebaseService.getSubscriptions();
    
    // Properties that are linked to another property
    const linkedProperties = allProperties.filter(p => p.linkedProperty);
    
    // Properties that have linked children (main properties)
    const mainPropertyNumbers = new Set(linkedProperties.map(p => p.linkedProperty));
    const mainProperties = allProperties.filter(p => mainPropertyNumbers.has(p.propertyNumber));
    
    const result = await Promise.all(linkedProperties.map(async (p) => {
      const subscription = allSubscriptions.find(s => s.propertyNumber === p.propertyNumber);
      const mainProperty = await firebaseService.getPropertyByNumber(p.linkedProperty!);
      const mainSubscription = allSubscriptions.find(s => s.propertyNumber === p.linkedProperty);
      
      return {
        propertyNumber: p.propertyNumber,
        name: p.name,
        city: p.city,
        direction: p.direction,
        type: p.type,
        whatsappNumber: p.whatsappNumber,
        subscriptionType: p.subscriptionType,
        linkedProperty: p.linkedProperty,
        mainPropertyName: mainProperty?.name || p.linkedProperty,
        mainPropertyCity: mainProperty?.city,
        mainPropertyWhatsapp: mainProperty?.whatsappNumber,
        verificationStatus: p.verificationStatus,
        subscriptionStatus: subscription?.status || 'غير مرتبط',
        endDate: subscription?.endDate || mainSubscription?.endDate || undefined,
        startDate: subscription?.startDate || mainSubscription?.startDate || undefined,
        packageId: subscription?.packageId || mainSubscription?.packageId || undefined,
        facilities: p.facilities || [],
        location: p.location,
        prices: p.prices,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    }));

    res.json({
      success: true,
      data: result,
      count: result.length,
      mainPropertyCount: mainProperties.length,
    });

  } catch (err) {
    console.error("[GET_LINKED_PROPERTIES] Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "فشل في جلب العقارات المضافة" 
    });
  }
});

// Unlink a property from its main property
router.put("/api/admin/linked-properties/:propertyNumber/unlink", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    
    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: "العقار غير موجود" 
      });
    }

    if (!property.linkedProperty) {
      return res.status(400).json({ 
        success: false, 
        message: "هذا العقار ليس مرتبطاً بعقار آخر" 
      });
    }

    // Remove linkedProperty field
    const updated = await firebaseService.updateProperty(propertyNumber, {
      linkedProperty: undefined,
      subscriptionType: 'عادي' // Reset to normal
    });

    // Update linkedProperties array in main property's subscription
    const subscriptions = await firebaseService.getSubscriptions();
    const mainSubscription = subscriptions.find(s => s.propertyNumber === property.linkedProperty);
    if (mainSubscription?.linkedProperties) {
      const updatedLinked = mainSubscription.linkedProperties.filter(
        p => p !== propertyNumber
      );
      await firebaseService.updateSubscription(mainSubscription.id, {
        linkedProperties: updatedLinked,
        propertyCount: updatedLinked.length + 1
      });
    }

    res.json({
      success: true,
      message: "تم فك الارتباط بنجاح",
      property: updated
    });

  } catch (err) {
    console.error("[UNLINK_PROPERTY] Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "فشل في فك الارتباط" 
    });
  }
});

// Update linked property data
router.put("/api/admin/linked-properties/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const updates = req.body;

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: "العقار غير موجود" 
      });
    }

    if (!property.linkedProperty) {
      return res.status(400).json({ 
        success: false, 
        message: "هذا العقار ليس مرتبطاً بعقار آخر" 
      });
    }

    const updated = await propertyService.update(propertyNumber, updates, { 
      skipVerification: true 
    });

    res.json({
      success: true,
      message: "تم تحديث العقار بنجاح",
      property: updated
    });

  } catch (err) {
    console.error("[UPDATE_LINKED_PROPERTY] Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "فشل في تحديث العقار" 
    });
  }
});

// Delete linked property
router.delete("/api/admin/linked-properties/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    
    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: "العقار غير موجود" 
      });
    }

    const linkedProperty = property.linkedProperty;

    // Delete the linked property
    await firebaseService.deleteProperty(propertyNumber);

    // Update linkedProperties array in main property's subscription
    if (linkedProperty) {
      const subscriptions = await firebaseService.getSubscriptions();
      const mainSubscription = subscriptions.find(s => s.propertyNumber === linkedProperty);
      if (mainSubscription?.linkedProperties) {
        const updatedLinked = mainSubscription.linkedProperties.filter(
          p => p !== propertyNumber
        );
        await firebaseService.updateSubscription(mainSubscription.id, {
          linkedProperties: updatedLinked,
          propertyCount: updatedLinked.length + 1
        });
      }
    }

    res.json({
      success: true,
      message: "تم حذف العقار بنجاح",
      propertyNumber
    });

  } catch (err) {
    console.error("[DELETE_LINKED_PROPERTY] Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "فشل في حذف العقار" 
    });
  }
});

export default router;
