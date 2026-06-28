import { Router } from "express";
import { requireAdmin } from "../middleware";
import { firebaseService } from "../../firebaseService";
import { propertyService } from "../../services";

const router = Router();

// All linked-properties routes require admin authentication
router.use("/api/admin", requireAdmin);

// ==========================
//   العقارات المضافة / العقارات المرتبطة
// ==========================

// Get all linked properties with full details
router.get("/api/admin/linked-properties", async (req, res) => {
  try {
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const allProperties = await firebaseService.getProperties();
    const allSubscriptions = await firebaseService.getSubscriptions();

    const linkedProps: any[] = [];

    for (const multiSub of multiSubs) {
      const uniqueProps = new Set<string>();
      uniqueProps.add(multiSub.propertyNumber1);
      if (multiSub.propertyNumber2) uniqueProps.add(multiSub.propertyNumber2);
      if (multiSub.additionalProperties) {
        for (const ap of multiSub.additionalProperties) {
          if (ap !== multiSub.propertyNumber1) uniqueProps.add(ap);
        }
      }
      const allProps = Array.from(uniqueProps);

      const mainPropertyNumber = multiSub.propertyNumber1;

      for (const propNumber of allProps) {
        // Skip the main property — only show linked/additional properties
        if (propNumber === mainPropertyNumber) continue;

        const prop = allProperties.find(p => p.propertyNumber === propNumber);
        const sub = allSubscriptions.find(s => s.propertyNumber === propNumber);
        const mainProp = allProperties.find(p => p.propertyNumber === mainPropertyNumber);
        const parentNumber = propNumber === mainPropertyNumber ? null : mainPropertyNumber;

        linkedProps.push({
          propertyNumber: propNumber,
          name: prop?.name || propNumber,
          city: prop?.city || "",
          direction: prop?.direction || "",
          type: prop?.type || "",
          whatsappNumber: prop?.whatsappNumber || "",
          subscriptionType: sub?.subscriptionType || prop?.subscriptionType || "عادي",
          linkedProperty: parentNumber,
          linkedPropertyName: parentNumber ? (mainProp?.name || parentNumber) : null,
          mainPropertyName: mainProp?.name || mainPropertyNumber,
          mainPropertyCity: mainProp?.city || "",
          mainPropertyWhatsapp: mainProp?.whatsappNumber || "",
          verificationStatus: prop?.verificationStatus,
          subscriptionStatus: sub?.status || "غير مرتبط",
          endDate: sub?.endDate || multiSub.endDate || undefined,
          startDate: sub?.startDate || multiSub.startDate || undefined,
          packageId: sub?.packageId || multiSub.packageId || undefined,
          facilities: prop?.facilities || [],
          location: prop?.location,
          prices: prop?.prices,
          multiSubId: multiSub.id,
          groupSize: allProps.length,
          isMainProperty: propNumber === mainPropertyNumber,
          groupStatus: multiSub.status,
          createdAt: multiSub.createdAt || prop?.createdAt,
          updatedAt: prop?.updatedAt,
        });
      }
    }

    // Deduplicate by propertyNumber — keep first occurrence
    const seen = new Set<string>();
    const deduplicated = linkedProps.filter(p => {
      if (seen.has(p.propertyNumber)) return false;
      seen.add(p.propertyNumber);
      return true;
    });

    res.json({
      success: true,
      data: deduplicated,
      count: deduplicated.length,
      mainPropertyCount: new Set(deduplicated.filter(p => p.isMainProperty).map(p => p.propertyNumber)).size,
    });

  } catch (err) {
    console.error("[GET_LINKED_PROPERTIES] Error:", err);
    res.status(500).json({ success: false, message: "فشل في جلب العقارات المضافة" });
  }
});

