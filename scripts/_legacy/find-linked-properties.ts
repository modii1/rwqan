import { FirebaseService } from "./server/firebaseService";

async function findLinkedProperties() {
  const firebaseService = new FirebaseService();
  
  try {
    // Get all properties
    const allProperties = await firebaseService.getProperties();
    
    console.log(`\n🏠 Total Properties: ${allProperties.length}\n`);
    
    // Find properties with linkedProperty
    const linkedProperties = allProperties.filter(p => p.linkedProperty);
    
    console.log(`🔗 Properties with linkedProperty: ${linkedProperties.length}`);
    
    if (linkedProperties.length > 0) {
      console.log("\n📋 Linked Properties:");
      for (const prop of linkedProperties) {
        console.log(`  Property Number: ${prop.propertyNumber}`);
        console.log(`  Property Name: ${prop.name}`);
        console.log(`  Linked To: ${prop.linkedProperty}`);
        console.log(`  City: ${prop.city}`);
        console.log(`  Subscription Type: ${prop.subscriptionType}`);
        console.log(`  WhatsApp: ${prop.whatsappNumber}`);
        console.log("  ──────────────────────");
      }
    } else {
      console.log("\n❌ No linked properties found.\n");
    }
    
    // Also check for properties that might be referenced as linked
    const linkedPropertyNumbers = linkedProperties.map(p => p.linkedProperty);
    const parentProperties = allProperties.filter(p => 
      linkedPropertyNumbers.includes(p.propertyNumber)
    );
    
    console.log(`\n👨‍👦 Parent Properties (properties that have linked children): ${parentProperties.length}`);
    
    if (parentProperties.length > 0) {
      console.log("\n📋 Parent Properties:");
      for (const prop of parentProperties) {
        const children = allProperties.filter(p => p.linkedProperty === prop.propertyNumber);
        console.log(`  Property Number: ${prop.propertyNumber}`);
        console.log(`  Property Name: ${prop.name}`);
        console.log(`  Number of Linked Children: ${children.length}`);
        console.log(`  Children IDs: ${children.map(c => c.propertyNumber).join(', ')}`);
        console.log("  ──────────────────────");
      }
    }
    
    // Show first 5 properties regardless
    console.log(`\n📋 First 5 properties in database:`);
    allProperties.slice(0, 5).forEach((prop, idx) => {
      console.log(`  [${idx + 1}] #${prop.propertyNumber} - ${prop.name} (${prop.city}) | Linked: ${prop.linkedProperty || 'None'}`);
    });
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

findLinkedProperties();
