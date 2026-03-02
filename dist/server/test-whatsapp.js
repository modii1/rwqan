"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const whatsapp_1 = require("./whatsapp");
async function testWhatsApp() {
    console.log("🧪 بدء اختبار إشعارات الواتساب...");
    const result = await (0, whatsapp_1.notifyNewProperty)({
        propertyNumber: "TEST-001",
        propertyName: "عقار تجريبي",
        ownerPhone: "966500000000",
        city: "الرياض",
        type: "فيلا",
    });
    console.log("📊 نتيجة الاختبار:", result);
    if (result.status === "success") {
        console.log("✅ الإشعارات تعمل بنجاح!");
    }
    else if (result.status === "disabled") {
        console.log("⚠️ الإشعارات معطلة من الإعدادات");
    }
    else {
        console.log("❌ فشل الإرسال:", result.response);
    }
}
testWhatsApp();