// Get multi-property subscription groups
router.get("/api/admin/linked-properties/groups", async (req, res) => {
  try {
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const allProperties = await firebaseService.getProperties();

    const groups = multiSubs.map((multiSub) => {
      const uniqueProps = new Set<string>();
      uniqueProps.add(multiSub.propertyNumber1);
      if (multiSub.propertyNumber2) uniqueProps.add(multiSub.propertyNumber2);
      if (multiSub.additionalProperties) {
        for (const ap of multiSub.additionalProperties) {
          if (ap !== multiSub.propertyNumber1) uniqueProps.add(ap);
        }
      }
      const allProps = Array.from(uniqueProps);

      const properties = allProps.map(pn => {
        const prop = allProperties.find(p => p.propertyNumber === pn);
        return {
          propertyNumber: pn,
          name: prop?.name || pn,
          city: prop?.city || "",
          isMain: pn === multiSub.propertyNumber1,
        };
      });

      return {
        id: multiSub.id,
        packageId: multiSub.packageId,
        mainPropertyNumber: multiSub.propertyNumber1,
        mainPropertyName: allProperties.find(p => p.propertyNumber === multiSub.propertyNumber1)?.name || multiSub.propertyNumber1,
        properties,
        groupSize: allProps.length,
        status: multiSub.status,
        startDate: multiSub.startDate,
        endDate: multiSub.endDate,
        paymentId: multiSub.paymentId,
        createdAt: multiSub.createdAt,
      };
    });

    res.json({ success: true, data: groups, count: groups.length });
  } catch (err) {
    console.error("[GET_LINKED_PROPERTY_GROUPS] Error:", err);
    res.status(500).json({ success: false, message: "فشل في جلب مجموعات العقارات" });
  }
});

// Create a new multi-property subscription group
router.post("/api/admin/linked-properties/groups", async (req, res) => {
  try {
    const { packageId, propertyNumber1, propertyNumber2, additionalProperties, startDate, endDate, status } = req.body;

    if (!propertyNumber1 || !propertyNumber2) {
      return res.status(400).json({ success: false, message: "رقما العقارين مطلوبان" });
    }

    const prop1 = await firebaseService.getPropertyByNumber(propertyNumber1);
    const prop2 = await firebaseService.getPropertyByNumber(propertyNumber2);
    if (!prop1 || !prop2) {
      return res.status(404).json({ success: false, message: "أحد العقارين غير موجود" });
    }

    // Payment validation: check if the main property's payment covers this many properties
    const mainSub = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber1);
    if (mainSub && mainSub.paymentId) {
      const payment = await firebaseService.getPaymentById(mainSub.paymentId);
      if (payment) {
        const totalProps = 1 + (additionalProperties?.length || 0) + 1; // main + additional + propertyNumber2
        const expectedProps = 1 + ((payment as any).additionalProperties?.length || 0) + ((payment as any).secondPropertyNumber ? 1 : 0);
        if (totalProps > expectedProps && !packageId) {
          console.log(`[CREATE_GROUP] ⚠️ Warning: Group would have ${totalProps} properties but payment covers ${expectedProps}`);
          // Don't block, but log warning — admin has override authority
        }
      }
    }

    const allLinkedProps = [propertyNumber1, propertyNumber2, ...(additionalProperties || [])];

    const multiSub = await firebaseService.createMultiPropertySubscription({
      packageId: packageId || "",
      propertyNumber1,
      propertyNumber2,
      additionalProperties: additionalProperties || [],
      linkedProperties: allLinkedProps,
      propertyCount: allLinkedProps.length,
      startDate: startDate || new Date().toISOString().split("T")[0],
      endDate: endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      status: status || "نشط",
    });

    for (const pn of allLinkedProps) {
      await firebaseService.updateProperty(pn, { subscriptionType: "مميز" });
    }

    res.json({ success: true, message: "تم إنشاء مجموعة العقارات بنجاح", data: multiSub });
  } catch (err) {
    console.error("[CREATE_LINKED_PROPERTY_GROUP] Error:", err);
    res.status(500).json({ success: false, message: "فشل في إنشاء مجموعة العقارات" });
  }
});

