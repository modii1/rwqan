import { createLivePublicApiSource } from "./server/services/LivePublicApiSource.ts";

const source = createLivePublicApiSource();
const props = await source.getProperties();
console.log("READ_OK count=", props.length);
console.log("SAMPLE=", JSON.stringify(props.slice(0, 2)));
