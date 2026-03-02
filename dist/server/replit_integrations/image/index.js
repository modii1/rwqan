"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editImages = exports.generateImageBuffer = exports.openai = exports.registerImageRoutes = void 0;
var routes_1 = require("./routes");
Object.defineProperty(exports, "registerImageRoutes", { enumerable: true, get: function () { return routes_1.registerImageRoutes; } });
var client_1 = require("./client");
Object.defineProperty(exports, "openai", { enumerable: true, get: function () { return client_1.openai; } });
Object.defineProperty(exports, "generateImageBuffer", { enumerable: true, get: function () { return client_1.generateImageBuffer; } });
Object.defineProperty(exports, "editImages", { enumerable: true, get: function () { return client_1.editImages; } });