// Update a multi-property subscription group
router.put("/api/admin/linked-properties/groups/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalProperties, startDate, endDate, status } = req.body;

    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const current = multiSubs.find(m => m.id === id);
    if (!current) {
      return res.status(404).json({ success: false, message: "المجموعة غير موجودة" });
    }

    const updatedLinkedProps = [
      current.propertyNumber1,
      current.propertyNumber2,
      ...(additionalProperties !== undefined ? additionalProperties : current.additionalProperties || []),
    ].filter(Boolean);

    await firebaseService.updateMultiPropertySubscription(id, {
      ...(additionalProperties !== undefined && { additionalProperties, linkedProperties: updatedLinkedProps, propertyCount: updatedLinkedProps.length }),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(status && { status }),
    });

    res.json({ success: true, message: "تم تحديث المجموعة بنجاح" });
  } catch (err) {
    console.error("[UPDATE_LINKED_PROPERTY_GROUP] Error:", err);
    res.status(500).json({ success: false, message: "فشل في تحديث المجموعة" });
  }
});

// Add a property to an existing group
router.post("/api/admin/linked-properties/groups/:id/add", async (req, res) => {
  try {
    const { id } = req.params;
    const { propertyNumber } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ success: false, message: "رقم العقار مطلوب" });
    }

    const prop = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!prop) {
      return res.status(404).json({ success: false, message: "العقار غير موجود" });
    }

    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const current = multiSubs.find(m => m.id === id);
    if (!current) {
      return res.status(404).json({ success: false, message: "المجموعة غير موجودة" });
    }

    // Payment validation: check if adding exceeds what the payment covered
    if (current.paymentId) {
      const addPayment = await firebaseService.getPaymentById(current.paymentId);
      if (addPayment) {
        const existingUnique = new Set<string>([current.propertyNumber1]);
        if (current.propertyNumber2) existingUnique.add(current.propertyNumber2);
        if (current.additionalProperties) current.additionalProperties.forEach((ap: string) => existingUnique.add(ap));
        const newTotal = existingUnique.size + 1; // adding propertyNumber
        const paymentProps = 1 + ((addPayment as any).additionalProperties?.length || 0) + ((addPayment as any).secondPropertyNumber ? 1 : 0);
        if (newTotal > paymentProps) {
          console.log(`[ADD_TO_GROUP] ⚠️ Warning: Group would have ${newTotal} properties but payment covers ${paymentProps}`);
          // Admin override allowed — log warning
        }
      }
    }

    const newAdditional = [...(current.additionalProperties || []), propertyNumber];
    const uniqueAdd = new Set<string>();
    uniqueAdd.add(current.propertyNumber1);
    if (current.propertyNumber2) uniqueAdd.add(current.propertyNumber2);
    for (const ap of newAdditional) {
      if (ap !== current.propertyNumber1) uniqueAdd.add(ap);
    }
    const allLinked = Array.from(uniqueAdd);

    await firebaseService.updateMultiPropertySubscription(id, {
      additionalProperties: newAdditional,
      linkedProperties: allLinked,
      propertyCount: allLinked.length,
    });

    await firebaseService.updateProperty(propertyNumber, { subscriptionType: "مميز" });

    res.json({ success: true, message: `تم إضافة العقار ${propertyNumber} للمجموعة` });
  } catch (err) {
    console.error("[ADD_TO_LINKED_GROUP] Error:", err);
    res.status(500).json({ success: false, message: "فشل في إضافة العقار" });
  }
});

