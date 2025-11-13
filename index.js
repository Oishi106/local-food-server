const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require("dotenv").config()
const port = process.env.PORT || 3000


//middleware
app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@cluster0.7xap9dx.mongodb.net/?appName=Cluster0`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    //data base er modde data rakhar jonno file toiry kora
    const db = client.db('khowadowa_db')
    const itemsCollection = db.collection('details')


    //find(finds multiple data)
    //findone(finds only one data)

    //get information from database
    app.get('/details', async (req, res) => {

      const result = await itemsCollection.find().toArray() //promise

      res.send(result)
    })
    //post method
    //insertone
    //insertmany
    app.get('/details/:id', async (req, res) => {
      const { id } = req.params

      const result = await itemsCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    //top  6 data acquring
    //get
    //find
    app.get('/top_rated-items', async (req, res) => {
      const result = await itemsCollection
        //mongodb er data shob string e tai eta use korchi
        .aggregate([
          {
            $addFields: {
              star_rating_num: { $toDouble: "$star_rating" }
            }
          },
          { $sort: { star_rating_num: -1 } },
          { $limit: 6 }
        ])
        .toArray();

      res.send(result);
    });
    //for search
  

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Its ok bro')
})
app.listen(port, () => {
  console.log(`simple crud server is running on port ${port}`)
})