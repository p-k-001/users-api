const envPath =
  process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
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

const allowedOrigins = [
  "http://localhost:5173",
  "https://test-api-ui-teal.vercel.app",
];

app.use(bodyParser.json());
app.use(cors({ origin: allowedOrigins, credentials: true }));

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "My API",
      version: "1.0.0",
    },
  },
  apis: ["./api/**/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.get("/api-docs/swagger.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ errors: { message: "Invalid token" } });
    req.user = user;
    next();
  });
};

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
  res.json({ message: "Hello, API Testing!" });
});

/**
 * @openapi
 * /users:
 *   get:
 *     summary: Get all users
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
app.get("/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (err) {
    console.error("Failed to fetch users:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get a user by ID
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
app.get("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a new user
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
    };

    // I need id from db
    const newUserFromDb = await prisma.user.create({ data: newUser });

    return res.status(201).json(newUserFromDb);
  }
);

/**
 * @openapi
 * /users/{id}:
 *   put:
 *     summary: Update user details
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
      .optional({ checkFalsy: true })
      .isString()
      .notEmpty()
      .withMessage("Name is required"),
    body("email")
      .optional({ checkFalsy: true })
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Valid email format is required"),
    body("age")
      .optional({ nullable: true })
      .isInt({ min: 0, max: 125 })
      .withMessage("Age must be between 0 and 125"),
    body("role")
      .optional({ checkFalsy: true })
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
      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
      });
      res.json(updatedUser);
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Failed to update user:", err);
      res.status(500).json({ message: "Failed to update user" });
    }
  }
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
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
    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    console.error("Failed to delete user:", err);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

/**
 * @openapi
 * /users:
 *   delete:
 *     summary: Delete all users
 *     responses:
 *       204:
 *         description: All users deleted
 */
app.delete("/users", authenticateToken, async (req, res) => {
  try {
    await prisma.user.deleteMany();
    res.status(204).send();
  } catch (err) {
    console.error("Failed to delete all users:", err);
    res.status(500).json({ message: "Failed to delete all users" });
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
    console.error("Registration error:", err);
    res.status(500).json({ message: "Registration failed" });
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
      expiresIn: "1h",
    });
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

const isAdult = (age) => {
  return age >= 18;
};

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});

module.exports = app;