// Remove a property from a group
router.post("/api/admin/linked-properties/groups/:id/remove", async (req, res) => {
  try {
    const { id } = req.params;
    const { propertyNumber } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ success: false, message: "رقم العقار مطلوب" });
    }

    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const current = multiSubs.find(m => m.id === id);
    if (!current) {
      return res.status(404).json({ success: false, message: "المجموعة غير موجودة" });
    }

    if (propertyNumber === current.propertyNumber1) {
      return res.status(400).json({ success: false, message: "لا يمكن إزالة العقار الرئيسي من المجموعة" });
    }

    let newPropertyNumber2: string | undefined = current.propertyNumber2;
    let newAdditional: string[] = current.additionalProperties || [];

    if (propertyNumber === current.propertyNumber2) {
      newPropertyNumber2 = undefined;
      newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
    } else {
      newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
    }

    const uniqueRemove = new Set<string>();
    uniqueRemove.add(current.propertyNumber1);
    if (newPropertyNumber2) uniqueRemove.add(newPropertyNumber2);
    for (const ap of newAdditional) {
      if (ap !== current.propertyNumber1) uniqueRemove.add(ap);
    }
    const allLinked = Array.from(uniqueRemove);

    await firebaseService.updateMultiPropertySubscription(id, {
      ...(newPropertyNumber2 !== current.propertyNumber2 && { propertyNumber2: newPropertyNumber2 }),
      additionalProperties: newAdditional,
      linkedProperties: allLinked,
      propertyCount: allLinked.length,
    });

    const prop = await firebaseService.getPropertyByNumber(propertyNumber);
    if (prop) {
      await firebaseService.updateProperty(propertyNumber, { subscriptionType: "عادي", linkedProperty: "" });
    }

    // Cancel the subscription for the removed property
    await firebaseService.cancelSubscription(propertyNumber, "تم إزالة العقار من المجموعة");

    res.json({ success: true, message: `تم إزالة العقار ${propertyNumber} من المجموعة` });
  } catch (err) {
    console.error("[REMOVE_FROM_LINKED_GROUP] Error:", err);
    res.status(500).json({ success: false, message: "فشل في إزالة العقار" });
  }
});

// Delete a multi-property subscription group
router.delete("/api/admin/linked-properties/groups/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const current = multiSubs.find(m => m.id === id);
    if (!current) {
      return res.status(404).json({ success: false, message: "المجموعة غير موجودة" });
    }

    const allProps: string[] = ([
      current.propertyNumber1,
      current.propertyNumber2,
      ...(current.additionalProperties || []),
    ] as string[]).filter(Boolean);

    for (const pn of allProps) {
      await firebaseService.updateProperty(pn, { subscriptionType: "عادي", linkedProperty: "" });
      await firebaseService.cancelSubscription(pn, "تم حذف مجموعة العقارات");
    }

    await firebaseService.deleteMultiPropertySubscription(id);

    res.json({ success: true, message: "تم حذف المجموعة بنجاح" });
  } catch (err) {
    console.error("[DELETE_LINKED_GROUP] Error:", err);
    res.status(500).json({ success: false, message: "فشل في حذف المجموعة" });
  }
});

// Unlink a property from its group
router.put("/api/admin/linked-properties/:propertyNumber/unlink", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();

    let foundGroup: any = null;
    for (const multiSub of multiSubs) {
      const uniqueProps2 = new Set<string>();
uniqueProps2.add(multiSub.propertyNumber1);
if (multiSub.propertyNumber2) uniqueProps2.add(multiSub.propertyNumber2);
if (multiSub.additionalProperties) {
  for (const ap of multiSub.additionalProperties) {
    if (ap !== multiSub.propertyNumber1) uniqueProps2.add(ap);
  }
}
const allProps = Array.from(uniqueProps2);
      if (allProps.includes(propertyNumber)) {
        foundGroup = multiSub;
        break;
      }
    }

    if (!foundGroup) {
      return res.status(404).json({ success: false, message: "العقار غير مرتبط بأي مجموعة" });
    }

    if (propertyNumber === foundGroup.propertyNumber1) {
      return res.status(400).json({ success: false, message: "لا يمكن فك ارتباط العقار الرئيسي. احذف المجموعة كاملة." });
    }

    let newPropertyNumber2: string | undefined = foundGroup.propertyNumber2;
    let newAdditional: string[] = foundGroup.additionalProperties || [];

    if (propertyNumber === foundGroup.propertyNumber2) {
      newPropertyNumber2 = undefined;
      newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
    } else {
      newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
    }

    const uniqueProps = new Set<string>();
    uniqueProps.add(foundGroup.propertyNumber1);
    if (newPropertyNumber2) uniqueProps.add(newPropertyNumber2);
    for (const ap of newAdditional) {
      if (ap !== foundGroup.propertyNumber1) uniqueProps.add(ap);
    }
    const allLinked = Array.from(uniqueProps);

    await firebaseService.updateMultiPropertySubscription(foundGroup.id, {
      ...(newPropertyNumber2 !== foundGroup.propertyNumber2 && { propertyNumber2: newPropertyNumber2 }),
      additionalProperties: newAdditional,
      linkedProperties: allLinked,
      propertyCount: allLinked.length,
    });

    const prop = await firebaseService.getPropertyByNumber(propertyNumber);
    if (prop) {
      await firebaseService.updateProperty(propertyNumber, { subscriptionType: "عادي", linkedProperty: "" });
    }

    // Also cancel the linked subscription
    await firebaseService.cancelSubscription(propertyNumber, "فك ارتباط العقار");

    res.json({ success: true, message: `تم فك ارتباط العقار ${propertyNumber} بنجاح` });
  } catch (err) {
    console.error("[UNLINK_PROPERTY] Error:", err);
    res.status(500).json({ success: false, message: "فشل في فك الارتباط" });
  }
});

