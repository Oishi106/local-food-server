const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// --------------------
// MIDDLEWARE
// --------------------
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://your-deployed-frontend.com", // deployed URL হলে এখানে দাও
    ],
    credentials: true,
  })
);
app.use(express.json());

// --------------------
// JWT VERIFY MIDDLEWARE
// --------------------
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// --------------------
// MONGODB CONNECTION
// --------------------
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@cluster0.7xap9dx.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("khowadowa_db");
    const itemsCollection = db.collection("details");
    const usersCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");

    // --------------------
    // AUTH API (JWT)
    // --------------------
    app.post("/jwt", (req, res) => {
      const user = req.body; // { email }
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      res.send({ token });
    });

    // --------------------
    // USERS
    // --------------------

    // Save user on first login (call this after Google/email login)
    app.post("/users", async (req, res) => {
      const user = req.body; // { name, email, photoURL, role: "user" }
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res.send({ message: "User already exists", inserted: false });
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: user.role || "user",
        createdAt: new Date(),
      });
      res.send(result);
    });

    // Get all users (admin only — add verifyToken + verifyAdmin if needed)
    app.get("/users", verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Get single user role
    app.get("/users/role", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.user.email) {
        return res.status(403).send({ message: "Forbidden" });
      }
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    // Update user role (admin action)
    app.patch("/users/:id/role", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    // --------------------
    // PUBLIC ROUTES
    // --------------------
    app.get("/", (req, res) => {
      res.send("Backend is running 🚀");
    });

    // All food items
    app.get("/details", async (req, res) => {
      const result = await itemsCollection.find().toArray();
      res.send(result);
    });

    // Single food item
    app.get("/details/:id", async (req, res) => {
      const { id } = req.params;
      const result = await itemsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Top rated items (for Home page)
    app.get("/top_rated-items", async (req, res) => {
      const result = await itemsCollection
        .aggregate([
          {
            $addFields: {
              star_rating_num: { $toDouble: "$star_rating" },
            },
          },
          { $sort: { star_rating_num: -1 } },
          { $limit: 6 },
        ])
        .toArray();
      res.send(result);
    });

    // Search
    app.get("/search", async (req, res) => {
      const searchText = req.query.search || "";
      const result = await itemsCollection
        .find({ food_name: { $regex: searchText, $options: "i" } })
        .toArray();
      res.send(result);
    });

    // All reviews (public)
    app.get("/all-reviews", async (req, res) => {
      const result = await itemsCollection
        .find({})
        .sort({ _id: -1 })
        .limit(20)
        .toArray();
      res.send(result);
    });

    // --------------------
    // DASHBOARD OVERVIEW
    // --------------------
    app.get("/dashboard/overview", verifyToken, async (req, res) => {
      const userEmail = req.user.email;

      // Check if admin
      const currentUser = await usersCollection.findOne({ email: userEmail });
      const isAdmin = currentUser?.role === "admin";

      if (isAdmin) {
        // Admin metrics
        const totalBookings = await bookingsCollection.countDocuments();
        const totalServices = await itemsCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();

        // Revenue from bookings
        const revenueAgg = await bookingsCollection
          .aggregate([
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
          .toArray();
        const revenue = revenueAgg[0]?.total || 0;

        // Chart data: last 6 months booking counts
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const bookingsByMonth = await bookingsCollection
          .aggregate([
            { $match: { createdAt: { $gte: sixMonthsAgo } } },
            {
              $group: {
                _id: { $month: "$createdAt" },
                bookings: { $sum: 1 },
                revenue: { $sum: "$amount" },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const chartData = bookingsByMonth.map((m) => ({
          label: monthNames[m._id - 1],
          bookings: m.bookings,
          revenue: m.revenue,
        }));

        return res.send({
          metrics: {
            totalBookings,
            totalServices,
            totalUsers,
            revenue: `${revenue.toLocaleString()}`,
          },
          chartData,
        });
      } else {
        // User metrics
        const myBookings = await bookingsCollection.countDocuments({ userEmail });
        const myReviews = await itemsCollection.countDocuments({ user: userEmail });

        const paymentsAgg = await bookingsCollection
          .aggregate([
            { $match: { userEmail } },
            { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
          ])
          .toArray();
        const amountSpent = paymentsAgg[0]?.total || 0;
        const paymentCount = paymentsAgg[0]?.count || 0;

        // User's booking chart
        const myBookingList = await bookingsCollection
          .find({ userEmail })
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();

        const chartData = myBookingList.reverse().map((b, i) => ({
          label: b.foodName || `Order ${i + 1}`,
          bookings: 1,
          revenue: b.amount || 0,
        }));

        return res.send({
          metrics: {
            totalBookings: myBookings,
            totalServices: myReviews,
            totalUsers: paymentCount,
            revenue: `${amountSpent.toLocaleString()}`,
          },
          chartData,
        });
      }
    });

    // --------------------
    // BOOKINGS (CRUD)
    // --------------------

    // All bookings (admin) or user's bookings
    app.get("/bookings", verifyToken, async (req, res) => {
      const { email } = req.query;
      const currentUser = await usersCollection.findOne({ email: req.user.email });
      const isAdmin = currentUser?.role === "admin";

      let query = {};
      if (!isAdmin) {
        // Regular user — only their own bookings
        if (email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden" });
        }
        query = { userEmail: email };
      }

      const result = await bookingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Create booking
    app.post("/bookings", verifyToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne({
        ...booking,
        userEmail: req.user.email,
        status: "pending",
        createdAt: new Date(),
      });
      res.send(result);
    });

    // Delete booking
    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // Make sure the booking belongs to the user (or admin)
      const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      const currentUser = await usersCollection.findOne({ email: req.user.email });
      const isAdmin = currentUser?.role === "admin";

      if (!isAdmin && booking?.userEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update booking status (admin)
    app.patch("/bookings/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // --------------------
    // FOOD ITEMS (CRUD)
    // --------------------

    // Add food item
    app.post("/details", verifyToken, async (req, res) => {
      const data = req.body;
      const result = await itemsCollection.insertOne({
        ...data,
        createdAt: new Date(),
      });
      res.send(result);
    });

    // Update food item
    app.put("/items/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const data = req.body;
      const result = await itemsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: data }
      );
      res.send(result);
    });

    // Delete food item (admin)
    app.delete("/details/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await itemsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // --------------------
    // MY REVIEWS
    // --------------------
    app.get("/my-reviews", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const result = await itemsCollection.find({ user: email }).toArray();
      res.send(result);
    });

    // --------------------
    // DASHBOARD RECENT ITEMS
    // --------------------
    app.get("/dashboard/recent-items", verifyToken, async (req, res) => {
      const result = await itemsCollection
        .find()
        .sort({ _id: -1 })
        .limit(5)
        .toArray();
      res.send(result);
    });

    // --------------------
    // FOODS alias (frontend uses /foods)
    // --------------------
    app.get("/foods", async (req, res) => {
      const result = await itemsCollection.find().toArray();
      res.send(result);
    });

    app.delete("/foods/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await itemsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected");
  } finally {
    // keep server running
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});