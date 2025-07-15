const swaggerJSDoc = require("swagger-jsdoc");
const fs = require("fs");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "My API",
      version: "1.0.0",
    },
  },
  apis: ["./api/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);

fs.writeFileSync(
  "./public/swagger.json",
  JSON.stringify(swaggerSpec, null, 2),
  "utf-8"
);
