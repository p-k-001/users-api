const envPath = {
  production: ".env.production",
  staging: ".env.staging",
  development: ".env.local",
}[process.env.NODE_ENV || "development"];

require("dotenv").config({ path: envPath });

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// TODO: move to config
const allowedOrigins = [
  "http://localhost:5173",
  "https://users-dev.projects.icanbreakit.eu",
  "https://users-ui-phi.vercel.app",
  "https://users.projects.icanbreakit.eu",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "Pragma",
  ],
  exposedHeaders: ["Authorization"],
  maxAge: 86400, // 24 hours
};

// Handle preflight requests first
app.options("*", cors(corsOptions));

app.use(bodyParser.json());
app.use(cors(corsOptions));

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "My API",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./api/**/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.get("/api-docs/swagger.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/** Centralized Prisma error handler */
function handlePrismaError(res, err, action = "Operation") {
  if (err.code === "P2025") {
    return res
      .status(404)
      .json({ message: `${action} failed: record not found` });
  }
  console.error(`${action} error:`, err);
  const status = err.code ? 500 : 400;
  return res.status(status).json({ message: `${action} failed` });
}

/**
 * JWT authentication middleware
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      errors: { message: "No token provided", code: "NO_TOKEN" },
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        errors: {
          message: "Invalid or expired token - log out and log in again",
          code: "INVALID_TOKEN",
        },
      });
    }

    req.user = user;
    next();
  });
};

// Helper: Adult check
const isAdult = (age) => age >= 18;

/**
 * @openapi
 * /hello:
 *   get:
 *     summary: testing service
 *     responses:
 *       200:
 *         description: returns greeting
 */
app.get("/hello", (req, res) => {
  res.status(200).json({ message: "Hello, API Testing!" });
});

/**
 * @openapi
 * /users:
 *   get:
 *     summary: Get all users for logged-in owner
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   age:
 *                     type: integer
 *                   role:
 *                     type: string
 *                     enum: [admin, user]
 *                   adult:
 *                     type: boolean
 *                     description: Whether the user is an adult (18+)
 */
app.get("/users", authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { ownerId: req.user.id },
    });
    res.json(users);
  } catch (err) {
    handlePrismaError(res, err, "Fetch users");
  }
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get a user by ID (only if owned)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: ID of the user
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                 age:
 *                   type: integer
 *                 role:
 *                   type: string
 *                   enum: [admin, user]
 *                 adult:
 *                   type: boolean
 *                   description: Whether the user is an adult (18+)
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User not found
 */
app.get("/users/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

  try {
    const user = await prisma.user.findFirst({
      where: { id, ownerId: req.user.id },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    handlePrismaError(res, err, "Fetch user");
  }
});

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a new user for the logged-in owner
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - age
 *               - role
 *             properties:
 *               name:
 *                 type: string
 *                 description: User's full name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *               age:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 125
 *                 description: User's age (0-125)
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *                 description: User's role (must be either admin or user)
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                 age:
 *                   type: integer
 *                 role:
 *                   type: string
 *                 adult:
 *                   type: boolean
 *                   description: Whether the user is an adult (18+)
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       msg:
 *                         type: string
 *                       param:
 *                         type: string
 *                       location:
 *                         type: string
 */
app.post(
  "/users",
  authenticateToken,
  [
    body("name").isString().notEmpty().withMessage("Name is required"),
    body("email")
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Valid email format is required"),
    body("age")
      .isInt({ min: 0, max: 125 })
      .withMessage("Age must be between 0 and 125"),
    body("role")
      .isIn(["admin", "user"])
      .withMessage("Role must be admin or user"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const age = parseInt(req.body.age, 10);

    const newUser = {
      name: req.body.name,
      email: req.body.email,
      age: age,
      role: req.body.role,
      adult: isAdult(age),
      owner: { connect: { id: req.user.id } },
    };

    try {
      const newUserFromDb = await prisma.user.create({ data: newUser });

      return res.status(201).json(newUserFromDb);
    } catch (err) {
      handlePrismaError(res, err, "Create user");
    }
  }
);

/**
 * @openapi
 * /users/{id}:
 *   put:
 *     summary: Update user details (only if owned)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: User's full name (optional)
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address (optional)
 *               age:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 125
 *                 description: User's age (0-125) (optional)
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *                 description: User's role (admin or user) (optional)
 *             example:
 *               name: John Doe
 *               email: john@example.com
 *               age: 30
 *               role: user
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                 age:
 *                   type: integer
 *                 role:
 *                   type: string
 *                 adult:
 *                   type: boolean
 *                   description: Whether the user is an adult (18+)
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       msg:
 *                         type: string
 *                       param:
 *                         type: string
 *                       location:
 *                         type: string
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User not found
 */

app.put(
  "/users/:id",
  authenticateToken,
  [
    body("name")
      .optional()
      .isString()
      .notEmpty()
      .withMessage("Name is required"),
    body("email")
      .optional()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Valid email format is required"),
    body("age")
      .optional()
      .isInt({ min: 0, max: 125 })
      .withMessage("Age must be between 0 and 125"),
    body("role")
      .optional()
      .isIn(["admin", "user"])
      .withMessage("Role must be admin or user"),
  ],
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updateData = {};
    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (req.body.email !== undefined) updateData.email = req.body.email;
    if (req.body.age !== undefined) updateData.age = parseInt(req.body.age, 10);
    if (req.body.role !== undefined) updateData.role = req.body.role;
    if (updateData.age !== undefined) {
      updateData.adult = isAdult(updateData.age);
    }

    try {
      // Ensure the record belongs to the logged-in user
      const existing = await prisma.user.findFirst({
        where: { id, ownerId: req.user.id },
      });
      if (!existing) return res.status(404).json({ message: "User not found" });

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
      });
      res.json(updatedUser);
    } catch (err) {
      handlePrismaError(res, err, "Update user");
    }
  }
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     summary: Delete a user (only if owned)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: User deleted
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User not found
 */
app.delete("/users/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

  try {
    // Ensure ownership
    const existing = await prisma.user.findFirst({
      where: { id, ownerId: req.user.id },
    });
    if (!existing) return res.status(404).json({ message: "User not found" });

    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    handlePrismaError(res, err, "Delete user");
  }
});

/**
 * @openapi
 * /users:
 *   delete:
 *     summary: Delete all users for current user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All users deleted
 */
app.delete("/users", authenticateToken, async (req, res) => {
  try {
    const result = await prisma.user.deleteMany({
      where: {
        ownerId: req.user.id,
      },
    });
    res.status(200).json({ deleted: result.count });
  } catch (err) {
    handlePrismaError(res, err, "Delete all users");
  }
});

/**
 * @openapi
 * /register:
 *   post:
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered
 *       400:
 *         description: Email already exists
 */
//TODO: Add a confirmation header like X-Confirm-Delete: true
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const existing = await prisma.authUser.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.authUser.create({
      data: {
        email,
        passwordHash,
      },
    });

    res.status(201).json({ message: "User registered", email });
  } catch (err) {
    handlePrismaError(res, err, "Registration");
  }
});

/**
 * @openapi
 * /login:
 *   post:
 *     summary: Login and get a token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful login
 *       401:
 *         description: Invalid credentials
 */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await prisma.authUser.findUnique({ where: { email } });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match)
      return res.status(401).json({ message: "Invalid email or password" });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "300000", // 300000ms = 5minutes
    });
    res.json({ token });
  } catch (err) {
    handlePrismaError(res, err, "Login");
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running at port ${PORT}`);
});

module.exports = app;