// Update linked property data
router.put("/api/admin/linked-properties/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const updates = req.body;

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ success: false, message: "العقار غير موجود" });
    }

    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });

    res.json({ success: true, message: "تم تحديث العقار بنجاح", property: updated });
  } catch (err) {
    console.error("[UPDATE_LINKED_PROPERTY] Error:", err);
    res.status(500).json({ success: false, message: "فشل في تحديث العقار" });
  }
});

// Delete linked property
router.delete("/api/admin/linked-properties/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ success: false, message: "العقار غير موجود" });
    }

    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    for (const multiSub of multiSubs) {
      const uniqueCheck = new Set<string>();
      uniqueCheck.add(multiSub.propertyNumber1);
      if (multiSub.propertyNumber2) uniqueCheck.add(multiSub.propertyNumber2);
      if (multiSub.additionalProperties) {
        for (const ap of multiSub.additionalProperties) {
          if (ap !== multiSub.propertyNumber1) uniqueCheck.add(ap);
        }
      }
      const allProps = Array.from(uniqueCheck);

      if (allProps.includes(propertyNumber)) {
        if (propertyNumber === multiSub.propertyNumber1) {
          return res.status(400).json({ success: false, message: "لا يمكن حذف العقار الرئيسي. احذف المجموعة كاملة." });
        }

        let newPropertyNumber2: string | undefined = multiSub.propertyNumber2;
        let newAdditional: string[] = multiSub.additionalProperties || [];

        if (propertyNumber === multiSub.propertyNumber2) {
          newPropertyNumber2 = undefined;
          newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
        } else {
          newAdditional = newAdditional.filter((p: string) => p !== propertyNumber);
        }

        const uniqueFinal = new Set<string>();
        uniqueFinal.add(multiSub.propertyNumber1);
        if (newPropertyNumber2) uniqueFinal.add(newPropertyNumber2);
        for (const ap of newAdditional) {
          if (ap !== multiSub.propertyNumber1) uniqueFinal.add(ap);
        }
        const allLinked = Array.from(uniqueFinal);

        await firebaseService.updateMultiPropertySubscription(multiSub.id, {
          ...(newPropertyNumber2 !== multiSub.propertyNumber2 && { propertyNumber2: newPropertyNumber2 }),
          additionalProperties: newAdditional,
          linkedProperties: allLinked,
          propertyCount: allLinked.length,
        });
        break;
      }
    }

    await firebaseService.deleteProperty(propertyNumber);

    res.json({ success: true, message: "تم حذف العقار بنجاح", propertyNumber });
  } catch (err) {
    console.error("[DELETE_LINKED_PROPERTY] Error:", err);
    res.status(500).json({ success: false, message: "فشل في حذف العقار" });
  }
});

export default router;
